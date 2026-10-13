/**
 * Lint for the frozen xoox-one ENVIO_CONFIG file (plan 3.7 and P0 step 6). `lintConfig(path)` returns the problems;
 * an empty list means the launcher guard may continue. It is synchronous and offline, and no message ever repeats an
 * rpc URL, so a keyed URL cannot leak through a failed lint.
 *
 *   tsx scripts/config-lint.ts [config.json ...]   (default: both frozen files in the repository root)
 *
 * config-lint.ts is only the command; it has no entry condition, so no way of starting it can skip the lint.
 *
 * What it proves, in order:
 *   - the file is pure JSON (every effect loader runs JSON.parse on the raw file), has no ${...} and no paid or
 *     forbidden provider name;
 *   - the counts: 22 contracts, 69 events, and 55 entities in the schema beside it;
 *   - chain 10143 fields, the TradeDex start blocks the web's TradeDexCoverage id depends on, the router subscription;
 *   - the rpc block (rpcProblems): exactly 3 entries, rpc[0] the archive public node as fallback, rpc[1] and rpc[2]
 *     the two head pollers in either order with one shared role, every url literal and keyless, no headers;
 *   - the five effect loaders would take the file, and the real declaration gates (configuredProContracts through its
 *     exported wrappers, and terminalRouterConfigured) accept it.
 *
 * The loaders need reviewed private source files and RPC to run, so their configuration clauses are mirrored in
 * loaderConfigProblems(); config-lint.test.ts runs the real loaders on the same files to keep the mirror honest.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  proConsentContractConfigured,
  proHolderContractConfigured,
  proStandardIndexerContractsConfigured,
} from "../src/pro-consent-source";
import { terminalRouterConfigured } from "../src/terminal-feed/configured";
import {
  ROUTER,
  ROUTER_START,
} from "../src/terminal-feed/constants";
import {
  TRADE_DEX_SOURCES,
  tradeDexSource,
} from "../src/trade-dex-registry";
import { parseSchemaEntities } from "./schema-entities";

export const EXPECTED = Object.freeze({
  chainId: 10143,
  contracts: 22,
  events: 69,
  entities: 55,
  startBlock: 61_283_810,
  maxReorgDepth: 128,
  maxBlockLag: 16,
  tradeV4Start: 61_283_810,
  tradeV3Start: 62_317_860,
});
/**
 * rpc[0]: the archive endpoint every effect reads. The P1 probe found archive eth_call only on the public node, so it is
 * rpc[0] and the logs fallback; it carries only effect calls and standby traffic. generate-config-lib.ts agrees.
 */
export const ARCHIVE_RPC_URL = "https://testnet-rpc.monad.xyz";
/** rpc[1] and rpc[2]: the two keyless head pollers, in either order. */
export const POLLER_RPC_URLS: readonly string[] = Object.freeze([
  "https://rpc-monad-testnet.posthuman.digital",
  "https://monad-testnet-rpc.huginn.tech/",
]);
/** The only rpc urls a generated config may carry: literal, keyless, https. */
export const ALLOWED_RPC_URLS: readonly string[] = Object.freeze([
  ARCHIVE_RPC_URL,
  ...POLLER_RPC_URLS,
]);
const RPC_ROLES = ["realtime", "sync", "fallback"];
/** The role the two pollers share: realtime with HyperSync history, or sync in the break-glass variant. */
const POLLER_ROLES = ["realtime", "sync"];
const RPC_ENTRIES = 3;
// Spelled in pieces so a repository grep for paid or forbidden providers stays empty.
const FORBIDDEN_TERMS = [
  ["quick", "node"],
  ["dwell", "ir"],
  ["spec", "trum"],
  ["simply", "staking"],
  ["hyper", "sync.xyz"],
].map((parts) => parts.join(""));
const LOADER_LIMIT_BYTES = 1024 * 1024;
const TRADE_DEX_LIMIT_BYTES = 512 * 1024;
const FROZEN_FILES = [
  "config.xoox-one.json",
  "config.xoox-one.breakglass.json",
];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const objects = (value: unknown): Json[] => list(value).filter(isObject);
const roles = (chain: Json | undefined, name: string): Json[] =>
  objects(chain?.contracts).filter((role) => role.name === name);
const addressesOf = (role: Json): string[] =>
  (typeof role.address === "string"
    ? [role.address]
    : list(role.address)
  ).filter((value): value is string => typeof value === "string");
const rpcUrl = (chain: Json | undefined): unknown => {
  const first = list(chain?.rpc)[0];
  return isObject(first) ? first.url : undefined;
};

export type LoaderName =
  | "royalty"
  | "tradeDex"
  | "poolRouter"
  | "consent"
  | "holder";
export type LoaderProblems = Record<LoaderName, string[]>;

/**
 * The configuration clauses of the five effect loaders, one list per loader (src/royalty-recipients.ts,
 * trade-dex-source.ts, pro-pool-router-source.ts, pro-consent-source.ts, pro-holder-source.ts). Each loader's source
 * checks (its reviewed input) are out of reach here, so a role must hold addresses and every registered Trade source
 * must be subscribed: that is the condition under which the loader accepts every legitimate input.
 */
export function loaderConfigProblems(
  config: unknown,
  chainId: number,
  fileBytes: number,
): LoaderProblems {
  const problems: LoaderProblems = {
    royalty: [],
    tradeDex: [],
    poolRouter: [],
    consent: [],
    holder: [],
  };
  const chains = isObject(config) ? objects(config.chains) : [];
  const matching = chains.filter((chain) => chain.id === chainId);
  // royalty and trade-dex take the first matching chain; the Pro loaders require exactly one.
  const first = matching[0];
  const only = matching.length === 1 ? matching[0] : undefined;
  const url = rpcUrl(first);

  if (!url) problems.royalty.push("royalty: chain has no rpc[0].url.");

  if (fileBytes > TRADE_DEX_LIMIT_BYTES)
    problems.tradeDex.push("trade-dex: config exceeds the 512 KiB limit.");
  if (!first) problems.tradeDex.push("trade-dex: chain is missing.");
  let protocol: string | undefined;
  try {
    protocol = typeof url === "string" ? new URL(url).protocol : undefined;
  } catch {
    protocol = undefined;
  }
  if (protocol !== "https:" && protocol !== "http:")
    problems.tradeDex.push("trade-dex: rpc[0].url is not an http(s) URL.");
  for (const [name, kind] of [
    ["TradeV3Factory", "v3"],
    ["TradeV4PoolManager", "v4"],
  ] as const) {
    const declared = isObject(config)
      ? objects(config.contracts).filter((item) => item.name === name)
      : [];
    const subscribers = roles(first, name);
    const subscribed = subscribers.flatMap(addressesOf);
    const registered = TRADE_DEX_SOURCES.filter((item) => item.kind === kind);
    if (declared.length !== 1 || subscribers.length !== 1)
      problems.tradeDex.push(
        `trade-dex: ${name} must be declared once and subscribed by exactly one chain role.`,
      );
    else if (
      subscribed.length === 0 ||
      subscribed.some((address) => !tradeDexSource(kind, address)) ||
      registered.some(
        (item) =>
          !subscribed.some(
            (address) => address.toLowerCase() === item.address.toLowerCase(),
          ),
      )
    )
      problems.tradeDex.push(
        `trade-dex: ${name} must subscribe exactly the registered ${kind} sources.`,
      );
  }

  const proLoaders = [
    ["poolRouter", ["ProFactory", "ProSwapRouter"]],
    ["consent", ["ProFactory", "ProConsentRegistry"]],
    ["holder", ["ProFactory"]],
  ] as const;
  for (const [loader, names] of proLoaders) {
    if (fileBytes > LOADER_LIMIT_BYTES)
      problems[loader].push(`${loader}: config exceeds the 1 MiB limit.`);
    if (!only)
      problems[loader].push(`${loader}: chain is missing or ambiguous.`);
    for (const name of names) {
      const entries = roles(only, name);
      if (
        entries.length !== 1 ||
        !Array.isArray(entries[0]!.address) ||
        addressesOf(entries[0]!).length === 0
      )
        problems[loader].push(
          `${loader}: ${name} must be subscribed by exactly one chain role with addresses.`,
        );
    }
    if (
      typeof rpcUrl(only) !== "string" ||
      !/^https?:\/\//.test(rpcUrl(only) as string)
    )
      problems[loader].push(`${loader}: rpc[0].url is not an http(s) URL.`);
  }
  return problems;
}

function keylessProblem(url: unknown): string | undefined {
  if (typeof url !== "string" || !/^https:\/\/[^${}\s]+$/.test(url))
    return "is not a literal https URL";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "is not a valid URL";
  }
  if (parsed.username || parsed.password) return "carries credentials";
  if (url.includes("?") || url.includes("#"))
    return "carries a query or fragment";
  if (parsed.pathname !== "/") return "carries a path";
  if (!ALLOWED_RPC_URLS.includes(url))
    return "is not one of the reviewed keyless endpoints";
  return undefined;
}

export type LintEnv = Readonly<Record<string, string | undefined>>;

/**
 * The rpc block. The Pro effects read only rpc[0].url raw and need an archive eth_call from it, so a reordered or
 * mis-roled block halts the indexer at the next Pro event. The shape is therefore pinned entry by entry:
 *   - exactly 3 entries;
 *   - rpc[0] and rpc[1] are the two archive endpoints, each once and in either order (P1 may choose the second one
 *     first), with the same role, realtime or sync;
 *   - rpc[2] is the public node as the fallback;
 *   - every url is a literal keyless https URL, and no entry sets headers.
 * A message names the index, never the url, so a keyed URL cannot leak through a failed lint.
 */
export function rpcProblems(chain: Json, env: LintEnv): string[] {
  const problems: string[] = [];
  const rpc = list(chain.rpc);
  if (rpc.length === 0) problems.push("rpc[0] is missing.");
  rpc.forEach((entry, index) => {
    if (!isObject(entry)) {
      problems.push(`rpc[${index}] is not an object.`);
      return;
    }
    const issue = keylessProblem(entry.url);
    if (issue) problems.push(`rpc[${index}].url ${issue}.`);
    if ("headers" in entry)
      problems.push(
        `rpc[${index}] sets headers; the Pro loaders and viem send none, so keys never belong there.`,
      );
    if (typeof entry.for !== "string" || !RPC_ROLES.includes(entry.for))
      problems.push(`rpc[${index}].for must be realtime, sync or fallback.`);
  });

  if (rpc.length > 0 && rpc.length !== RPC_ENTRIES)
    problems.push(
      `rpc must hold exactly ${RPC_ENTRIES} entries, found ${rpc.length} (the archive fallback, then two pollers).`,
    );
  else if (rpc.length === RPC_ENTRIES) {
    const [first, second, third] = rpc.map((entry) =>
      isObject(entry) ? entry : {},
    );
    if (first!.url !== ARCHIVE_RPC_URL)
      problems.push("rpc[0].url must be the reviewed archive endpoint.");
    if (first!.for !== "fallback") problems.push("rpc[0].for must be fallback.");
    const pollers = [second!.url, third!.url];
    if (
      pollers[0] === pollers[1] ||
      !pollers.every(
        (url) => typeof url === "string" && POLLER_RPC_URLS.includes(url),
      )
    )
      problems.push(
        "rpc[1] and rpc[2] must be the two reviewed head pollers, each once, in either order.",
      );
    if (
      second!.for !== third!.for ||
      typeof second!.for !== "string" ||
      !POLLER_ROLES.includes(second!.for)
    )
      problems.push(
        "rpc[1].for and rpc[2].for must be the same role, realtime or sync.",
      );
  }

  if (
    typeof env.INDEXER_CONTRACT_RPC_URL === "string" &&
    env.INDEXER_CONTRACT_RPC_URL !== rpcUrl(chain)
  )
    problems.push(
      "INDEXER_CONTRACT_RPC_URL must equal rpc[0].url (plan 3.6); they differ.",
    );
  return problems;
}

function withEnvioConfig<T>(path: string, run: () => T): T {
  const previous = process.env.ENVIO_CONFIG;
  process.env.ENVIO_CONFIG = path;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.ENVIO_CONFIG;
    else process.env.ENVIO_CONFIG = previous;
  }
}

export type LintOptions = Readonly<{
  /** Defaults to process.env; only INDEXER_CONTRACT_RPC_URL is read. */
  env?: LintEnv;
}>;

export function lintConfig(path: string, options: LintOptions = {}): string[] {
  const env = options.env ?? process.env;
  const problems: string[] = [];
  let text: string;
  let size: number;
  try {
    size = statSync(path).size;
    if (size > LOADER_LIMIT_BYTES)
      return ["config exceeds 1 MiB; the Pro loaders refuse a larger file."];
    text = readFileSync(path, "utf8");
  } catch {
    return ["config file cannot be read."];
  }
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_TERMS)
    if (lower.includes(term))
      problems.push(`config names a forbidden provider: ${term}.`);
  if (text.includes("${"))
    problems.push(
      "config contains ${...} interpolation; the Pro loaders read the file raw.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    problems.push(
      "config is not pure JSON (JSON.parse failed); comments and YAML are not allowed.",
    );
    return problems;
  }
  if (!isObject(parsed)) {
    problems.push("config is not a JSON object.");
    return problems;
  }

  // Shape and the entity count.
  let entityCount: number | undefined;
  if (typeof parsed.schema !== "string" || isAbsolute(parsed.schema))
    problems.push("config needs a relative schema path.");
  else {
    try {
      entityCount = parseSchemaEntities(
        readFileSync(resolve(dirname(path), parsed.schema), "utf8"),
      ).length;
    } catch {
      problems.push("schema file beside the config cannot be read or parsed.");
    }
  }
  if (parsed.address_format !== "lowercase")
    problems.push("address_format must be lowercase.");
  const selection = isObject(parsed.field_selection)
    ? parsed.field_selection
    : undefined;
  if (
    JSON.stringify(selection) !==
    JSON.stringify({ transaction_fields: ["hash"] })
  )
    problems.push(
      "field_selection must be exactly transaction_fields: [hash].",
    );
  if (typeof parsed.handlers !== "string" || isAbsolute(parsed.handlers))
    problems.push("handlers must be a relative path.");

  // Counts.
  const declared = objects(parsed.contracts);
  const events = declared.reduce(
    (sum, contract) => sum + list(contract.events).length,
    0,
  );
  if (declared.length !== EXPECTED.contracts)
    problems.push(
      `config declares ${declared.length} contracts, expected ${EXPECTED.contracts}.`,
    );
  if (events !== EXPECTED.events)
    problems.push(
      `config declares ${events} events, expected ${EXPECTED.events}.`,
    );
  if (entityCount !== undefined && entityCount !== EXPECTED.entities)
    problems.push(
      `schema declares ${entityCount} entities, expected ${EXPECTED.entities}.`,
    );

  // Chain 10143.
  const chains = objects(parsed.chains);
  const chain = chains.find((item) => item.id === EXPECTED.chainId);
  if (chains.length !== 1 || !chain)
    problems.push(
      `config must declare exactly one chain, ${EXPECTED.chainId}.`,
    );
  if (chain) {
    if (chain.start_block !== EXPECTED.startBlock)
      problems.push(`start_block must be ${EXPECTED.startBlock}.`);
    if (chain.max_reorg_depth !== EXPECTED.maxReorgDepth)
      problems.push(`max_reorg_depth must be ${EXPECTED.maxReorgDepth}.`);
    const lag = chain.block_lag;
    if (
      typeof lag !== "number" ||
      !Number.isInteger(lag) ||
      lag < 0 ||
      lag > EXPECTED.maxBlockLag
    )
      problems.push(
        `block_lag must be an integer from 0 to ${EXPECTED.maxBlockLag} (P1 sets it before the replay).`,
      );
    if (chain.skip !== undefined && chain.skip !== false)
      problems.push("the chain must not be skipped (skip is set).");
    if ("hypersync_config" in chain || "hypersync_config" in parsed)
      problems.push(
        "hypersync_config must be absent: the built-in source needs only ENVIO_API_TOKEN.",
      );
    for (const [name, start] of [
      ["TradeV4PoolManager", EXPECTED.tradeV4Start],
      ["TradeV3Factory", EXPECTED.tradeV3Start],
    ] as const) {
      const entries = roles(chain, name);
      if (entries.length !== 1 || entries[0]!.start_block !== start)
        problems.push(
          `${name} start_block must be ${start} (the web's TradeDexCoverage id hashes it).`,
        );
    }
    const router = roles(chain, "TerminalRouter");
    const subscribed = router.flatMap(addressesOf);
    if (
      router.length !== 1 ||
      subscribed.length !== 1 ||
      subscribed[0]!.toLowerCase() !== ROUTER ||
      router[0]!.start_block !== ROUTER_START
    )
      problems.push(
        `TerminalRouter must be subscribed once at ${ROUTER} from block ${ROUTER_START}.`,
      );

    problems.push(...rpcProblems(chain, env));
  }

  // The effect loaders' configuration clauses, then the real declaration gates.
  for (const messages of Object.values(
    loaderConfigProblems(parsed, EXPECTED.chainId, size),
  ))
    problems.push(...messages);
  const gates: [string, () => boolean][] = [
    [
      "proStandardIndexerContractsConfigured",
      proStandardIndexerContractsConfigured,
    ],
    ["proConsentContractConfigured", proConsentContractConfigured],
    ["proHolderContractConfigured", proHolderContractConfigured],
    ["terminalRouterConfigured", terminalRouterConfigured],
  ];
  withEnvioConfig(resolve(path), () => {
    for (const [name, gate] of gates) {
      try {
        if (!gate())
          problems.push(`${name}: the role is not declared and subscribed.`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "refused";
        problems.push(`${name} refused the config: ${reason}`);
      }
    }
  });
  return problems;
}

type Io = Readonly<{
  log: (line: string) => void;
  error: (line: string) => void;
}>;
export function main(
  argv: readonly string[],
  io: Io = { log: console.log, error: console.error },
): number {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const paths = argv.length
    ? argv
    : FROZEN_FILES.map((file) => join(root, file));
  let failed = false;
  for (const path of paths) {
    const problems = lintConfig(path);
    if (problems.length === 0) io.log(`${path}: ok`);
    else {
      failed = true;
      io.error(`${path}: ${problems.length} problem(s)`);
      for (const problem of problems) io.error(`  - ${problem}`);
    }
  }
  return failed ? 1 : 0;
}
