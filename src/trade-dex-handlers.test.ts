import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createTestIndexer } from "envio";
import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  parseAbiItem,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import v3 from "./test/trade-dex/v3-pool-created.json";
import v4 from "./test/trade-dex/v4-initialize.json";
import { TRADE_DEX_REGISTRY_HASH } from "./trade-dex-registry";
const loaders = vi.hoisted(() => ({ evidence: vi.fn(), metadata: vi.fn() }));
vi.mock("./trade-dex-source", () => ({
  loadTradeDexEvidence: loaders.evidence,
  loadTradeDexTokenMetadata: loaders.metadata,
}));
import "./handlers/index";
const NOW = 1_800_000_000_000;
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  loaders.evidence.mockReset();
  loaders.metadata.mockReset();
  loaders.evidence.mockResolvedValue({ checkedAt: BigInt(NOW) });
  loaders.metadata.mockResolvedValue({
    name: "Test asset",
    symbol: "TEST",
    decimals: 18,
    status: "ready",
    updatedAt: BigInt(NOW),
  });
});
afterEach(() => vi.restoreAllMocks());
function fixture(kind: "v3" | "v4") {
  const raw = kind === "v3" ? v3 : v4;
  const abi = parseAbiItem(
    kind === "v3"
      ? "event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)"
      : "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
  );
  const params = decodeEventLog({
    abi: [abi],
    data: raw.data as Hex,
    topics: raw.topics as [Hex, ...Hex[]],
  }).args as Record<string, unknown>;
  for (const key of ["fee", "tickSpacing", "tick"])
    if (typeof params[key] === "number")
      params[key] = BigInt(params[key] as number);
  return {
    contract: kind === "v3" ? "TradeV3Factory" : "TradeV4PoolManager",
    event: kind === "v3" ? "PoolCreated" : "Initialize",
    srcAddress: raw.address as Address,
    block: {
      number: Number(BigInt(raw.blockNumber)),
      hash: raw.blockHash as Hex,
      timestamp: 1720000000,
    },
    transaction: { hash: raw.transactionHash as Hex },
    logIndex: Number(BigInt(raw.logIndex)),
    params,
  };
}
async function process(
  test: ReturnType<typeof createTestIndexer>,
  event: ReturnType<typeof fixture>,
  chainId = 10143,
) {
  // Runtime fixture shape is checked by the real Envio ABI registration.
  await test.process({
    chains: { [chainId]: { simulate: [event] } },
  } as Parameters<typeof test.process>[0]);
}
function nextPool(fee = 500, advance = 10) {
  const event = fixture("v4");
  event.block.number += advance;
  event.logIndex += 1;
  event.params.fee = BigInt(fee);
  event.params.id = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address,address,uint24,int24,address"),
      [
        event.params.currency0 as Address,
        event.params.currency1 as Address,
        fee,
        Number(event.params.tickSpacing),
        event.params.hooks as Address,
      ],
    ),
  );
  return event;
}
it("discovers a real external V4 Initialize without touching XOOX Pool or Launch", async () => {
  const test = createTestIndexer();
  const event = fixture("v4");
  await process(test, event);
  const rows = await test.TradeDexPool.getAll();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    chainId: 10143,
    kind: "v4",
    poolId: event.params.id,
    createdBlock: BigInt(event.block.number),
    createdBlockHash: event.block.hash,
    tickSpacing: 60,
  });
  expect(await test.Pool.getAll()).toEqual([]);
  expect(await test.Launch.getAll()).toEqual([]);
  expect(await test.TradeDexToken.getAll()).toHaveLength(3);
  expect(
    await test.TradeDexToken.getOrThrow(
      "10143:0x0000000000000000000000000000000000000000",
    ),
  ).toMatchObject({
    name: "Monad",
    symbol: "MON",
    decimals: 18,
    status: "ready",
  });
  expect(
    await test.TradeDexCoverage.getOrThrow(`10143:${TRADE_DEX_REGISTRY_HASH}`),
  ).toMatchObject({
    historyComplete: false,
    firstObservedBlock: BigInt(event.block.number),
    lastObservedBlock: BigInt(event.block.number),
  });
  expect(loaders.evidence).toHaveBeenCalledWith(
    10143,
    expect.objectContaining({
      source: event.srcAddress,
      blockNumber: BigInt(event.block.number),
      blockHash: event.block.hash,
    }),
  );
});
it("discovers a real V3 pool with factory identity and keeps existing XOOX tables isolated", async () => {
  const test = createTestIndexer();
  await process(test, fixture("v3"));
  expect((await test.TradeDexPool.getAll())[0]).toMatchObject({
    kind: "v3",
    address: "0x6d143687a1cb26240069bf8a8320875fe97cf915",
    poolId: undefined,
    fee: 3000,
    tickSpacing: 60,
  });
  expect(await test.Pool.getAll()).toEqual([]);
  expect(await test.Launch.getAll()).toEqual([]);
});
it("reuses ready currency metadata across pools and idempotent replay", async () => {
  const test = createTestIndexer();
  const first = fixture("v4");
  await process(test, first);
  await process(test, nextPool());
  const replay = createTestIndexer();
  for (const row of await test.TradeDexPool.getAll())
    replay.TradeDexPool.set(row);
  for (const row of await test.TradeDexToken.getAll())
    replay.TradeDexToken.set(row);
  for (const row of await test.TradeDexCoverage.getAll())
    replay.TradeDexCoverage.set(row);
  await process(replay, first);
  expect(await replay.TradeDexPool.getAll()).toHaveLength(2);
  expect(await test.TradeDexPool.getAll()).toHaveLength(2);
  expect(await test.TradeDexToken.getAll()).toHaveLength(3);
  expect(loaders.metadata).toHaveBeenCalledTimes(2);
});
it("metadata failure leaves a genuine pool indexed and retries unavailable currencies after a minute", async () => {
  const test = createTestIndexer();
  loaders.metadata.mockRejectedValue(
    new Error("sensitive provider URL must not escape"),
  );
  await process(test, fixture("v4"));
  expect(await test.TradeDexPool.getAll()).toHaveLength(1);
  expect(
    (await test.TradeDexToken.getAll()).filter(
      (token) => token.status === "unavailable",
    ),
  ).toHaveLength(2);
  const calls = loaders.metadata.mock.calls.length;
  await process(test, nextPool());
  expect(loaders.metadata).toHaveBeenCalledTimes(calls);
  vi.spyOn(Date, "now").mockReturnValue(NOW + 61_000);
  loaders.metadata.mockResolvedValue({
    name: "Recovered",
    symbol: "OK",
    decimals: 6,
    status: "ready",
    updatedAt: BigInt(NOW + 61_000),
  });
  await process(test, nextPool(1000, 20));
  expect(
    (await test.TradeDexToken.getAll()).every(
      (token) => token.status === "ready",
    ),
  ).toBe(true);
  expect(loaders.metadata.mock.calls.length).toBeGreaterThan(calls);
});
it("canonical validation failure and forged V4 pool identity cannot write catalog rows", async () => {
  for (const mode of ["evidence", "id"]) {
    const test = createTestIndexer();
    const event = fixture("v4");
    if (mode === "evidence")
      loaders.evidence.mockRejectedValue(
        new Error("Trade DEX evidence could not be verified."),
      );
    else {
      loaders.evidence.mockResolvedValue({ checkedAt: BigInt(NOW) });
      event.params.id = `0x${"00".repeat(32)}`;
    }
    await expect(process(test, event)).rejects.toThrow();
    expect(await test.TradeDexPool.getAll()).toEqual([]);
    expect(await test.TradeDexToken.getAll()).toEqual([]);
  }
});
it("malformed ready metadata becomes unavailable without poisoning the discovered catalog", async () => {
  const test = createTestIndexer();
  loaders.metadata.mockResolvedValue({
    name: "Test",
    symbol: "\uFEFF",
    decimals: 18,
    status: "ready",
    updatedAt: BigInt(NOW),
  });
  await process(test, fixture("v4"));
  expect(await test.TradeDexPool.getAll()).toHaveLength(1);
  expect(
    (await test.TradeDexToken.getAll())
      .filter(
        (token) =>
          token.address !== "0x0000000000000000000000000000000000000000",
      )
      .every(
        (token) =>
          token.status === "unavailable" &&
          token.name === undefined &&
          token.symbol === undefined &&
          token.decimals === undefined,
      ),
  ).toBe(true);
});
