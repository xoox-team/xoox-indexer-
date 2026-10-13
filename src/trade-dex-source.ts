import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient, decodeFunctionResult, encodeFunctionData, hexToBytes,
  http, isAddress, keccak256, parseAbi, zeroAddress,
  type Address, type Hex, type PublicClient,
} from "viem";
import { TRADE_DEX_CHAIN_ID, tradeDexSource } from "./trade-dex-registry";

export type TradeDexEvidenceInput = Readonly<{
  kind: string; source: string; blockNumber: bigint; blockHash: string;
  token0: string; token1: string; poolAddress: string; fee: number; tickSpacing: number;
}>;
export type TradeDexTokenMetadataInput = Readonly<{ address: string; epoch: number }>;
export type TradeDexTokenMetadata = Readonly<{
  name: string | null; symbol: string | null; decimals: number | null;
  status: "ready" | "unavailable"; updatedAt: bigint;
}>;
const evidenceError = () => new Error("Trade DEX evidence could not be verified.");
const cancelledRequest = () => Object.assign(new Error("Trade DEX RPC request was cancelled."), { name: "AbortError" });

/** One gate is shared by all Trade effects/clients in this process. It bounds
 * starts and complete response work separately; idle time grants no credits. */
export class TradeDexRpcAdmission {
  private readonly spacing: number;
  private readonly maxInflight: number;
  private readonly maxQueue: number;
  private active = 0;
  private nextStart = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly queue: { start: () => void; detach: () => void }[] = [];

  constructor(options: { startsPerSecond?: number; maxInflight?: number; maxQueue?: number } = {}) {
    const starts = options.startsPerSecond ?? 8;
    this.maxInflight = options.maxInflight ?? 4; this.maxQueue = options.maxQueue ?? 128;
    if (!Number.isInteger(starts) || starts < 1 || starts > 8 || !Number.isInteger(this.maxInflight)
      || this.maxInflight < 1 || this.maxInflight > 4 || !Number.isInteger(this.maxQueue)
      || this.maxQueue < 1 || this.maxQueue > 128) throw new Error("Invalid Trade DEX RPC admission bounds.");
    this.spacing = Math.ceil(1000 / starts);
  }

  run<T>(operation: () => Promise<T>, signal?: AbortSignal | null): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelledRequest());
    if (this.queue.length >= this.maxQueue) return Promise.reject(new Error("Trade DEX RPC queue is full."));
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1); job.detach(); reject(cancelledRequest()); this.pump();
      };
      const job = {
        detach: () => signal?.removeEventListener("abort", abort),
        start: () => {
          void (async () => {
            try { resolve(await operation()); }
            catch { reject(new Error("Trade DEX RPC request failed.")); }
            finally { this.active--; this.pump(); }
          })();
        },
      };
      this.queue.push(job);
      signal?.addEventListener("abort", abort, { once: true });
      // Covers cancellation between the first check and listener installation.
      if (signal?.aborted) abort(); else this.pump();
    });
  }

  private pump() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.active >= this.maxInflight || this.queue.length === 0) return;
    const wait = this.nextStart - performance.now();
    if (wait > 0) { this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, wait); return; }
    const job = this.queue.shift()!; job.detach(); this.active++;
    this.nextStart = performance.now() + this.spacing;
    job.start(); this.pump();
  }
}
const tradeRpcAdmission = new TradeDexRpcAdmission();
const unavailable = (updatedAt = 0n): TradeDexTokenMetadata => ({ name: null, symbol: null, decimals: null, status: "unavailable", updatedAt });
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const hash = (value: unknown): value is Hex => typeof value === "string" && /^0x[\da-f]{64}$/i.test(value);
function address(value: string): Address {
  if (!isAddress(value, { strict: false })) throw evidenceError();
  return value.toLowerCase() as Address;
}
function code(value: unknown): value is Hex {
  return typeof value === "string" && value.length > 2 && value.length <= 262_146 && /^0x(?:[\da-f]{2})+$/i.test(value);
}
const poolAbi = parseAbi([
  "function factory() view returns(address)", "function token0() view returns(address)",
  "function token1() view returns(address)", "function fee() view returns(uint24)",
  "function tickSpacing() view returns(int24)",
  "function getPool(address,address,uint24) view returns(address)",
]);
const metadataAbi = parseAbi([
  "function name() view returns(string)", "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
]);

async function confirmed(client: PublicClient, chainId: number) {
  if (chainId !== TRADE_DEX_CHAIN_ID || await client.getChainId() !== chainId) throw evidenceError();
  const head = await client.getBlockNumber();
  if (head < 2n) throw evidenceError();
  const block = await client.getBlock({ blockNumber: head - 2n });
  if (block.number !== head - 2n || !hash(block.hash) || block.timestamp < 0n) throw evidenceError();
  return { number: block.number, hash: block.hash, timestamp: block.timestamp };
}

/** Event provenance is historical. Immutable source membership and metadata use
 * current confirmed state, so old events do not require an archive-state RPC. */
export async function readTradeDexEvidence(client: PublicClient, chainId: number, input: TradeDexEvidenceInput): Promise<{ checkedAt: bigint }> {
  try {
    const source = tradeDexSource(input.kind, address(input.source));
    const token0 = address(input.token0), token1 = address(input.token1), pool = address(input.poolAddress);
    if (!source || input.blockNumber < BigInt(source.startBlock) || !hash(input.blockHash)
      || BigInt(token0) >= BigInt(token1) || pool === zeroAddress
      || !Number.isSafeInteger(input.fee) || input.fee < 0 || input.fee > 0xffffff
      || !Number.isSafeInteger(input.tickSpacing) || input.tickSpacing <= 0 || input.tickSpacing > 32767
      || (source.kind === "v3" && (token0 === zeroAddress || input.fee >= 1_000_000))
      || (source.kind === "v4" && !same(pool, source.address))) throw evidenceError();
    const current = await confirmed(client, chainId);
    if (input.blockNumber > current.number) throw evidenceError();
    const canonical = async () => {
      const event = await client.getBlock({ blockNumber: input.blockNumber });
      if (event.number !== input.blockNumber || !same(event.hash, input.blockHash)) throw evidenceError();
    };
    await canonical();
    const runtime = await client.getCode({ address: source.address, blockNumber: current.number });
    if (!code(runtime) || !same(keccak256(runtime), source.runtimeCodeHash)) throw evidenceError();
    if (source.kind === "v3") {
      if (!code(await client.getCode({ address: pool, blockNumber: current.number }))) throw evidenceError();
      const [factory, bound0, bound1, fee, tickSpacing, registered] = await Promise.all([
        client.readContract({ address: pool, abi: poolAbi, functionName: "factory", blockNumber: current.number }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "token0", blockNumber: current.number }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "token1", blockNumber: current.number }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "fee", blockNumber: current.number }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "tickSpacing", blockNumber: current.number }),
        client.readContract({ address: source.address, abi: poolAbi, functionName: "getPool", args: [token0, token1, input.fee], blockNumber: current.number }),
      ]);
      if (!same(factory, source.address) || !same(bound0, token0) || !same(bound1, token1)
        || fee !== input.fee || tickSpacing !== input.tickSpacing || !same(registered, pool)) throw evidenceError();
    }
    await canonical();
    const after = await client.getBlock({ blockNumber: current.number });
    if (after.number !== current.number || !same(after.hash, current.hash) || await client.getChainId() !== chainId) throw evidenceError();
    return { checkedAt: current.timestamp * 1000n };
  } catch { throw evidenceError(); }
}

function safeText(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && !/[\u0000-\u001f\u007f-\u009f]/.test(text) && new TextEncoder().encode(text).length <= maximumBytes ? text : null;
}
function textResult(data: Hex, functionName: "name" | "symbol"): string | null {
  if (!/^0x(?:[\da-f]{2})*$/i.test(data) || data.length > 4098) return null;
  let value: unknown;
  if (data.length === 66) {
    const bytes = hexToBytes(data);
    const end = bytes.indexOf(0);
    if (end >= 0 && bytes.slice(end).some((byte) => byte !== 0)) return null;
    try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, end < 0 ? undefined : end)); }
    catch { return null; }
  } else {
    try { value = decodeFunctionResult({ abi: metadataAbi, functionName, data }); }
    catch { return null; }
  }
  return safeText(value, functionName === "name" ? 128 : 32);
}

/** Unsupported metadata is retryable through the effect's minute epoch key.
 * It never turns a genuine discovery into a fabricated tradable token. */
export async function readTradeDexTokenMetadata(client: PublicClient, chainId: number, input: TradeDexTokenMetadataInput): Promise<TradeDexTokenMetadata> {
  let updatedAt = 0n;
  try {
    const target = address(input.address);
    if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) return unavailable();
    const current = await confirmed(client, chainId);
    updatedAt = current.timestamp * 1000n;
    if (target === zeroAddress) return { name: "Monad", symbol: "MON", decimals: 18, status: "ready", updatedAt };
    if (!code(await client.getCode({ address: target, blockNumber: current.number }))) return unavailable(updatedAt);
    const raw = await Promise.all((["name", "symbol", "decimals"] as const).map(async (functionName) => {
      const result = await client.call({ to: target, data: encodeFunctionData({ abi: metadataAbi, functionName }), blockNumber: current.number });
      if (!result.data || result.data.length > 4098) throw evidenceError();
      return result.data;
    }));
    const name = textResult(raw[0]!, "name"), symbol = textResult(raw[1]!, "symbol");
    const decimals = decodeFunctionResult({ abi: metadataAbi, functionName: "decimals", data: raw[2]! });
    const after = await client.getBlock({ blockNumber: current.number });
    if (!name || !symbol || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36
      || after.number !== current.number || !same(after.hash, current.hash) || await client.getChainId() !== chainId) return unavailable(updatedAt);
    return { name, symbol, decimals, status: "ready", updatedAt };
  } catch { return unavailable(updatedAt); }
}

type RuntimeConfig = { contracts?: { name: string }[]; chains?: { id: number; contracts?: { name: string; address?: string | string[] }[]; rpc?: { url: string }[] }[] };
async function configuredClient(chainId: number, input?: TradeDexEvidenceInput) {
  const path = resolve(process.env.ENVIO_CONFIG ?? "config.yaml");
  if ((await stat(path)).size > 512 * 1024) throw evidenceError();
  const config = JSON.parse(await readFile(path, "utf8")) as RuntimeConfig;
  const chain = config.chains?.find((c) => c.id === chainId);
  if (chainId !== TRADE_DEX_CHAIN_ID || !chain) throw evidenceError();
  if (input) {
    const alias = input.kind === "v3" ? "TradeV3Factory" : input.kind === "v4" ? "TradeV4PoolManager" : "";
    const subscribers = chain.contracts?.filter((c) => c.name === alias);
    const addresses = subscribers?.flatMap((c) => typeof c.address === "string" ? [c.address] : c.address ?? []) ?? [];
    if (!alias || config.contracts?.filter((c) => c.name === alias).length !== 1 || subscribers?.length !== 1
      || !addresses.some((a) => same(a, input.source)) || addresses.some((a) => !tradeDexSource(input.kind, a))) throw evidenceError();
  }
  const rpc = process.env.INDEXER_CONTRACT_RPC_URL ?? chain.rpc?.[0]?.url;
  if (!rpc) throw evidenceError();
  const parsed = new URL(rpc);
  if (!["https:", "http:"].includes(parsed.protocol)) throw evidenceError();
  const boundedFetch: typeof fetch = (url, init) => tradeRpcAdmission.run(async () => {
    const response = await fetch(url, { ...init, redirect: "error" });
    if (!response.body) throw evidenceError();
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 1024 * 1024) throw evidenceError();
        chunks.push(value);
      }
    } catch { await reader.cancel().catch(() => {}); throw evidenceError(); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }, init?.signal ?? (url instanceof Request ? url.signal : undefined));
  return createPublicClient({ transport: http(rpc, { timeout: 12_000, retryCount: 0, fetchFn: boundedFetch }) });
}
export async function loadTradeDexEvidence(chainId: number, input: TradeDexEvidenceInput): Promise<{ checkedAt: bigint }> {
  try { return await readTradeDexEvidence(await configuredClient(chainId, input), chainId, input); }
  catch { throw evidenceError(); }
}
export async function loadTradeDexTokenMetadata(chainId: number, input: TradeDexTokenMetadataInput): Promise<TradeDexTokenMetadata> {
  try { return await readTradeDexTokenMetadata(await configuredClient(chainId), chainId, input); }
  catch { return unavailable(); }
}
