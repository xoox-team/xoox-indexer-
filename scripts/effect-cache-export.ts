import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import { promisify } from "node:util";
import { isEntry } from "./is-entry";
import { quoteIdent, quoteLiteral, safeIdent } from "./pg-ident";

/**
 * Effect-cache export (plan 3.5). Envio restores `.envio/cache/<chainId>/<effect>.tsv` into `envio_<chainId>_effect_<effect>`
 * on a CLEAN initialize only (PgStorage.res restoreEffectCache), so a replay of the new xoox-one database does not hit the
 * archive RPC again for the five seeded effects. This tool dumps those tables from the old databases with the exact
 * command Envio's own dumper uses: COPY "<schema>"."<table>" TO STDOUT WITH (FORMAT text, HEADER).
 *
 * Read-only: only SELECT and COPY ... TO STDOUT run, in sessions forced to default_transaction_read_only with a statement
 * timeout. Connection settings come from the usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, ...) and are never
 * printed. Without --run it only prints the plan.
 *
 *   tsx scripts/effect-cache-export.ts --source indexer-1|pro-indexer|trade-indexer [--database NAME] [--schema xoox]
 *                                               [--chain 10143] [--out .envio/cache] [--run]
 */
export type EffectSource = "indexer-1" | "pro-indexer" | "trade-indexer";
export type Effect = Readonly<{ name: string; source: EffectSource }>;
export type TableInfo = Readonly<{ name: string; columns: readonly string[] }>;
export type ExportPlan = Readonly<{
  source: EffectSource;
  database: string;
  schema: string;
  chainId: number;
  effects: readonly { name: string; table: string; file: string }[];
}>;
export type ExportDeps = Readonly<{
  psql: (args: readonly string[]) => Promise<string>;
  writeTsv: (path: string, text: string) => Promise<void>;
}>;

/** Plan 3.5. currentTradeDexTokenMetadataV1 is minute-bucketed (head reads), so it is deliberately not seeded. */
export const EFFECTS: readonly Effect[] = [
  { name: "canonicalRoyaltyRecipientsV1", source: "indexer-1" },
  { name: "canonicalProPoolRouterBindingV1", source: "pro-indexer" },
  { name: "canonicalReviewedProConsentSourceV3", source: "pro-indexer" },
  { name: "canonicalReviewedProHolderGenesisV4", source: "pro-indexer" },
  { name: "canonicalTradeDexEvidenceV1", source: "trade-indexer" },
];
export const SOURCE_DATABASES: Readonly<Record<EffectSource, string>> = {
  "indexer-1": "envio-dev",
  "pro-indexer": "xoox_pro_source",
  "trade-indexer": "xoox_trade_source",
};

const STATEMENT_TIMEOUT_MS = 120_000;
const DATABASE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const EFFECT_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const CACHE_TABLES = "^envio_([0-9]+_)?effect_.+";

function effectName(name: string): string {
  if (!EFFECT_NAME.test(name))
    throw new Error(`Invalid effect name: ${JSON.stringify(name)}.`);
  return name;
}
function chain(chainId: number): number {
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    throw new Error(`Invalid chain id: ${chainId}.`);
  return chainId;
}

export const cacheTableName = (chainId: number, effect: string): string =>
  `envio_${chain(chainId)}_effect_${effectName(effect)}`;
/** Relative to .envio/cache, as Envio's scanCacheDir reads it. */
export const cachePath = (chainId: number, effect: string): string =>
  `${chain(chainId)}/${effectName(effect)}.tsv`;

export const copySql = (schema: string, table: string): string =>
  `COPY ${quoteIdent(safeIdent(schema))}.${quoteIdent(table)} TO STDOUT WITH (FORMAT text, HEADER);`;
export const countSql = (schema: string, table: string): string =>
  `SELECT count(*) FROM ${quoteIdent(safeIdent(schema))}.${quoteIdent(table)};`;

/** Same table filter as Envio's makeEffectCacheTableNamesQuery, plus each table's columns (must be exactly id, output). */
export function listCacheTablesSql(schema: string): string {
  return (
    "SELECT t.table_name, array_to_string(array_agg(c.column_name::text ORDER BY c.column_name::text), ',')\n" +
    "FROM information_schema.tables t\n" +
    "JOIN information_schema.columns c ON c.table_schema = t.table_schema AND c.table_name = t.table_name\n" +
    `WHERE t.table_schema = ${quoteLiteral(safeIdent(schema))} AND t.table_name ~ ${quoteLiteral(CACHE_TABLES)}\n` +
    "GROUP BY t.table_name ORDER BY t.table_name;"
  );
}

export function parseTableList(stdout: string): TableInfo[] {
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, columns] = line.split("|");
      return {
        name: name as string,
        columns: (columns ?? "").split(",").filter(Boolean),
      };
    });
}

export function resolveCacheTable(
  tables: readonly TableInfo[],
  chainId: number,
  effect: string,
): { table: string } | { problem: string } {
  const wanted = cacheTableName(chainId, effect);
  const found = tables.find((table) => table.name === wanted);
  if (found) {
    return found.columns.join(",") === "id,output"
      ? { table: wanted }
      : {
          problem: `${wanted} has columns ${found.columns.join(",") || "(none)"}; Envio's format is exactly id,output.`,
        };
  }
  if (tables.some((table) => table.name === `envio_effect_${effect}`))
    return {
      problem: `${effect} exists only in the cross-chain format (envio_effect_${effect}); Envio 3.10 restores .envio/cache/<chain>/<name>.tsv into envio_<chain>_effect_<name>, so it cannot be exported as is.`,
    };
  return { problem: `no effect cache table ${wanted} in the source schema.` };
}

export function countTsvRows(tsv: string): number {
  const lines = tsv.split("\n");
  if (lines[0] !== "id\toutput")
    throw new Error("The TSV does not start with the id/output header.");
  return lines.slice(1).filter((line) => line !== "").length;
}

/** Cache tables only grow, so a consistent export lies between the counts taken before and after it. */
export function verifyRowCounts(
  counts: Readonly<{ before: number; after: number; tsv: number }>,
): string[] {
  const { before, after, tsv } = counts;
  if (before === 0 && after === 0 && tsv === 0)
    return ["the cache table is empty; there is nothing to seed."];
  if (tsv < before)
    return [
      `the TSV has fewer rows (${tsv}) than the table had before the export (${before}).`,
    ];
  if (tsv > after)
    return [
      `the TSV has more rows (${tsv}) than the table had after the export (${after}).`,
    ];
  return [];
}

export function psqlArgs(database: string, sql: string): string[] {
  if (!DATABASE_NAME.test(database))
    throw new Error(`Invalid database name: ${JSON.stringify(database)}.`);
  return [
    "-X",
    "-q",
    "-A",
    "-t",
    "-F",
    "|",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    database,
    "-c",
    sql,
  ];
}

/** libpq settings only, forced read-only and time-bounded; nothing else of the caller's environment is passed on. */
export function psqlEnv(
  base: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept = Object.entries(base).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      (entry[0] === "PATH" ||
        entry[0] === "HOME" ||
        (entry[0].startsWith("PG") && entry[0] !== "PGOPTIONS")),
  );
  const options =
    `-c default_transaction_read_only=on -c statement_timeout=${STATEMENT_TIMEOUT_MS} ${base["PGOPTIONS"] ?? ""}`.trim();
  return { ...Object.fromEntries(kept), PGOPTIONS: options };
}

export function planExport(input: {
  source: EffectSource;
  chainId: number;
  schema: string;
  outRoot: string;
  database?: string;
}): ExportPlan {
  return {
    source: input.source,
    database: input.database ?? SOURCE_DATABASES[input.source],
    schema: input.schema,
    chainId: input.chainId,
    effects: EFFECTS.filter((effect) => effect.source === input.source).map(
      (effect) => ({
        name: effect.name,
        table: cacheTableName(input.chainId, effect.name),
        file: posix.join(input.outRoot, cachePath(input.chainId, effect.name)),
      }),
    ),
  };
}

export async function runExport(
  plan: ExportPlan,
  deps: ExportDeps,
): Promise<{ ok: boolean; lines: string[] }> {
  const { database, schema } = plan;
  const tables = parseTableList(
    await deps.psql(psqlArgs(database, listCacheTablesSql(schema))),
  );
  const lines: string[] = [];
  let ok = true;
  for (const effect of plan.effects) {
    const resolved = resolveCacheTable(tables, plan.chainId, effect.name);
    if ("problem" in resolved) {
      ok = false;
      lines.push(`${effect.name}: ${resolved.problem}`);
      continue;
    }
    const count = async () =>
      Number(
        (
          await deps.psql(psqlArgs(database, countSql(schema, resolved.table)))
        ).trim(),
      );
    const before = await count();
    const tsv = await deps.psql(
      psqlArgs(database, copySql(schema, resolved.table)),
    );
    const after = await count();
    const problems = verifyRowCounts({ before, after, tsv: countTsvRows(tsv) });
    if (problems.length) {
      ok = false;
      lines.push(...problems.map((problem) => `${effect.name}: ${problem}`));
      continue;
    }
    await deps.writeTsv(effect.file, tsv);
    lines.push(
      `${effect.name}: ${countTsvRows(tsv)} rows -> ${effect.file} (table counted ${before} before, ${after} after)`,
    );
  }
  return { ok, lines };
}

const run = promisify(execFile);

function flags(args: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index] as string;
    if (name === "--run") found.set(name, "1");
    else if (name.startsWith("--") && args[index + 1] !== undefined)
      found.set(name, args[(index += 1)] as string);
    else throw new Error(`Unexpected argument: ${name}`);
  }
  return found;
}

async function main(args: readonly string[]): Promise<number> {
  const given = flags(args);
  const source = given.get("--source") as EffectSource | undefined;
  if (!source || !(source in SOURCE_DATABASES))
    throw new Error(
      "Usage: effect-cache-export.ts --source indexer-1|pro-indexer|trade-indexer [--database NAME] [--schema xoox] [--chain 10143] [--out .envio/cache] [--run]",
    );
  const database = given.get("--database");
  const plan = planExport({
    source,
    chainId: Number(given.get("--chain") ?? 10143),
    schema: given.get("--schema") ?? "xoox",
    outRoot: given.get("--out") ?? ".envio/cache",
    ...(database ? { database } : {}),
  });
  if (!given.has("--run")) {
    console.log(
      `Plan (add --run to execute): database ${plan.database}, schema ${plan.schema}`,
    );
    for (const effect of plan.effects)
      console.log(`  ${copySql(plan.schema, effect.table)}  >  ${effect.file}`);
    return 0;
  }
  const result = await runExport(plan, {
    psql: async (psqlArguments) =>
      (
        await run("psql", [...psqlArguments], {
          env: psqlEnv(process.env),
          maxBuffer: 1 << 30,
          encoding: "utf8",
        })
      ).stdout,
    writeTsv: async (path, text) => {
      await mkdir(posix.dirname(path), { recursive: true });
      await writeFile(`${path}.partial`, text, { mode: 0o600 });
      await rename(`${path}.partial`, path);
    },
  });
  for (const line of result.lines) console.log(line);
  return result.ok ? 0 : 1;
}

if (isEntry(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // psql errors can carry connection details; print only the message's first line.
      console.error(
        error instanceof Error
          ? (error.message.split("\n")[0] ?? "Export failed.")
          : "Export failed.",
      );
      process.exitCode = 1;
    },
  );
}
