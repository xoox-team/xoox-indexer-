/**
 * Generates the frozen xoox-one Envio configuration (plan 3.4):
 *
 *   envioConfiguration(deployments/10143.json, reviewed Pro sources, TerminalRouter)
 *   + the rpc overlay (two keyless realtime pollers, the public node as fallback)
 *   + the chain fields (start_block, max_reorg_depth, block_lag).
 *
 * The output is PURE JSON with no comments: every effect loader runs JSON.parse on the raw ENVIO_CONFIG file, so a
 * YAML comment would throw at startup. A second, break-glass file turns the two realtime entries into `for: sync`,
 * which makes Envio read history from them instead of HyperSync (no token, no reindex).
 *
 *   tsx scripts/generate-config.ts [--out-dir DIR] [--block-lag N] [--check]
 *
 * `--check` regenerates in memory and exits 1 if either file on disk differs, so a hand edit cannot go unnoticed.
 * block_lag is persisted by Envio and is decided once, in P1. Without --block-lag the value already in the standard
 * file is kept (the default applies only when there is none), so a re-run can never silently reset it.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  envioConfiguration,
  TERMINAL_ROUTER_SOURCE,
  type ProIndexerSource,
} from "../src/configuration";
import {
  parseDeployment,
  type Deployment,
} from "../src/vendor/xoox-sdk/config";

export const POSTHUMAN_RPC = "https://rpc-monad-testnet.posthuman.digital";
export const HUGINN_RPC = "https://monad-testnet-rpc.huginn.tech/";
export const MONAD_PUBLIC_RPC = "https://testnet-rpc.monad.xyz";

export const XOOX_ONE_NAME = "xoox-one";
export const XOOX_ONE_CHAIN_ID = 10143;
/** TradeV4PoolManager's start. The chain start may never move: the web's TradeDexCoverage id hashes the start blocks. */
export const XOOX_ONE_START_BLOCK = 61_283_810;
export const XOOX_ONE_MAX_REORG_DEPTH = 128;
/** A placeholder: P1 measures the real value (1-3) before the replay, and Envio persists it. */
export const DEFAULT_BLOCK_LAG = 2;
/** Far above anything P1 should pick; it only catches typos such as 20 for 2. */
export const MAX_BLOCK_LAG = 16;

export type ConfigVariant = "standard" | "breakglass";
export const OUTPUT_FILES: Readonly<Record<ConfigVariant, string>> =
  Object.freeze({
    standard: "config.xoox-one.json",
    breakglass: "config.xoox-one.breakglass.json",
  });
const DEPLOYMENT_PATH = "deployments/10143.json";
const REVIEWED_INPUTS_PATH =
  "output/four-step-integration-2026-10-06/step4-reviewed-inputs.public.json";

const MAX_REVIEWED_BYTES = 16 * 1024;
const MAX_REVIEWED_SOURCES = 6;
const reviewedError = (reason: string) =>
  new Error(`Reviewed Pro inputs: ${reason}.`);

/**
 * Reads the reviewed Pro sources from the step-4 envelope `{ orderedSources, sourcesSha256, ... }`.
 * readReviewedProIndexerSources() cannot be used on this file: it expects the bare JSON array that the envelope's
 * digest covers (JSON.stringify(orderedSources, null, 2) + "\n"). The same 6-source and 16 KiB limits apply here, the
 * digest is re-derived, and envioConfiguration() then validates every record's addresses, chain and start block.
 */
export function readReviewedProInputs(path: string): ProIndexerSource[] {
  let bytes: Buffer;
  try {
    if (statSync(path).size > MAX_REVIEWED_BYTES)
      throw reviewedError("file exceeds 16 KiB");
    bytes = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Reviewed Pro"))
      throw error;
    throw reviewedError("file cannot be read");
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw reviewedError("file is not valid UTF-8 JSON");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
    throw reviewedError("file must be a JSON object");
  const { orderedSources, sourcesSha256 } = envelope as Record<string, unknown>;
  if (
    !Array.isArray(orderedSources) ||
    orderedSources.length === 0 ||
    orderedSources.length > MAX_REVIEWED_SOURCES
  )
    throw reviewedError(
      `orderedSources must hold 1 to ${MAX_REVIEWED_SOURCES} sources`,
    );
  const actual = createHash("sha256")
    .update(JSON.stringify(orderedSources, null, 2) + "\n")
    .digest("hex");
  if (sourcesSha256 !== actual)
    throw reviewedError("the source list does not hash to its recorded digest");
  return orderedSources as ProIndexerSource[];
}

type RpcEntry = Readonly<{
  url: string;
  for: "realtime" | "sync" | "fallback";
  polling_interval?: number;
  initial_block_interval: number;
  interval_ceiling: number;
}>;
const poller = (url: string, role: "realtime" | "sync"): RpcEntry => ({
  url,
  for: role,
  polling_interval: 2000,
  initial_block_interval: 1000,
  interval_ceiling: 1000,
});
/**
 * Every url is a literal keyless https URL: Envio expands ${ENV} but the Pro loaders read rpc[0].url raw, and viem's
 * http() sends no headers. rpc[0] is the archive URL every effect reads (rpc[0].url and INDEXER_CONTRACT_RPC_URL): the
 * P1 probe found archive eth_call only on the public node, so it sits first, as the last-standby fallback for logs.
 * The two keyless pollers follow it and serve the head.
 */
export function rpcOverlay(variant: ConfigVariant): readonly RpcEntry[] {
  const role = variant === "standard" ? "realtime" : "sync";
  return [
    {
      url: MONAD_PUBLIC_RPC,
      for: "fallback",
      initial_block_interval: 100,
      interval_ceiling: 100,
    },
    poller(POSTHUMAN_RPC, role),
    poller(HUGINN_RPC, role),
  ];
}

export type XooxOneInput = Readonly<{
  deployment: Deployment;
  proSources: readonly ProIndexerSource[];
  blockLag?: number;
}>;
export function xooxOneConfiguration(
  { deployment, proSources, blockLag = DEFAULT_BLOCK_LAG }: XooxOneInput,
  variant: ConfigVariant,
) {
  if (
    typeof blockLag !== "number" ||
    !Number.isInteger(blockLag) ||
    blockLag < 0 ||
    blockLag > MAX_BLOCK_LAG
  )
    throw new Error(`block_lag must be an integer from 0 to ${MAX_BLOCK_LAG}.`);
  const base = envioConfiguration(
    deployment,
    proSources,
    TERMINAL_ROUTER_SOURCE,
  );
  const [chain, ...rest] = base.chains;
  if (!chain || rest.length || chain.id !== XOOX_ONE_CHAIN_ID)
    throw new Error("xoox-one requires exactly the Monad testnet chain 10143.");
  // The generator derives the earliest block any role needs. Overwriting a lower value would silently drop events.
  if (chain.start_block !== XOOX_ONE_START_BLOCK)
    throw new Error(
      `Generated chain start_block is ${chain.start_block}; xoox-one must start at ${XOOX_ONE_START_BLOCK}.`,
    );
  return {
    ...base,
    name: XOOX_ONE_NAME,
    chains: [
      {
        id: chain.id,
        start_block: XOOX_ONE_START_BLOCK,
        rpc: [...rpcOverlay(variant)],
        max_reorg_depth: XOOX_ONE_MAX_REORG_DEPTH,
        block_lag: blockLag,
        contracts: chain.contracts,
      },
    ],
  };
}

export function serializeConfiguration(
  config: ReturnType<typeof xooxOneConfiguration>,
): string {
  return JSON.stringify(config, null, 2) + "\n";
}

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
/** The block_lag of a previously generated file, or undefined when there is no valid one. */
export function existingBlockLag(path: string): number | undefined {
  try {
    const lag = (
      JSON.parse(readFileSync(path, "utf8")) as {
        chains?: { block_lag?: unknown }[];
      }
    ).chains?.[0]?.block_lag;
    return typeof lag === "number" &&
      Number.isInteger(lag) &&
      lag >= 0 &&
      lag <= MAX_BLOCK_LAG
      ? lag
      : undefined;
  } catch {
    return undefined;
  }
}
export function generate(
  options: { root?: string; blockLag?: number } = {},
): Record<ConfigVariant, string> {
  const root = options.root ?? defaultRoot;
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, DEPLOYMENT_PATH), "utf8"),
  );
  if (
    !manifest ||
    typeof manifest !== "object" ||
    (manifest as { chainId?: unknown }).chainId !== XOOX_ONE_CHAIN_ID
  )
    throw new Error("xoox-one requires the Monad testnet 10143 manifest.");
  const input: XooxOneInput = {
    deployment: parseDeployment(manifest),
    proSources: readReviewedProInputs(join(root, REVIEWED_INPUTS_PATH)),
    blockLag: options.blockLag,
  };
  return {
    standard: serializeConfiguration(xooxOneConfiguration(input, "standard")),
    breakglass: serializeConfiguration(
      xooxOneConfiguration(input, "breakglass"),
    ),
  };
}

type Io = Readonly<{
  log: (line: string) => void;
  error: (line: string) => void;
}>;
export function main(
  argv: readonly string[],
  io: Io = { log: console.log, error: console.error },
): number {
  try {
    let outDir = defaultRoot;
    let blockLag: number | undefined;
    let check = false;
    for (let index = 0; index < argv.length; index++) {
      const flag = argv[index];
      if (flag === "--check") check = true;
      else if (flag === "--out-dir") {
        const value = argv[++index];
        if (!value) throw new Error("--out-dir needs a directory.");
        outDir = resolve(value);
      } else if (flag === "--block-lag") {
        const value = argv[++index];
        if (!value || !/^\d+$/.test(value))
          throw new Error("--block-lag needs a non-negative integer.");
        blockLag = Number(value);
      } else throw new Error(`Unknown argument ${flag}.`);
    }
    blockLag ??= existingBlockLag(join(outDir, OUTPUT_FILES.standard));
    const files = generate({ blockLag });
    io.log(`block_lag ${blockLag ?? DEFAULT_BLOCK_LAG}.`);
    let stale = 0;
    for (const variant of Object.keys(OUTPUT_FILES) as ConfigVariant[]) {
      const path = join(outDir, OUTPUT_FILES[variant]);
      if (check) {
        let current: string | undefined;
        try {
          current = readFileSync(path, "utf8");
        } catch {
          current = undefined;
        }
        if (current !== files[variant]) {
          stale++;
          io.error(`${OUTPUT_FILES[variant]} is stale or missing.`);
        } else io.log(`${OUTPUT_FILES[variant]} is current.`);
      } else {
        writeFileSync(path, files[variant]);
        io.log(`Wrote ${OUTPUT_FILES[variant]}.`);
      }
    }
    return stale ? 1 : 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : "Generation failed.");
    return 1;
  }
}
