import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { TRADE_DEX_CHAIN_ID, tradeDexSource } from "./trade-dex-registry";
export type TradeDexEvent = {
  chainId: number;
  srcAddress: string;
  block: { number: number; hash: string; timestamp: number };
  transaction: { hash: string };
  logIndex: number;
  removed?: boolean;
};
export type TradeDexPoolDraft = {
  id: string;
  chainId: number;
  key: string;
  kind: "v3" | "v4";
  dex: string;
  factory: string;
  address: string;
  token0: string;
  token1: string;
  poolId: string | undefined;
  fee: number;
  tickSpacing: number;
  hooks: string | undefined;
  initialSqrtPriceX96: bigint | undefined;
  createdBlock: bigint;
  createdBlockHash: string;
  transactionHash: string;
  logIndex: number;
};
const invalid = () =>
  new Error("Invalid or unverified Trade DEX discovery event.");
const hash = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
function asset(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false }))
    throw invalid();
  return value.toLowerCase() as Address;
}
function integer(value: unknown, min: bigint, max: bigint): number {
  if (typeof value !== "bigint" || value < min || value > max) throw invalid();
  return Number(value);
}
export function normalizeTradeDexPool(
  kind: "v3" | "v4",
  event: TradeDexEvent,
  params: Record<string, unknown>,
): TradeDexPoolDraft {
  const source = tradeDexSource(kind, event.srcAddress);
  if (
    event.chainId !== TRADE_DEX_CHAIN_ID ||
    !source ||
    event.removed ||
    !Number.isSafeInteger(event.block.number) ||
    BigInt(event.block.number) < BigInt(source.startBlock) ||
    !Number.isSafeInteger(event.block.timestamp) ||
    event.block.timestamp < 0 ||
    !hash(event.block.hash) ||
    !hash(event.transaction.hash) ||
    !Number.isSafeInteger(event.logIndex) ||
    event.logIndex < 0 ||
    event.logIndex > 0x7fffffff
  )
    throw invalid();
  const token0 = asset(kind === "v4" ? params.currency0 : params.token0),
    token1 = asset(kind === "v4" ? params.currency1 : params.token1);
  if (
    BigInt(token0) >= BigInt(token1) ||
    (kind === "v3" && token0 === zeroAddress)
  )
    throw invalid();
  const fee = integer(params.fee, 0n, 0xffffffn),
    tickSpacing = integer(params.tickSpacing, 1n, 0x7fffffn);
  let address: string,
    poolId: string | undefined,
    hooks: string | undefined,
    initialSqrtPriceX96: bigint | undefined;
  if (kind === "v4") {
    hooks = asset(params.hooks);
    address = source.address.toLowerCase();
    if (
      !hash(params.id) ||
      typeof params.sqrtPriceX96 !== "bigint" ||
      params.sqrtPriceX96 <= 0n ||
      params.sqrtPriceX96 >= 1n << 160n
    )
      throw invalid();
    integer(params.tick, -887272n, 887272n);
    poolId = keccak256(
      encodeAbiParameters(
        parseAbiParameters("address,address,uint24,int24,address"),
        [token0, token1, fee, tickSpacing, hooks as Address],
      ),
    );
    if (poolId !== params.id.toLowerCase()) throw invalid();
    initialSqrtPriceX96 = params.sqrtPriceX96;
  } else {
    address = asset(params.pool);
    if (address === zeroAddress) throw invalid();
  }
  const key = `${kind}:${address}${poolId ? `:${poolId}` : ""}`;
  return {
    id: `${TRADE_DEX_CHAIN_ID}:${key}`,
    chainId: TRADE_DEX_CHAIN_ID,
    key,
    kind,
    dex: source.dex,
    factory: source.address.toLowerCase(),
    address,
    token0,
    token1,
    poolId,
    fee,
    tickSpacing,
    hooks,
    initialSqrtPriceX96,
    createdBlock: BigInt(event.block.number),
    createdBlockHash: event.block.hash.toLowerCase(),
    transactionHash: event.transaction.hash.toLowerCase(),
    logIndex: event.logIndex,
  };
}
export function sameTradeDexPool(
  a: TradeDexPoolDraft,
  b: TradeDexPoolDraft,
): boolean {
  return (Object.keys(b) as (keyof TradeDexPoolDraft)[]).every(
    (key) => a[key] === b[key],
  );
}
