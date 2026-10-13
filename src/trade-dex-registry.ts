import { createHash } from "node:crypto";
import type { Address, Hash } from "viem";

export const TRADE_DEX_CHAIN_ID = 10143;
export type TradeDexSource = Readonly<{
  kind: "v3" | "v4";
  dex: string;
  address: Address;
  startBlock: string;
  runtimeCodeHash: Hash;
}>;
/** Shared, verified testnet deployments. These are independent of XOOX launch subscriptions. */
export const TRADE_DEX_SOURCES: readonly TradeDexSource[] = Object.freeze([
  Object.freeze({
    kind: "v4",
    dex: "Uniswap v4",
    address: "0x451d64ab3b650040d2ae1886602b97ed6edc643d",
    startBlock: "61283810",
    runtimeCodeHash:
      "0x61199025286997b715457c68f86dbc42c847753f01e0773668394a405d53d579",
  }),
  Object.freeze({
    kind: "v3",
    dex: "XOOX Uniswap v3",
    address: "0xf59b8e874f9382b8bf8e0a0a02fdd1332ef2df1a",
    startBlock: "62317860",
    runtimeCodeHash:
      "0xc442a8391c5f25711deb9fa0d9d1567c84a48cca55b19bbd13b3e3244823727f",
  }),
]);
// Field order and lowercase sorting are the web catalog's dexConfigHash contract.
export const TRADE_DEX_REGISTRY_HASH = createHash("sha256")
  .update(
    JSON.stringify({
      chainId: TRADE_DEX_CHAIN_ID,
      factories: TRADE_DEX_SOURCES.map(
        ({ kind, address, startBlock, runtimeCodeHash }) => ({
          kind,
          address: address.toLowerCase(),
          startBlock,
          runtimeCodeHash: runtimeCodeHash.toLowerCase(),
        }),
      ).sort((a, b) => a.address.localeCompare(b.address)),
    }),
  )
  .digest("hex");
export function tradeDexSource(
  kind: string,
  address: string,
): TradeDexSource | undefined {
  return TRADE_DEX_SOURCES.find(
    (source) =>
      source.kind === kind &&
      source.address.toLowerCase() === address.toLowerCase(),
  );
}
export const TRADE_DEX_CONTRACTS = [
  {
    name: "TradeV3Factory",
    events: [
      {
        event:
          "PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)",
      },
    ],
  },
  {
    name: "TradeV4PoolManager",
    events: [
      {
        event:
          "Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
      },
    ],
  },
];
export function tradeDexSubscriptions(chainId: number) {
  return TRADE_DEX_CONTRACTS.map((contract) => ({
    name: contract.name,
    address:
      chainId === TRADE_DEX_CHAIN_ID
        ? TRADE_DEX_SOURCES.filter(
            (source) =>
              source.kind ===
              (contract.name === "TradeV3Factory" ? "v3" : "v4"),
          ).map((source) => source.address)
        : [],
    ...(chainId === TRADE_DEX_CHAIN_ID
      ? {
          start_block: Number(
            TRADE_DEX_SOURCES.find(
              (source) =>
                source.kind ===
                (contract.name === "TradeV3Factory" ? "v3" : "v4"),
            )!.startBlock,
          ),
        }
      : {}),
  }));
}
