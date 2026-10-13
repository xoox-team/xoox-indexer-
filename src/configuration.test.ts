import { it, expect } from "vitest";
import type { Deployment } from "./vendor/xoox-sdk/config";
import { envioConfiguration } from "./configuration";
it("indexes all registered bundles from the earliest deployment without duplicate addresses", () => {
  const address = (i: number) =>
    `0x${i.toString(16).padStart(40, "0")}` as `0x${string}`;
  const old = {
    chainId: 31337,
    environment: "local",
    rpcUrl: "http://127.0.0.1:8545",
    startBlock: "17",
    factory: address(1),
    feeVault: address(2),
    hook: address(3),
    swapRouter: address(4),
    poolManager: address(5),
    treasury: address(6),
    launchRouter: address(7),
  } as Deployment;
  const active = {
    ...old,
    startBlock: "100",
    factory: address(11),
    feeVault: address(12),
    hook: address(13),
    swapRouter: address(14),
    launchRouter: address(17),
    legacyDeployments: [old],
  } as Deployment;
  const chain = envioConfiguration(active).chains[0];
  expect(chain.start_block).toBe(17);
  expect(chain.contracts.find((c) => c.name === "Factory")?.address).toEqual([
    address(11),
    address(1),
  ]);
  expect(chain.contracts.find((c) => c.name === "FeeVault")?.address).toEqual([
    address(12),
    address(2),
  ]);
  expect(
    chain.contracts.find((c) => c.name === "PoolManager")?.address,
  ).toEqual([address(5)]);
  expect(chain.contracts.find((c) => c.name === "Treasury")?.address).toEqual([
    address(6),
  ]);
  expect(
    chain.contracts.find((c) => c.name === "LaunchRouter")?.address,
  ).toEqual([address(17), address(7)]);
});
it("subscribes to explicit staking allocations without changing legacy economics events", () => {
  const events = envioConfiguration()
    .contracts.find((c) => c.name === "Factory")!
    .events.map((e) => e.event);
  expect(events).toContain(
    "LaunchStakingConfigured(address indexed token,address indexed pool,uint256 totalSupply,uint256 curveAllocation,uint256 rewardAmount,uint32 duration)",
  );
  expect(
    events.some((e) =>
      e.startsWith(
        "LaunchEconomicsSnapshotted(address indexed token,uint256 supply,",
      ),
    ),
  ).toBe(true);
});

const address = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
const pro = {
  chainId: 143,
  factory: address(200),
  startBlock: "5",
  poolRouter: address(201),
};
it("keeps public Pro pool Router disabled without reviewed source selection", () => {
  expect(
    envioConfiguration().chains[0].contracts.find(
      (c) => c.name === "ProSwapRouter",
    )?.address,
  ).toEqual([]);
});
it("adds the distinct exact ProPoolTrade ABI only at the explicitly selected Router", () => {
  const config = envioConfiguration(undefined, [pro]);
  expect(
    config.chains[0].contracts.find((c) => c.name === "ProSwapRouter")?.address,
  ).toEqual([pro.poolRouter]);
  expect(
    config.contracts.find((c) => c.name === "ProSwapRouter")?.events,
  ).toEqual([
    {
      event:
        "ProPoolTrade(address indexed token,address indexed trader,bytes32 indexed poolId,address recipient,address quoteAsset,bool buy,uint256 amountSpent,uint256 amountOut)",
    },
  ]);
  expect(
    config.chains[0].contracts.find((c) => c.name === "SwapRouter")?.address,
  ).toEqual([]);
});
it.each(["", "0x123", address(0), undefined])(
  "rejects an explicit invalid optional Router %s",
  (poolRouter) => {
    expect(() =>
      envioConfiguration(undefined, [{ ...pro, poolRouter } as typeof pro]),
    ).toThrow("Pro indexer sources");
  },
);
it("rejects overlapping Pro Factory Router and cross-factory ambiguous pairings", () => {
  expect(() =>
    envioConfiguration(undefined, [{ ...pro, poolRouter: pro.factory }]),
  ).toThrow("distinct");
  expect(() =>
    envioConfiguration(undefined, [pro, { ...pro, factory: address(202) }]),
  ).toThrow("multiple factories");
  expect(() =>
    envioConfiguration(undefined, [pro, { ...pro, poolRouter: address(203) }]),
  ).toThrow("ambiguous");
  expect(() =>
    envioConfiguration(undefined, [
      pro,
      { chainId: 143, factory: pro.poolRouter, startBlock: "6" },
    ]),
  ).toThrow("distinct");
});
it("deduplicates identical reviewed pair inputs", () => {
  expect(
    envioConfiguration(undefined, [pro, pro]).chains[0].contracts.find(
      (c) => c.name === "ProSwapRouter",
    )?.address,
  ).toEqual([pro.poolRouter]);
});
it.each(["factory", "swapRouter"])(
  "rejects Router overlap with legacy %s",
  (role) => {
    const legacy = {
      chainId: 143,
      environment: "configured",
      rpcUrl: "https://example.com/rpc",
      startBlock: "1",
      factory: address(1),
      swapRouter: address(2),
    } as Deployment;
    expect(() =>
      envioConfiguration(legacy, [
        { ...pro, poolRouter: legacy[role as "factory" | "swapRouter"] },
      ]),
    ).toThrow("distinct");
  },
);
it("rejects unknown/accessor source fields without running accessors", () => {
  expect(() =>
    envioConfiguration(undefined, [{ ...pro, unexpected: true } as typeof pro]),
  ).toThrow("Pro indexer sources");
  const value = { ...pro };
  Object.defineProperty(value, "poolRouter", {
    get() {
      throw new Error("accessor ran");
    },
    enumerable: true,
  });
  expect(() => envioConfiguration(undefined, [value])).toThrow(
    "Pro indexer sources",
  );
});
