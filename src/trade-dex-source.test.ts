import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeFunctionResult, parseAbi, stringToHex, zeroAddress, type PublicClient } from "viem";
import { TRADE_DEX_SOURCES } from "./trade-dex-registry";
import { loadTradeDexEvidence, readTradeDexEvidence, readTradeDexTokenMetadata, TradeDexRpcAdmission } from "./trade-dex-source";

const source = TRADE_DEX_SOURCES.find((s) => s.kind === "v3")!;
const v4 = TRADE_DEX_SOURCES.find((s) => s.kind === "v4")!;
const token0 = "0x1111111111111111111111111111111111111111";
const token1 = "0x2222222222222222222222222222222222222222";
const pool = "0x3333333333333333333333333333333333333333";
const eventHash = `0x${"a".repeat(64)}`;
const confirmedHash = `0x${"b".repeat(64)}`;
const input = { kind: "v3", source: source.address, blockNumber: 62_400_000n, blockHash: eventHash, token0, token1, poolAddress: pool, fee: 500, tickSpacing: 10 };
const metadataAbi = parseAbi(["function name() view returns(string)", "function symbol() view returns(string)", "function decimals() view returns(uint8)"]);
function client() {
  const methods = {
    getChainId: vi.fn(async () => 10143),
    getBlockNumber: vi.fn(async () => 70_000_000n),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, hash: blockNumber === input.blockNumber ? eventHash : confirmedHash, timestamp: 1_800_000_000n })),
    getCode: vi.fn(async (_params: {address:string;blockNumber:bigint}) => "0x6000"),
    readContract: vi.fn(async ({ functionName }: { functionName: string }): Promise<string | number> => ({ factory: source.address, token0, token1, fee: 500, tickSpacing: 10, getPool: pool } as Record<string,string|number>)[functionName]!),
    call: vi.fn(async ({ data }: { data: string }) => {
      if (data === "0x06fdde03") return { data: encodeFunctionResult({ abi: metadataAbi, functionName: "name", result: "Test Coin" }) };
      if (data === "0x95d89b41") return { data: encodeFunctionResult({ abi: metadataAbi, functionName: "symbol", result: "TEST" }) };
      return { data: encodeFunctionResult({ abi: metadataAbi, functionName: "decimals", result: 18 }) };
    }),
  };
  return { methods, rpc: methods as unknown as PublicClient };
}
// Source validation uses real pinned runtime bytes in production. Inject only the
// code hashing boundary so fixtures can exercise canonical/membership checks.
vi.mock("viem", async (original) => {
  const actual = await original<typeof import("viem")>();
  return { ...actual, keccak256: vi.fn((value: string) => value === "0x6000" ? "0xc442a8391c5f25711deb9fa0d9d1567c84a48cca55b19bbd13b3e3244823727f" : value === "0x6002" ? "0x61199025286997b715457c68f86dbc42c847753f01e0773668394a405d53d579" : actual.keccak256(value as `0x${string}`)) };
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("shared Trade RPC admission budget", () => {
  it("smooths request starts to eight per second and never saves idle burst credits", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const gate = new TradeDexRpcAdmission(); const starts: number[] = [];
    const tasks = Array.from({ length: 16 }, () => gate.run(async () => { starts.push(Date.now()); }));
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toEqual([0, 125, 250, 375, 500, 625, 750, 875]);
    await vi.advanceTimersByTimeAsync(1001); await Promise.all(tasks);
    await vi.advanceTimersByTimeAsync(5000);
    const idleStarts: number[] = [];
    const afterIdle = Array.from({ length: 3 }, () => gate.run(async () => { idleStarts.push(Date.now()); }));
    await vi.advanceTimersByTimeAsync(250); await Promise.all(afterIdle);
    expect(idleStarts).toEqual([7000, 7125, 7250]);
  });
  it("holds at most four slots until complete response work settles", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const gate = new TradeDexRpcAdmission(); const releases: (() => void)[] = []; let active = 0, maximum = 0;
    const tasks = Array.from({ length: 8 }, () => gate.run(async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve)); active--;
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(releases).toHaveLength(4); expect(maximum).toBe(4);
    releases[0]!(); await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(5); expect(maximum).toBe(4);
    for (let i = 1; i < 8; i++) { releases[i]?.(); await vi.advanceTimersByTimeAsync(125); }
    await Promise.all(tasks); expect(active).toBe(0);
  });
  it("removes cancelled queued work and releases failed active slots", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const gate = new TradeDexRpcAdmission({ maxInflight: 1 });
    let fail!: (error: Error) => void;
    const active = gate.run(() => new Promise<void>((_, reject) => { fail = reject; }));
    const rejected = expect(active).rejects.toThrow(/^Trade DEX RPC request failed\.$/);
    const controller = new AbortController(); const skipped = vi.fn(async () => {});
    const cancelled = gate.run(skipped, controller.signal);
    const cancelledResult = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    let nextRan = false; const next = gate.run(async () => { nextRan = true; });
    controller.abort(new Error("secret-provider-url")); await cancelledResult;
    fail(new Error("https://private.invalid/secret-token")); await rejected;
    await vi.advanceTimersByTimeAsync(125); await next;
    expect(skipped).not.toHaveBeenCalled(); expect(nextRan).toBe(true);
  });
  it("bounds queued jobs and refuses an already aborted signal without occupying capacity", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const gate = new TradeDexRpcAdmission({ maxInflight: 1, maxQueue: 2 }); let release!: () => void;
    const active = gate.run(() => new Promise<void>((resolve) => { release = resolve; }));
    const queued = [gate.run(async () => {}), gate.run(async () => {})];
    await expect(gate.run(async () => {})).rejects.toThrow(/^Trade DEX RPC queue is full\.$/);
    const controller = new AbortController(); controller.abort();
    await expect(gate.run(async () => {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    release(); await vi.advanceTimersByTimeAsync(250); await Promise.all([active, ...queued]);
  });
});

describe("canonical Trade DEX sources", () => {
  it("authenticates V3 immutable membership at a confirmed current block, not archive state", async () => {
    const { rpc, methods } = client();
    await expect(readTradeDexEvidence(rpc, 10143, input)).resolves.toEqual({ checkedAt: 1_800_000_000_000n });
    expect(methods.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "getPool", address: source.address, blockNumber: 69_999_998n }));
    expect(methods.getCode.mock.calls.every(([p]) => (p as unknown as {blockNumber:bigint}).blockNumber === 69_999_998n)).toBe(true);
  });
  it("rejects another chain before discovery can be trusted", async () => {
    const { rpc, methods } = client();
    methods.getChainId.mockResolvedValue(143);
    await expect(readTradeDexEvidence(rpc, 10143, input)).rejects.toThrow(/Trade DEX/);
  });
  it.each([
    { kind: "v2" }, { source: token0 }, { blockNumber: 1n }, { token1: token0 }, { poolAddress: zeroAddress }, { fee: -1 }, { tickSpacing: 0 }, { blockHash: "0x00" },
  ])("rejects malformed or unregistered evidence %o", async (change) => {
    await expect(readTradeDexEvidence(client().rpc, 10143, { ...input, ...change })).rejects.toThrow(/Trade DEX/);
  });
  it("rejects a noncanonical creation block", async () => {
    const { rpc, methods } = client();
    methods.getBlock.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber, hash: confirmedHash, timestamp: 1_800_000_000n }));
    await expect(readTradeDexEvidence(rpc, 10143, input)).rejects.toThrow(/Trade DEX/);
  });
  it("rejects unpinned runtime", async () => {
    const { rpc, methods } = client(); methods.getCode.mockResolvedValue("0x6001");
    await expect(readTradeDexEvidence(rpc, 10143, input)).rejects.toThrow(/Trade DEX/);
  });
  it("rejects factory getPool disagreement", async () => {
    const { rpc, methods } = client();
    const original = methods.readContract.getMockImplementation()!;
    methods.readContract.mockImplementation(async (p) => p.functionName === "getPool" ? token0 : original(p));
    await expect(readTradeDexEvidence(rpc, 10143, input)).rejects.toThrow(/Trade DEX/);
  });
  it("accepts a canonical zero-fee V3 pool but rejects the one-million boundary", async () => {
    const { rpc, methods } = client(); const original = methods.readContract.getMockImplementation()!;
    methods.readContract.mockImplementation(async (p) => p.functionName === "fee" ? 0 : original(p));
    await expect(readTradeDexEvidence(rpc, 10143, { ...input, fee: 0 })).resolves.toMatchObject({ checkedAt: 1_800_000_000_000n });
    await expect(readTradeDexEvidence(rpc, 10143, { ...input, fee: 1_000_000 })).rejects.toThrow(/Trade DEX/);
  });
  it("rechecks creation and confirmed hashes after immutable reads", async () => {
    const { rpc, methods } = client(); let reads = 0;
    methods.getBlock.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber, hash: ++reads > 2 ? `0x${"c".repeat(64)}` : blockNumber === input.blockNumber ? eventHash : confirmedHash, timestamp: 1_800_000_000n }));
    await expect(readTradeDexEvidence(rpc, 10143, input)).rejects.toThrow(/Trade DEX/);
  });
  it("sanitizes provider errors rather than exposing credentials", async () => {
    const { rpc, methods } = client(); methods.getBlockNumber.mockRejectedValue(new Error("https://private.invalid/secret-token"));
    await expect(readTradeDexEvidence(rpc, 10143, input)).rejects.toThrow(/^Trade DEX evidence could not be verified\.$/);
  });
  it("requires a V4 pool to identify its validated manager", async () => {
    await expect(readTradeDexEvidence(client().rpc, 10143, { ...input, kind: "v4", source: v4.address, poolAddress: pool })).rejects.toThrow(/Trade DEX/);
  });
  it("authenticates a native V4 pool through its pinned manager without V3 getters", async () => {
    const { rpc, methods } = client(); methods.getCode.mockResolvedValue("0x6002");
    await expect(readTradeDexEvidence(rpc, 10143, { ...input, kind: "v4", source: v4.address, token0: zeroAddress, poolAddress: v4.address })).resolves.toEqual({ checkedAt: 1_800_000_000_000n });
    expect(methods.readContract).not.toHaveBeenCalled();
  });
  it("rejects a valid registry source that is not the configured static subscriber", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xoox-dex-evidence-"));
    const config = join(directory, "config.json");
    try {
      await writeFile(config, JSON.stringify({ contracts: [{ name: "TradeV3Factory" }], chains: [{ id: 10143, contracts: [{ name: "TradeV3Factory", address: [token0] }], rpc: [{ url: "https://private.invalid/secret-token" }] }] }));
      vi.stubEnv("ENVIO_CONFIG", config);
      const network = vi.spyOn(globalThis, "fetch");
      try { await expect(loadTradeDexEvidence(10143, input)).rejects.toThrow(/^Trade DEX evidence could not be verified\.$/); expect(network).not.toHaveBeenCalled(); }
      finally { network.mockRestore(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("Trade DEX current token metadata", () => {
  it("reads ready ERC20 metadata at confirmed current state", async () => {
    const { rpc, methods } = client();
    await expect(readTradeDexTokenMetadata(rpc, 10143, { address: token0, epoch: 30_000_000 })).resolves.toEqual({ name: "Test Coin", symbol: "TEST", decimals: 18, status: "ready", updatedAt: 1_800_000_000_000n });
    expect(methods.call).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 69_999_998n }));
  });
  it("returns fixed native MON metadata without ERC20 calls", async () => {
    const { rpc, methods } = client();
    await expect(readTradeDexTokenMetadata(rpc, 10143, { address: zeroAddress, epoch: 30_000_000 })).resolves.toMatchObject({ name: "Monad", symbol: "MON", decimals: 18, status: "ready" });
    expect(methods.call).not.toHaveBeenCalled();
  });
  it("supports legacy bytes32 name and symbol", async () => {
    const { rpc, methods } = client();
    methods.call.mockImplementation(async ({ data }) => ({ data: data === "0x313ce567" ? encodeAbiParameters([{ type: "uint8" }], [6]) : stringToHex(data === "0x95d89b41" ? "OLD" : "Old Coin", { size: 32 }) }));
    await expect(readTradeDexTokenMetadata(rpc, 10143, { address: token0, epoch: 30_000_000 })).resolves.toMatchObject({ symbol: "OLD", name: "Old Coin", decimals: 6, status: "ready" });
  });
  it.each(["\uFEFF", "x".repeat(129), "bad\u0000name"])("rejects unsafe or unbounded metadata %j", async (name) => {
    const { rpc, methods } = client(); const original = methods.call.getMockImplementation()!;
    methods.call.mockImplementation(async (p) => p.data === "0x06fdde03" ? { data: encodeFunctionResult({ abi: metadataAbi, functionName: "name", result: name }) } : original(p));
    await expect(readTradeDexTokenMetadata(rpc, 10143, { address: token0, epoch: 30_000_000 })).resolves.toMatchObject({ name: null, symbol: null, decimals: null, status: "unavailable" });
  });
  it("returns unavailable without leaking a metadata provider failure", async () => {
    const { rpc, methods } = client(); methods.call.mockRejectedValue(new Error("https://private.invalid/secret-token"));
    await expect(readTradeDexTokenMetadata(rpc, 10143, { address: token0, epoch: 30_000_000 })).resolves.toMatchObject({ name: null, symbol: null, decimals: null, status: "unavailable" });
  });
  it("never treats an EOA as a ready ERC20", async () => {
    const { rpc, methods } = client(); methods.getCode.mockResolvedValue("0x");
    await expect(readTradeDexTokenMetadata(rpc, 10143, { address: token0, epoch: 30_000_000 })).resolves.toMatchObject({ status: "unavailable" });
    expect(methods.call).not.toHaveBeenCalled();
  });
  it("rejects unsupported decimals and oversized returndata", async () => {
    for (const result of [encodeAbiParameters([{ type: "uint8" }], [255]), `0x${"aa".repeat(2049)}`]) {
      const { rpc, methods } = client(); const original = methods.call.getMockImplementation()!;
      methods.call.mockImplementation(async (p) => p.data === "0x313ce567" ? { data: result as `0x${string}` } : original(p));
      await expect(readTradeDexTokenMetadata(rpc, 10143, { address: token0, epoch: 30_000_000 })).resolves.toMatchObject({ status: "unavailable", decimals: null });
    }
  });
  it("does not publish metadata from a confirmed block that reorganized during reads", async () => {
    const { rpc, methods } = client(); let reads = 0;
    methods.getBlock.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber, hash: ++reads === 1 ? confirmedHash : eventHash, timestamp: 1_800_000_000n }));
    await expect(readTradeDexTokenMetadata(rpc, 10143, { address: token0, epoch: 30_000_000 })).resolves.toMatchObject({ status: "unavailable" });
  });
});
