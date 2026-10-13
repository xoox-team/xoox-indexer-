import { isAbsolute } from "node:path";

/**
 * Launch guard checks for the single xoox-one Envio indexer (plan 3.7). launch-guard.ts is the command; this module
 * holds everything it runs so that importing it can never start a check by accident, and so the command has no
 * entry condition that could skip main(). A non-zero exit of the command means "do not start". Envio calls
 * `clear_metadata` on its Hasura endpoint when it initializes a fresh database, and the compose default for that
 * endpoint is the LIVE Hasura, so the guard refuses unless all of these hold:
 *   - ENVIO_PG_DATABASE matches xoox_one_* and ENVIO_PG_SCHEMA is xoox;
 *   - HASURA_GRAPHQL_ENDPOINT is http(s)://xoox-one-hasura[:port]/v1/metadata (Envio slices that suffix off, Env.res);
 *   - ENVIO_CONFIG is an absolute path (Envio resolves a relative one against its project directory, the lint
 *     against the guard's directory) and INDEXER_CONTRACT_RPC_URL is set (the Royalty and TradeDex effects read it
 *     lazily from the process env; the config lint requires it to equal rpc[0].url);
 *   - that Hasura sits on ENVIO_PG_DATABASE and, until Envio has initialized the database, tracks 0 tables;
 *   - every live Hasura endpoint passed in rejects the new admin secret (HTTP 401, or Hasura v2's GraphQL
 *     reply: HTTP 200 whose only errors are code access-denied);
 *     the list may be empty only once Envio has initialized the database (clear_metadata runs on that first
 *     initialize only), so the old live stack can be retired;
 *   - the frozen config passes scripts/config-lint-lib.ts (lintConfig(path, { env }): string[]).
 *
 * The guard validates the process environment it runs in, so it must run in the same process tree that starts Envio:
 * scripts/launch.sh does that, and is the only way the indexer image starts.
 *
 * Usage (from the xoox-one web network, secrets only in env, nothing is printed but reasons):
 *   ENVIO_PG_DATABASE=xoox_one_<date> ENVIO_PG_SCHEMA=xoox ENVIO_CONFIG=<absolute frozen json> \
 *   HASURA_GRAPHQL_ENDPOINT=http://xoox-one-hasura:8080/v1/metadata HASURA_GRAPHQL_ADMIN_SECRET=<new secret> \
 *   INDEXER_CONTRACT_RPC_URL=<rpc[0].url> \
 *   XOOX_ONE_LIVE_HASURA_ENDPOINTS="<url> <url> ..." tsx scripts/launch-guard.ts [--live-hasura <url> ...]
 *
 * No request is sent (and the secret goes nowhere) until the static environment checks pass.
 */
export const XOOX_ONE_DATABASE = /^xoox_one_[0-9a-z_]+$/;
export const XOOX_ONE_SCHEMA = "xoox";
export const XOOX_ONE_HASURA_HOST = "xoox-one-hasura";
const METADATA_PATH = "/v1/metadata";
const REQUEST_TIMEOUT_MS = 15_000;

export type GuardEnv = Readonly<Record<string, string | undefined>>;
export type GuardReport = Readonly<{
  ok: boolean;
  failures: readonly string[];
}>;
export type GuardDeps = Readonly<{
  fetch: typeof fetch;
  lintConfig: (
    path: string,
    options: Readonly<{ env: GuardEnv }>,
  ) => readonly string[] | Promise<readonly string[]>;
}>;
export type HasuraState = Readonly<{
  trackedTables: number;
  database: string;
  initialized: boolean;
}>;
export type LiveProbe = Readonly<{
  host: string;
  status: number | null;
  /** The body is Hasura's access-denied error: /v1/graphql rejects a wrong admin secret with HTTP 200. */
  denied?: boolean;
}>;

function parseHttpUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export function checkStaticEnv(env: GuardEnv): string[] {
  const failures: string[] = [];
  if (!XOOX_ONE_DATABASE.test(env["ENVIO_PG_DATABASE"] ?? ""))
    failures.push(
      "ENVIO_PG_DATABASE must match ^xoox_one_[0-9a-z_]+$ so no retained database can be reset.",
    );
  if (env["ENVIO_PG_SCHEMA"] !== XOOX_ONE_SCHEMA)
    failures.push(`ENVIO_PG_SCHEMA must be ${XOOX_ONE_SCHEMA}.`);
  const endpoint = parseHttpUrl(env["HASURA_GRAPHQL_ENDPOINT"]);
  if (
    !endpoint ||
    endpoint.hostname !== XOOX_ONE_HASURA_HOST ||
    endpoint.pathname !== METADATA_PATH ||
    endpoint.search ||
    endpoint.hash
  )
    failures.push(
      `HASURA_GRAPHQL_ENDPOINT must be http(s)://${XOOX_ONE_HASURA_HOST}[:port]${METADATA_PATH} without credentials; the live Hasura would lose its metadata.`,
    );
  if (!env["HASURA_GRAPHQL_ADMIN_SECRET"])
    failures.push("HASURA_GRAPHQL_ADMIN_SECRET is not set.");
  if (!env["ENVIO_CONFIG"]) failures.push("ENVIO_CONFIG is not set.");
  else if (!isAbsolute(env["ENVIO_CONFIG"]))
    failures.push(
      "ENVIO_CONFIG must be an absolute path: Envio resolves a relative one against its project directory, the lint against the guard's.",
    );
  if (!env["INDEXER_CONTRACT_RPC_URL"])
    failures.push(
      "INDEXER_CONTRACT_RPC_URL is not set; the Royalty and TradeDex effects read it from the process env and it must equal rpc[0].url.",
    );
  return failures;
}

/** Endpoints from repeated `--live-hasura <url>` / `--live-hasura=<url>` flags, then a comma or whitespace separated env value. */
export function parseLiveEndpoints(
  args: readonly string[],
  envValue: string | undefined,
): string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--live-hasura" && args[index + 1] !== undefined)
      found.push(args[(index += 1)] as string);
    else if (arg.startsWith("--live-hasura="))
      found.push(arg.slice("--live-hasura=".length));
  }
  return [...found, ...(envValue ?? "").split(/[\s,]+/).filter(Boolean)];
}

export function checkLiveEndpointList(
  live: readonly string[],
  endpoint: string,
): string[] {
  if (!live.length)
    return [
      "No live Hasura endpoint was passed; the 401 check must cover every live Hasura (--live-hasura or XOOX_ONE_LIVE_HASURA_ENDPOINTS).",
    ];
  const own = parseHttpUrl(endpoint)?.host;
  return live.flatMap((entry, index) => {
    const url = parseHttpUrl(entry);
    // The entry may hold credentials or be a bare secret, so it is named by its position and never echoed.
    if (!url)
      return [
        `Live Hasura endpoint #${index + 1} is not a plain http(s) URL without credentials.`,
      ];
    if (url.hostname === XOOX_ONE_HASURA_HOST || url.host === own)
      return [
        `Live Hasura list contains the xoox-one Hasura (${url.host}); pass only the old live ones.`,
      ];
    return [];
  });
}

export function checkHasuraState(
  state: HasuraState,
  expectedDatabase: string,
): string[] {
  if (state.database !== expectedDatabase)
    return [
      `${XOOX_ONE_HASURA_HOST} sits on a different database than ENVIO_PG_DATABASE (${state.database}).`,
    ];
  if (!state.initialized && state.trackedTables > 0)
    return [
      `${XOOX_ONE_HASURA_HOST} already has ${state.trackedTables} tracked tables on a database Envio has not initialized; Envio would run clear_metadata on a Hasura that serves something else.`,
    ];
  return [];
}

export function checkLiveStatuses(probes: readonly LiveProbe[]): string[] {
  return probes.flatMap(({ host, status, denied }) => {
    if (status === 401 || (status === 200 && denied === true)) return [];
    if (status === null)
      return [
        `${host} could not be reached, so it is not proven to reject the new admin secret.`,
      ];
    if (status >= 200 && status < 300)
      return [
        `${host} accepts the new admin secret (HTTP ${status}); expected 401.`,
      ];
    return [
      `${host} returned HTTP ${status} for the new admin secret; expected 401.`,
    ];
  });
}

type Reply = Readonly<{ status: number; json: unknown }> | undefined;

async function post(
  deps: GuardDeps,
  url: string,
  secret: string,
  body: unknown,
): Promise<Reply> {
  try {
    const response = await deps.fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-hasura-admin-secret": secret,
        "x-hasura-role": "admin",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { status: response.status, json };
  } catch {
    return undefined;
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function countTrackedTables(json: unknown): number | undefined {
  const root = record(json);
  const metadata = record(root?.["metadata"]) ?? root;
  const sources = metadata?.["sources"];
  if (!Array.isArray(sources)) return undefined;
  let total = 0;
  for (const source of sources) {
    const tables = record(source)?.["tables"];
    if (tables !== undefined && !Array.isArray(tables)) return undefined;
    total += tables?.length ?? 0;
  }
  return total;
}

const DATABASE_STATE_SQL =
  `SELECT current_database(), (SELECT count(*) FROM information_schema.tables WHERE table_schema = '${XOOX_ONE_SCHEMA}' ` +
  "AND table_name IN ('envio_chains', 'event_sync_state'))::int";

function parseDatabaseState(
  json: unknown,
): { database: string; initialized: boolean } | undefined {
  const rows = record(json)?.["result"];
  const row = Array.isArray(rows) ? rows[1] : undefined;
  if (
    !Array.isArray(row) ||
    typeof row[0] !== "string" ||
    !Number.isFinite(Number(row[1]))
  )
    return undefined;
  return { database: row[0], initialized: Number(row[1]) > 0 };
}

async function readHasuraState(
  deps: GuardDeps,
  endpoint: URL,
  secret: string,
  expectedDatabase: string,
): Promise<{ failures: string[]; initialized: boolean }> {
  const metadata = await post(deps, endpoint.href, secret, {
    type: "export_metadata",
    version: 2,
    args: {},
  });
  const trackedTables =
    metadata?.status === 200 ? countTrackedTables(metadata.json) : undefined;
  if (trackedTables === undefined)
    return {
      failures: [
        `export_metadata on ${endpoint.host} failed or returned an unreadable shape; cannot count tracked tables.`,
      ],
      initialized: false,
    };
  const state = await post(deps, new URL("/v2/query", endpoint).href, secret, {
    type: "run_sql",
    args: {
      source: "default",
      sql: DATABASE_STATE_SQL,
      read_only: true,
      cascade: false,
    },
  });
  const database =
    state?.status === 200 ? parseDatabaseState(state.json) : undefined;
  if (!database)
    return {
      failures: [
        `run_sql on ${endpoint.host} failed or returned an unreadable shape; cannot read the database state.`,
      ],
      initialized: false,
    };
  const failures = checkHasuraState({ trackedTables, ...database }, expectedDatabase);
  return { failures, initialized: !failures.length && database.initialized };
}

/** True only when the reply has no data and every error is code access-denied. */
function isAccessDenied(json: unknown): boolean {
  const body = record(json);
  if (!body || body.data !== undefined || !Array.isArray(body.errors))
    return false;
  return (
    body.errors.length > 0 &&
    body.errors.every(
      (error) => record(record(error)?.extensions)?.code === "access-denied",
    )
  );
}

/** A live Hasura is probed on its GraphQL endpoint, which every Hasura serves; the metadata API may be disabled. */
function liveProbeUrl(entry: string): URL {
  const url = new URL(entry);
  return new URL("/v1/graphql", url);
}

async function probeLive(
  deps: GuardDeps,
  entry: string,
  secret: string,
): Promise<LiveProbe> {
  const url = liveProbeUrl(entry);
  const reply = await post(deps, url.href, secret, { query: "{ __typename }" });
  return {
    host: url.host,
    status: reply?.status ?? null,
    denied: reply ? isAccessDenied(reply.json) : false,
  };
}

async function lint(
  deps: GuardDeps,
  path: string,
  env: GuardEnv,
): Promise<string[]> {
  try {
    const problems = await deps.lintConfig(path, { env });
    return problems.map((problem) => `config lint: ${problem}`);
  } catch (error) {
    return [
      `config lint could not run: ${error instanceof Error ? error.message : "unknown error"}`,
    ];
  }
}

function redact(text: string, secret: string): string {
  return secret ? text.replaceAll(secret, "[redacted]") : text;
}

export async function runLaunchGuard(
  input: Readonly<{ env: GuardEnv; liveEndpoints: readonly string[] }>,
  deps: GuardDeps,
): Promise<GuardReport> {
  const { env } = input;
  const secret = env["HASURA_GRAPHQL_ADMIN_SECRET"] ?? "";
  const endpointText = env["HASURA_GRAPHQL_ENDPOINT"] ?? "";
  // An empty live list is allowed only after Envio has initialized the database: clear_metadata runs only on that
  // first initialize, so the old live Hasuras can then be retired. Before it, or when the state is unreadable, refuse.
  const deferEmptyList = input.liveEndpoints.length === 0;
  const failures = [
    ...checkStaticEnv(env),
    ...(deferEmptyList
      ? []
      : checkLiveEndpointList(input.liveEndpoints, endpointText)),
  ];
  const endpoint = parseHttpUrl(endpointText);
  if (!failures.length && endpoint) {
    const [state, probes] = await Promise.all([
      readHasuraState(
        deps,
        endpoint,
        secret,
        env["ENVIO_PG_DATABASE"] as string,
      ),
      Promise.all(
        input.liveEndpoints.map((entry) => probeLive(deps, entry, secret)),
      ),
    ]);
    failures.push(...state.failures, ...checkLiveStatuses(probes));
    if (deferEmptyList && !state.initialized)
      failures.push(...checkLiveEndpointList([], endpointText));
  } else if (deferEmptyList)
    failures.push(...checkLiveEndpointList([], endpointText));
  failures.push(...(await lint(deps, env["ENVIO_CONFIG"] ?? "", env)));
  const clean = failures.map((failure) => redact(failure, secret));
  return { ok: clean.length === 0, failures: clean };
}
