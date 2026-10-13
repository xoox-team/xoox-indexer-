import { readFileSync } from "node:fs";
import { isEntry } from "./is-entry";

/**
 * Backfill estimator (plan 2.8 and P1 step 3). The HyperSync budget belongs to the token: `x-ratelimit-limit` units per
 * window (60 s), each query costs `x-ratelimit-cost` units, and a 429 only slows a backfill down. This sends a few
 * representative queries over one block window (for example 100k blocks of: the static contract set, the Token
 * Transfer partition, the V4 PoolManager Swap), reads the cost header of each, and extrapolates the whole backfill.
 *
 *   ENVIO_HYPERSYNC_URL=<https origin of the HyperSync endpoint for chain 10143, no path> ENVIO_API_TOKEN=<token> \
 *   tsx scripts/backfill-estimator.ts --queries queries.json --start 61283810 --head <current head> \
 *                                              [--from 69000000] [--blocks 100000] [--concurrency 1]
 *   queries.json: [{"label":"static set","addresses":["0x..."],"coverage":1},
 *                  {"label":"v4 swaps","addresses":["0x..."],"topics":[["0x<Swap topic0>"]],"coverage":1}, ...]
 *
 * `coverage` is the share of [start, head] a partition spans (1 for static contracts, less for contracts that appear
 * later). The token is read from the environment, sent only as the Authorization header, and never printed.
 * One request at a time; on a 429 it stops and says when the window resets.
 */
export type RateLimit = Readonly<{
  limit: number;
  remaining: number;
  reset: number;
  cost: number;
}>;
export type Sample = Readonly<{
  label: string;
  fromBlock: number;
  toBlock: number;
  nextBlock?: number;
  cost: number;
  elapsedMs: number;
  coverage?: number;
}>;
export type EstimateOptions = Readonly<{
  startBlock: number;
  headBlock: number;
  limit: number;
  windowSeconds?: number;
  concurrency?: number;
}>;
export type Estimate = Readonly<{
  totalBlocks: number;
  totalCost: number;
  totalQueries: number;
  windows: number;
  rateBoundSeconds: number;
  latencyBoundSeconds: number;
  estimateSeconds: number;
  perSample: readonly {
    label: string;
    blocks: number;
    cost: number;
    elapsedMs: number;
    costPer100kBlocks: number;
  }[];
}>;
export type QuerySpec = Readonly<{
  label: string;
  addresses: readonly string[];
  topics?: readonly (readonly string[])[];
  coverage?: number;
}>;
export type Window = Readonly<{
  startBlock: number;
  headBlock: number;
  fromBlock: number;
  blocks: number;
}>;
export type Config = Readonly<{ origin: string; token: string }>;
export type EstimateDeps = Readonly<{ fetch: typeof fetch; now: () => number }>;

const HEADERS = [
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-cost",
] as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TOPIC = /^0x[0-9a-fA-F]{64}$/;

export function parseRateLimitHeaders(headers: Headers): RateLimit {
  const values = HEADERS.map((name) => {
    const raw = headers.get(name);
    return raw !== null &&
      raw.trim() !== "" &&
      Number.isFinite(Number(raw)) &&
      Number(raw) >= 0
      ? Number(raw)
      : undefined;
  });
  const bad = HEADERS.filter((_, index) => values[index] === undefined);
  if (bad.length)
    throw new Error(
      `Missing or malformed rate limit headers: ${bad.join(", ")}.`,
    );
  const [limit, remaining, reset, cost] = values as [
    number,
    number,
    number,
    number,
  ];
  return { limit, remaining, reset, cost };
}

export function blocksCovered(
  range: Readonly<{ fromBlock: number; toBlock: number; nextBlock?: number }>,
): number {
  const end =
    range.nextBlock === undefined
      ? range.toBlock
      : Math.min(range.nextBlock, range.toBlock);
  if (end <= range.fromBlock)
    throw new Error("The response made no progress through the block range.");
  return end - range.fromBlock;
}

export function estimateBackfill(
  samples: readonly Sample[],
  options: EstimateOptions,
): Estimate {
  const { startBlock, headBlock, limit } = options;
  const windowSeconds = options.windowSeconds ?? 60;
  const concurrency = options.concurrency ?? 1;
  if (!samples.length) throw new Error("At least one sample query is needed.");
  if (headBlock <= startBlock)
    throw new Error("The head block must be above the start block.");
  if (!(limit > 0)) throw new Error("The x-ratelimit-limit must be positive.");
  if (!(concurrency >= 1)) throw new Error("Concurrency must be at least 1.");
  const totalBlocks = headBlock - startBlock;
  let totalCost = 0;
  let totalQueries = 0;
  let latencySeconds = 0;
  const perSample = samples.map((sample) => {
    if (!(sample.cost > 0))
      throw new Error(
        `Sample "${sample.label}" has no positive x-ratelimit-cost.`,
      );
    const blocks = blocksCovered(sample);
    const spanned = totalBlocks * (sample.coverage ?? 1);
    const queries = Math.ceil(spanned / blocks);
    totalCost += (sample.cost / blocks) * spanned;
    totalQueries += queries;
    latencySeconds += (queries * sample.elapsedMs) / 1000;
    return {
      label: sample.label,
      blocks,
      cost: sample.cost,
      elapsedMs: sample.elapsedMs,
      costPer100kBlocks: (sample.cost / blocks) * 100_000,
    };
  });
  const windows = totalCost / limit;
  const rateBoundSeconds = windows * windowSeconds;
  const latencyBoundSeconds = latencySeconds / concurrency;
  return {
    totalBlocks,
    totalCost,
    totalQueries,
    windows,
    rateBoundSeconds,
    latencyBoundSeconds,
    estimateSeconds: Math.max(rateBoundSeconds, latencyBoundSeconds),
    perSample,
  };
}

export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (whole >= 3600)
    return `${Math.floor(whole / 3600)}h ${pad(Math.floor((whole % 3600) / 60))}m`;
  if (whole >= 60) return `${Math.floor(whole / 60)}m ${pad(whole % 60)}s`;
  return `${whole}s`;
}

export function buildQuery(input: {
  fromBlock: number;
  blocks: number;
  addresses: readonly string[];
  topics?: readonly (readonly string[])[];
}) {
  if (
    !Number.isSafeInteger(input.fromBlock) ||
    !Number.isSafeInteger(input.blocks) ||
    input.fromBlock < 0 ||
    input.blocks < 1
  )
    throw new Error("Invalid block range.");
  if (
    !input.addresses.length ||
    input.addresses.some((address) => !ADDRESS.test(address))
  )
    throw new Error("Invalid contract address in the query.");
  if (
    input.topics?.some((position) =>
      position.some((topic) => !TOPIC.test(topic)),
    )
  )
    throw new Error("Invalid topic in the query.");
  return {
    from_block: input.fromBlock,
    to_block: input.fromBlock + input.blocks,
    logs: [
      {
        address: [...input.addresses],
        ...(input.topics
          ? { topics: input.topics.map((position) => [...position]) }
          : {}),
      },
    ],
    field_selection: { log: ["block_number"] },
  };
}

/** The endpoint must be a bare https origin: a token in the path, query or userinfo would be a keyed URL. */
export function readConfig(
  env: Readonly<Record<string, string | undefined>>,
): Config {
  const raw = env["ENVIO_HYPERSYNC_URL"];
  if (!raw) throw new Error("ENVIO_HYPERSYNC_URL is not set.");
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error(
      "ENVIO_HYPERSYNC_URL must be a plain https origin without path, query or credentials.",
    );
  const token = env["ENVIO_API_TOKEN"];
  if (!token) throw new Error("ENVIO_API_TOKEN is not set.");
  return { origin: url.origin, token };
}

const redact = (text: string, token: string) =>
  text.replaceAll(token, "[redacted]");

async function sample(
  config: Config,
  query: QuerySpec,
  window: Window,
  deps: EstimateDeps,
): Promise<{ sample: Sample; rate: RateLimit }> {
  const body = buildQuery({
    fromBlock: window.fromBlock,
    blocks: window.blocks,
    addresses: query.addresses,
    ...(query.topics ? { topics: query.topics } : {}),
  });
  const started = deps.now();
  let response: Response;
  try {
    response = await deps.fetch(`${config.origin}/query`, {
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new Error(
      redact(
        `HyperSync request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        config.token,
      ),
    );
  }
  const elapsedMs = deps.now() - started;
  if (response.status === 429)
    throw new Error(
      `HyperSync rate limited the token; the window resets in ${response.headers.get("x-ratelimit-reset") ?? "an unknown number of"}s. Wait and run again.`,
    );
  if (response.status === 401)
    throw new Error("HyperSync answered HTTP 401: the token was rejected.");
  if (!response.ok)
    throw new Error(`HyperSync answered HTTP ${response.status}.`);
  const rate = parseRateLimitHeaders(response.headers);
  const nextBlock = ((await response.json()) as { next_block?: unknown })
    .next_block;
  return {
    rate,
    sample: {
      label: query.label,
      fromBlock: body.from_block,
      toBlock: body.to_block,
      ...(typeof nextBlock === "number" ? { nextBlock } : {}),
      cost: rate.cost,
      elapsedMs,
      ...(query.coverage === undefined ? {} : { coverage: query.coverage }),
    },
  };
}

export async function runEstimate(
  config: Config,
  queries: readonly QuerySpec[],
  window: Window,
  deps: EstimateDeps,
  concurrency = 1,
): Promise<{ limit: number; estimate: Estimate; lines: string[] }> {
  const samples: Sample[] = [];
  const lines: string[] = [];
  let limit = 0;
  for (const query of queries) {
    const { sample: taken, rate } = await sample(config, query, window, deps);
    samples.push(taken);
    limit = rate.limit;
    lines.push(
      `${query.label}: x-ratelimit-limit ${rate.limit}, remaining ${rate.remaining}, reset ${rate.reset}s, cost ${rate.cost}, ${taken.elapsedMs} ms`,
    );
  }
  const estimate = estimateBackfill(samples, {
    startBlock: window.startBlock,
    headBlock: window.headBlock,
    limit,
    concurrency,
  });
  return { limit, estimate, lines };
}

function flags(args: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index] as string;
    const value = args[index + 1];
    if (!name.startsWith("--") || value === undefined)
      throw new Error(`Unexpected argument: ${name}`);
    found.set(name, value);
  }
  return found;
}

async function main(args: readonly string[]): Promise<void> {
  const given = flags(args);
  const queriesPath = given.get("--queries");
  const start = Number(given.get("--start"));
  const head = Number(given.get("--head"));
  if (
    !queriesPath ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(head)
  )
    throw new Error(
      "Usage: backfill-estimator.ts --queries queries.json --start <block> --head <block> [--from <block>] [--blocks 100000] [--concurrency 1]",
    );
  const queries = JSON.parse(readFileSync(queriesPath, "utf8")) as QuerySpec[];
  if (!Array.isArray(queries) || !queries.length)
    throw new Error("The queries file must hold a non-empty JSON array.");
  const window: Window = {
    startBlock: start,
    headBlock: head,
    fromBlock: Number(given.get("--from") ?? Math.max(start, head - 1_000_000)),
    blocks: Number(given.get("--blocks") ?? 100_000),
  };
  const result = await runEstimate(
    readConfig(process.env),
    queries,
    window,
    { fetch, now: () => Date.now() },
    Number(given.get("--concurrency") ?? 1),
  );
  for (const line of result.lines) console.log(line);
  const { estimate } = result;
  console.log(
    `Backfill ${start} -> ${head}: ${estimate.totalBlocks} blocks, about ${estimate.totalQueries} queries, ${Math.round(estimate.totalCost)} units ` +
      `(${estimate.windows.toFixed(1)} windows of ${result.limit}). Rate bound ${formatDuration(estimate.rateBoundSeconds)}, ` +
      `latency bound ${formatDuration(estimate.latencyBoundSeconds)}: estimate ${formatDuration(estimate.estimateSeconds)}.`,
  );
}

if (isEntry(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Backfill estimate failed.",
    );
    process.exitCode = 1;
  });
}
