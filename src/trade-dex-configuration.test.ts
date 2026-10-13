import { describe, it, expect } from "vitest";
import { envioConfiguration } from "./configuration";
import {
  TRADE_DEX_SOURCES,
  TRADE_DEX_REGISTRY_HASH,
} from "./trade-dex-registry";
import type { Deployment } from "./vendor/xoox-sdk/config";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const deployment = (chainId: number) =>
  ({
    chainId,
    startBlock: "67279253",
    rpcUrl: "https://testnet-rpc.monad.xyz",
    environment: "configured",
    factory: addr(1),
    feeVault: addr(2),
    hook: addr(3),
    swapRouter: addr(4),
    poolManager: addr(5),
    treasury: addr(6),
  }) as Deployment;
describe("generic testnet Trade discovery subscriptions", () => {
  it("binds the exact verified V3/V4 sources and lowers replay start without changing XOOX subscriptions", () => {
    const config = envioConfiguration(deployment(10143));
    const chain = config.chains[0];
    expect(chain.start_block).toBe(61283810);
    expect(chain.rpc?.[0]).toMatchObject({
      initial_block_interval: 100,
      interval_ceiling: 100,
      acceleration_additive: 0,
    });
    expect(
      chain.contracts.find((c) => c.name === "TradeV3Factory")?.address,
    ).toEqual([TRADE_DEX_SOURCES[1].address]);
    expect(
      chain.contracts.find((c) => c.name === "TradeV4PoolManager")?.address,
    ).toEqual([TRADE_DEX_SOURCES[0].address]);
    expect(
      chain.contracts.find((c) => c.name === "TradeV3Factory"),
    ).toMatchObject({ start_block: 62_317_860 });
    expect(
      chain.contracts.find((c) => c.name === "TradeV4PoolManager"),
    ).toMatchObject({ start_block: 61_283_810 });
    for (const role of chain.contracts.filter(
      (c) => c.address.length && !c.name.startsWith("TradeV"),
    ))
      expect(role).toMatchObject({ start_block: 67_279_253 });
    expect(
      chain.contracts.find((c) => c.name === "PoolManager")?.address,
    ).toEqual([addr(5)]);
    expect(chain.contracts.find((c) => c.name === "Hook")?.address).toEqual([
      addr(3),
    ]);
    expect(
      config.contracts.find((c) => c.name === "TradeV3Factory")?.events,
    ).toEqual([
      {
        event:
          "PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)",
      },
    ]);
    expect(
      config.contracts.find((c) => c.name === "TradeV4PoolManager")?.events,
    ).toHaveLength(1);
  });
  it("keeps generic discovery unsubscribed on mainnet and isolated local chains", () => {
    for (const chainId of [143, 31337]) {
      const chain = envioConfiguration(deployment(chainId)).chains[0];
      expect(
        chain.contracts.find((c) => c.name === "TradeV3Factory")?.address,
      ).toEqual([]);
      expect(
        chain.contracts.find((c) => c.name === "TradeV4PoolManager")?.address,
      ).toEqual([]);
      expect(chain.start_block).toBe(67279253);
    }
  });
  it("matches the existing web and Rust registry hash fixture", () => {
    expect(TRADE_DEX_REGISTRY_HASH).toBe(
      "bf2caabade43016d297876d8cf318aae8b3cf4df4ed56c097344b360112c3cb6",
    );
  });
});
