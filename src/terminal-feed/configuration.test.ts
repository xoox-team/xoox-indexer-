import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Deployment } from "../vendor/xoox-sdk/config";
import { envioConfiguration, TERMINAL_ROUTER_SOURCE } from "../configuration";
import { TRADE_DEX_SOURCES } from "../trade-dex-registry";
import { CHAIN_ID, ROUTER, ROUTER_START, TRADE_EVENT } from "./constants";

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
const role = (config: ReturnType<typeof envioConfiguration>) =>
  config.chains[0].contracts.find((c) => c.name === "TerminalRouter");
const readJson = (path: string) =>
  JSON.parse(
    readFileSync(new URL(path, import.meta.url), "utf8"),
  ) as ReturnType<typeof envioConfiguration>;

describe("optional TerminalRouter role", () => {
  it("pins the reviewed router identity", () => {
    expect(TERMINAL_ROUTER_SOURCE).toEqual({
      chainId: CHAIN_ID,
      address: ROUTER,
      startBlock: String(ROUTER_START),
    });
    expect(ROUTER).toBe("0x79ad9653c42f8fec1e8191b15288861cedcba3f7");
    expect(ROUTER_START).toBe(69_076_718);
  });

  it("declares exactly the Trade ABI once, with an empty disabled role", () => {
    const config = envioConfiguration();
    expect(config.contracts.filter((c) => c.name === "TerminalRouter")).toEqual(
      [{ name: "TerminalRouter", events: [{ event: TRADE_EVENT }] }],
    );
    expect(role(config)).toEqual({ name: "TerminalRouter", address: [] });
  });

  it("stays unsubscribed on a deployment unless the source is passed", () => {
    const config = envioConfiguration(deployment(CHAIN_ID));
    expect(role(config)).toEqual({ name: "TerminalRouter", address: [] });
    expect(config.chains[0].start_block).toBe(61283810);
  });

  it("subscribes the router at its own start block without moving any other start", () => {
    const base = envioConfiguration(deployment(CHAIN_ID));
    const config = envioConfiguration(
      deployment(CHAIN_ID),
      [],
      TERMINAL_ROUTER_SOURCE,
    );
    expect(role(config)).toEqual({
      name: "TerminalRouter",
      address: [ROUTER],
      start_block: 69_076_718,
    });
    const chain = config.chains[0];
    expect(chain.start_block).toBe(61283810);
    expect(
      chain.contracts.find((c) => c.name === "TradeV4PoolManager"),
    ).toMatchObject({
      address: [TRADE_DEX_SOURCES[0].address],
      start_block: 61_283_810,
    });
    expect(
      chain.contracts.find((c) => c.name === "TradeV3Factory"),
    ).toMatchObject({
      address: [TRADE_DEX_SOURCES[1].address],
      start_block: 62_317_860,
    });
    // Only the router role differs from the same deployment without it.
    expect({
      ...config,
      chains: [
        {
          ...chain,
          contracts: chain.contracts.filter((c) => c.name !== "TerminalRouter"),
        },
      ],
    }).toEqual({
      ...base,
      chains: [
        {
          ...base.chains[0],
          contracts: base.chains[0].contracts.filter(
            (c) => c.name !== "TerminalRouter",
          ),
        },
      ],
    });
  });

  it.each([
    ["another chain", deployment(143), TERMINAL_ROUTER_SOURCE],
    ["no deployment", undefined, TERMINAL_ROUTER_SOURCE],
    [
      "a source for another chain",
      deployment(CHAIN_ID),
      { ...TERMINAL_ROUTER_SOURCE, chainId: 143 },
    ],
    [
      "another address",
      deployment(CHAIN_ID),
      { ...TERMINAL_ROUTER_SOURCE, address: addr(9) },
    ],
    [
      "another start block",
      deployment(CHAIN_ID),
      { ...TERMINAL_ROUTER_SOURCE, startBlock: "1" },
    ],
  ])("rejects %s", (_label, input, source) => {
    expect(() => envioConfiguration(input, [], source)).toThrow(
      "Terminal router",
    );
  });

  it("is declared in the committed disabled codegen and subscribed on the unit-test Monad chain only", () => {
    const codegen = readJson("../../config.codegen.yaml");
    expect(codegen).toEqual(envioConfiguration());
    const test = readJson("../../config.test.yaml");
    expect(test.contracts.filter((c) => c.name === "TerminalRouter")).toEqual(
      codegen.contracts.filter((c) => c.name === "TerminalRouter"),
    );
    expect(
      test.chains.map((chain) => [
        chain.id,
        chain.contracts.find((c) => c.name === "TerminalRouter")?.address,
      ]),
    ).toEqual([
      [143, []],
      [CHAIN_ID, [ROUTER]],
    ]);
    expect(codegen.contracts).toHaveLength(22);
    expect(
      codegen.contracts.reduce((total, c) => total + c.events.length, 0),
    ).toBe(69);
  });
});
