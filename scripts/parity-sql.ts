import { fileURLToPath } from "node:url";
import { isEntry } from "./is-entry";
import { quoteIdent, quoteLiteral, safeIdent } from "./pg-ident";
import {
  readSchemaEntities,
  type SchemaEntity,
  type SchemaField,
} from "./schema-entities";

/**
 * Parity SQL generator (plan P3 step 1). Emits SHORT read-only queries, one per table, block-filtered so a live
 * indexer is never held in a long transaction. Run the identical script on the canonical old database of a family and
 * on the xoox_one database, then diff the two outputs (`psql -X -A -t -F ',' -v ON_ERROR_STOP=1 -f script.sql`).
 *
 *   summary  entity, row count, digest for the whole table (one row per table)
 *   buckets  the same per md5(id) prefix (256 buckets) to localize a mismatch
 *   rows     id and row hash of chosen buckets, to find the differing rows
 *
 * The digest is the sum of the first 64 bits of sha256(row as jsonb array), so it needs no sort and no giant
 * string_agg on a live table. Event tables are filtered by blockNumber <= B, created-block tables by their creation
 * block, state tables are compared whole (a persistent diff over three runs is what counts, plan P3 gate).
 */
export type ParityFamily = "legacy" | "pro" | "tradeDex" | "tradeFeed";
export type ParityMode = "summary" | "buckets" | "rows";
export type TableKind = "event" | "created" | "state";
export type Pin = Readonly<{ blockNumber: bigint; blockTimestamp: bigint }>;
export type TablePlan = Readonly<{
  entity: string;
  family: ParityFamily;
  kind: TableKind;
  columns: readonly string[];
  excluded: readonly string[];
  predicates: readonly string[];
}>;

/** Canonical source per family (plan 3.1, 3.3 and appendix A); shown in the script header only. */
export const FAMILY_SOURCES: Readonly<
  Record<ParityFamily, { service: string; database: string }>
> = {
  legacy: { service: "indexer-1", database: "envio-dev" },
  pro: { service: "pro-indexer", database: "xoox_pro_source" },
  tradeDex: { service: "trade-indexer", database: "xoox_trade_source" },
  tradeFeed: {
    service: "terminal-feed (parity.ts is the tie-breaker)",
    database: "xoox_terminal_source",
  },
};

/** Time-dependent columns: the TradeDex metadata effect is minute-bucketed and re-read at replay time (plan P3 step 1). */
const TIME_DEPENDENT: Readonly<Record<string, readonly string[]>> = {
  TradeDexToken: ["name", "symbol", "decimals", "status", "updatedAt"],
  TradeDexCoverage: ["firstObservedBlock", "lastObservedBlock", "updatedAt"],
};
const CREATION_BLOCK_COLUMNS = [
  "createdBlock",
  "registeredBlock",
  "observedBlock",
] as const;
const MAX_HASHED_COLUMNS = 99; // jsonb_build_array is capped at 100 arguments
const BUCKET = /^[0-9a-f]{2}$/;
const SET_UP = [
  "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;",
  "SET statement_timeout = '120s';",
  "SET lock_timeout = '2s';",
];

export function familyOf(entity: string): ParityFamily {
  if (entity === "TradeFeed") return "tradeFeed";
  if (/^TradeDex[A-Z]/.test(entity)) return "tradeDex";
  if (/^Pro[A-Z]/.test(entity)) return "pro";
  return "legacy";
}

function predicates(
  entity: SchemaEntity,
  kind: TableKind,
  creation: SchemaField | undefined,
  pin: Pin,
): string[] {
  const block = pin.blockNumber.toString();
  const timestamp = pin.blockTimestamp.toString();
  if (entity.name === "MarketSecond")
    return [`${quoteIdent("timestamp")} < ${timestamp}`];
  if (entity.name === "HourCandle")
    return [`${quoteIdent("bucketStart")} + 3600 <= ${timestamp}`];
  if (kind === "event") return [`${quoteIdent("blockNumber")} <= ${block}`];
  if (kind === "created" && creation) {
    const column = quoteIdent(creation.name);
    // A nullable creation block must not drop its rows from the comparison.
    return [
      creation.required
        ? `${column} <= ${block}`
        : `(${column} IS NULL OR ${column} <= ${block})`,
    ];
  }
  return [];
}

export function planTable(
  entity: SchemaEntity,
  pin: Pin,
  extraExcluded: Readonly<Record<string, readonly string[]>> = {},
): TablePlan {
  if (pin.blockNumber < 0n || pin.blockTimestamp < 0n)
    throw new Error(
      "Invalid parity pin: block and timestamp must be non-negative.",
    );
  const names = new Set(entity.fields.map((field) => safeIdent(field.name)));
  const extra = extraExcluded[entity.name] ?? [];
  for (const column of extra) {
    if (column === "id")
      throw new Error(`Cannot exclude the id column of ${entity.name}.`);
    if (!names.has(column))
      throw new Error(`${entity.name} has no column ${column} to exclude.`);
  }
  const excluded = [...(TIME_DEPENDENT[entity.name] ?? []), ...extra].filter(
    (column) => names.has(column),
  );
  const columns = entity.fields
    .map((field) => field.name)
    .filter((name) => !excluded.includes(name));
  if (columns.length > MAX_HASHED_COLUMNS)
    throw new Error(
      `${entity.name} hashes ${columns.length} columns; the limit is ${MAX_HASHED_COLUMNS}.`,
    );
  const creation = entity.fields.find((field) =>
    (CREATION_BLOCK_COLUMNS as readonly string[]).includes(field.name),
  );
  const kind: TableKind = names.has("blockNumber")
    ? "event"
    : creation
      ? "created"
      : "state";
  return {
    entity: safeIdent(entity.name),
    family: familyOf(entity.name),
    kind,
    columns,
    excluded,
    predicates: predicates(entity, kind, creation, pin),
  };
}

const rowHash = (columns: readonly string[]) =>
  `substr(encode(sha256(convert_to(jsonb_build_array(${columns.map(quoteIdent).join(", ")})::text, 'UTF8')), 'hex'), 1, 16)`;
const BUCKET_OF_ID = `substr(md5(${quoteIdent("id")}), 1, 2)`;
const from = (plan: TablePlan, schema: string) =>
  `FROM ${quoteIdent(safeIdent(schema))}.${quoteIdent(plan.entity)}`;
const where = (conditions: readonly string[]) =>
  conditions.length ? `\nWHERE ${conditions.join(" AND ")}` : "";
const digest = (plan: TablePlan) =>
  `coalesce(sum(('x' || ${rowHash(plan.columns)})::bit(64)::bigint::numeric), 0) AS digest`;

export function summarySql(plan: TablePlan, schema: string): string {
  return `SELECT ${quoteLiteral(plan.entity)} AS entity, count(*) AS n, ${digest(plan)}\n${from(plan, schema)}${where(plan.predicates)};`;
}

export function bucketsSql(plan: TablePlan, schema: string): string {
  return (
    `SELECT ${quoteLiteral(plan.entity)} AS entity, ${BUCKET_OF_ID} AS bucket, count(*) AS n, ${digest(plan)}\n` +
    `${from(plan, schema)}${where(plan.predicates)}\nGROUP BY 2 ORDER BY 2;`
  );
}

export function rowsSql(
  plan: TablePlan,
  schema: string,
  buckets: readonly string[],
): string {
  if (!buckets.length || buckets.some((bucket) => !BUCKET.test(bucket)))
    throw new Error(
      "Row drilldown needs one or more two-digit hex bucket names.",
    );
  const pick = `${BUCKET_OF_ID} IN (${buckets.map(quoteLiteral).join(", ")})`;
  return (
    `SELECT ${quoteLiteral(plan.entity)} AS entity, ${quoteIdent("id")}, ${rowHash(plan.columns)} AS row_hash\n` +
    `${from(plan, schema)}${where([...plan.predicates, pick])}\nORDER BY ${quoteIdent("id")};`
  );
}

export type ParityOptions = Readonly<{
  pin: Pin;
  family: ParityFamily;
  mode: ParityMode;
  /** The schema on the side the script is generated for. */
  schema: string;
  /** Which database the script is for; only the header differs. Default source. */
  side?: "source" | "target";
  entityName?: string;
  buckets?: readonly string[];
  exclude?: Readonly<Record<string, readonly string[]>>;
}>;

export function paritySql(
  entities: readonly SchemaEntity[],
  options: ParityOptions,
): string {
  const { pin, family, mode, schema } = options;
  const chosen = entities.filter((entity) => familyOf(entity.name) === family);
  if (
    options.entityName &&
    !chosen.some((entity) => entity.name === options.entityName)
  )
    throw new Error(
      `${options.entityName} is not an entity of family ${family}.`,
    );
  if (mode === "rows" && !options.entityName)
    throw new Error("The rows mode needs one entity (--entity).");
  const plans = chosen
    .filter(
      (entity) => !options.entityName || entity.name === options.entityName,
    )
    .map((entity) => planTable(entity, pin, options.exclude));
  const build = (plan: TablePlan) =>
    mode === "summary"
      ? summarySql(plan, schema)
      : mode === "buckets"
        ? bucketsSql(plan, schema)
        : rowsSql(plan, schema, options.buckets ?? []);
  const source = FAMILY_SOURCES[family];
  const runOn =
    options.side === "target"
      ? "the xoox_one database"
      : `${source.service} (database ${source.database})`;
  return [
    `-- xoox-one parity, family ${family}, mode ${mode}: rows filtered to block <= ${pin.blockNumber} (closed time buckets before ${pin.blockTimestamp}).`,
    `-- Run this script on ${runOn}, schema ${schema}, and diff its output with the other side's.`,
    ...plans.flatMap((plan) =>
      plan.excluded.length
        ? [
            `-- ${plan.entity}: columns left out of the hash: ${plan.excluded.join(", ")}.`,
          ]
        : [],
    ),
    ...SET_UP,
    ...plans.map(build),
    "",
  ].join("\n");
}

const DEFAULT_SCHEMA_FILES = [
  fileURLToPath(
    new URL("../schema.graphql", import.meta.url),
  ),
  fileURLToPath(
    new URL(
      "../test-fixtures/terminal-feed/schema.graphql",
      import.meta.url,
    ),
  ),
];

function flags(args: readonly string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index] as string;
    const value = args[index + 1];
    if (!name.startsWith("--") || value === undefined)
      throw new Error(`Unexpected argument: ${name}`);
    found.set(name, [...(found.get(name) ?? []), value]);
  }
  return found;
}

function main(args: readonly string[]): void {
  const given = flags(args);
  const one = (name: string) => given.get(name)?.[0];
  const family = one("--family") as ParityFamily | undefined;
  if (
    !family ||
    !(family in FAMILY_SOURCES) ||
    !one("--block") ||
    !one("--timestamp")
  )
    throw new Error(
      "Usage: parity-sql.ts --family legacy|pro|tradeDex|tradeFeed --block <B> --timestamp <block B timestamp> " +
        "[--side source|target] [--source-schema xoox] [--target-schema xoox] [--mode summary|buckets|rows] [--entity Name] " +
        "[--buckets 0a,f3] [--schema-file path ...] [--exclude Entity.column ...]",
    );
  const mode = (one("--mode") ?? "summary") as ParityMode;
  if (!["summary", "buckets", "rows"].includes(mode))
    throw new Error("--mode must be summary, buckets or rows.");
  const side = one("--side") ?? "source";
  if (side !== "source" && side !== "target")
    throw new Error("--side must be source or target.");
  const exclude: Record<string, string[]> = {};
  for (const item of given.get("--exclude") ?? []) {
    const [entity, column] = item.split(".");
    if (!entity || !column) throw new Error("--exclude takes Entity.column.");
    exclude[entity] = [...(exclude[entity] ?? []), column];
  }
  const entities = readSchemaEntities(
    given.get("--schema-file") ?? DEFAULT_SCHEMA_FILES,
  );
  process.stdout.write(
    paritySql(entities, {
      pin: {
        blockNumber: BigInt(one("--block") as string),
        blockTimestamp: BigInt(one("--timestamp") as string),
      },
      family,
      mode,
      side,
      schema:
        (side === "source" ? one("--source-schema") : one("--target-schema")) ??
        "xoox",
      ...(one("--entity") ? { entityName: one("--entity") as string } : {}),
      ...(one("--buckets")
        ? { buckets: (one("--buckets") as string).split(",") }
        : {}),
      exclude,
    }),
  );
}

if (isEntry(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Parity SQL generation failed.",
    );
    process.exitCode = 1;
  }
}
