import { expect, it } from "vitest";
import { decodeEventLog, parseAbiItem, type Hex } from "viem";
import v3 from "./test/trade-dex/v3-pool-created.json";
import v4 from "./test/trade-dex/v4-initialize.json";
import { normalizeTradeDexPool, type TradeDexEvent } from "./trade-dex-pool";
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
  // Envio represents Solidity integer event parameters as bigint.
  for (const key of ["fee", "tickSpacing", "tick"])
    if (typeof params[key] === "number")
      params[key] = BigInt(params[key] as number);
  const event: TradeDexEvent = {
    chainId: 10143,
    srcAddress: raw.address,
    block: {
      number: Number(BigInt(raw.blockNumber)),
      hash: raw.blockHash,
      timestamp: 1720000000,
    },
    transaction: { hash: raw.transactionHash },
    logIndex: Number(BigInt(raw.logIndex)),
  };
  return { event, params };
}
it("normalizes real V3/V4 events with separate entity and pool IDs", () => {
  const a = fixture("v3"),
    b = fixture("v4");
  const v3pool = normalizeTradeDexPool("v3", a.event, a.params),
    v4pool = normalizeTradeDexPool("v4", b.event, b.params);
  expect(v3pool.address).toBe("0x6d143687a1cb26240069bf8a8320875fe97cf915");
  expect(v3pool.tickSpacing).toBe(60);
  expect(v4pool.poolId).toBe(
    "0x563014653aef3b5b54014af48812e80e4386a2ce703dfe6e89ab4f99d0769315",
  );
  expect(v4pool.id).toBe(`10143:${v4pool.key}`);
  expect(v4pool.initialSqrtPriceX96).toBe(1n << 96n);
});
it("rejects wrong chain/source, predeployment events, forged V4 IDs and invalid assets/fields", () => {
  for (const change of [
    "chain",
    "source",
    "start",
    "id",
    "order",
    "fee",
    "spacing",
    "removed",
    "hash",
  ]) {
    const { event, params } = fixture("v4");
    if (change === "chain") event.chainId = 143;
    if (change === "source")
      event.srcAddress = "0x1111111111111111111111111111111111111111";
    if (change === "start") event.block.number = 1;
    if (change === "id") params.id = `0x${"00".repeat(32)}`;
    if (change === "order") params.currency0 = params.currency1;
    if (change === "fee") params.fee = 0x1000000n;
    if (change === "spacing") params.tickSpacing = 0n;
    if (change === "removed") event.removed = true;
    if (change === "hash") event.block.hash = "0x1234";
    expect(() => normalizeTradeDexPool("v4", event, params)).toThrow(
      "Trade DEX",
    );
  }
  const { event, params } = fixture("v3");
  params.token0 = "0x0000000000000000000000000000000000000000";
  expect(() => normalizeTradeDexPool("v3", event, params)).toThrow();
});
