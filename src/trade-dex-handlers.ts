import {
  indexer,
  type EvmOnEventContext,
  type TradeDexPool,
  type TradeDexToken,
} from "envio";
import { zeroAddress } from "viem";
import {
  tradeDexEvidenceEffect,
  tradeDexTokenMetadataEffect,
} from "./handlers/trade-dex-effect";
import {
  normalizeTradeDexPool,
  sameTradeDexPool,
  type TradeDexPoolDraft,
} from "./trade-dex-pool";
import {
  TRADE_DEX_CHAIN_ID,
  TRADE_DEX_REGISTRY_HASH,
} from "./trade-dex-registry";
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= limit &&
  !/[\u0000-\u001f\u007f]/.test(value);
const ready = (token: {
  status: string;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
}) =>
  token.status === "ready" &&
  text(token.name, 150) &&
  text(token.symbol, 32) &&
  Number.isInteger(token.decimals) &&
  Number(token.decimals) >= 0 &&
  Number(token.decimals) <= 36;
async function tokenMetadata(
  context: EvmOnEventContext,
  address: string,
  now: bigint,
  epoch: number,
): Promise<void> {
  const id = `${TRADE_DEX_CHAIN_ID}:${address}`;
  const previous = await context.TradeDexToken.get(id);
  if (address === zeroAddress) {
    if (!previous)
      context.TradeDexToken.set({
        id,
        chainId: TRADE_DEX_CHAIN_ID,
        address,
        name: "Monad",
        symbol: "MON",
        decimals: 18,
        status: "ready",
        updatedAt: now,
      });
    return;
  }
  if (previous && ready(previous)) return;
  if (previous?.status === "unavailable" && now - previous.updatedAt < 60_000n)
    return;
  let next: TradeDexToken = {
    id,
    chainId: TRADE_DEX_CHAIN_ID,
    address,
    name: undefined,
    symbol: undefined,
    decimals: undefined,
    status: "pending",
    updatedAt: now,
  };
  try {
    const metadata = await context.effect(tradeDexTokenMetadataEffect, {
      address,
      epoch,
    });
    next =
      ready(metadata) &&
      metadata.updatedAt >= 0n &&
      metadata.updatedAt <= 9_007_199_254_740_991n
        ? {
            ...next,
            name: metadata.name!.trim(),
            symbol: metadata.symbol!.trim(),
            decimals: metadata.decimals!,
            status: "ready",
            updatedAt: metadata.updatedAt,
          }
        : { ...next, status: "unavailable" };
  } catch {
    next = { ...next, status: "unavailable" };
  }
  context.TradeDexToken.set(next);
}
async function discover(
  context: EvmOnEventContext,
  pool: TradeDexPoolDraft,
): Promise<void> {
  const existing = await context.TradeDexPool.get(pool.id);
  if (existing && !sameTradeDexPool(existing as TradeDexPoolDraft, pool))
    throw new Error("Conflicting Trade DEX pool identity.");
  await context.effect(tradeDexEvidenceEffect, {
    kind: pool.kind,
    source: pool.factory,
    blockNumber: pool.createdBlock,
    blockHash: pool.createdBlockHash,
    token0: pool.token0,
    token1: pool.token1,
    poolAddress: pool.address,
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
  });
  // Only metadata freshness uses processing time. Pool provenance remains entirely
  // canonical-event-derived; minute cache keys permit later replay/event retries.
  const now = BigInt(Date.now()),
    epoch = Number(now / 60_000n);
  for (const address of new Set([zeroAddress, pool.token0, pool.token1]))
    await tokenMetadata(context, address, now, epoch);
  if (!existing) context.TradeDexPool.set(pool as TradeDexPool);
  const id = `${TRADE_DEX_CHAIN_ID}:${TRADE_DEX_REGISTRY_HASH}`;
  const previous = await context.TradeDexCoverage.get(id);
  context.TradeDexCoverage.set({
    id,
    chainId: TRADE_DEX_CHAIN_ID,
    registryHash: TRADE_DEX_REGISTRY_HASH,
    historyComplete: previous?.historyComplete ?? false,
    firstObservedBlock:
      previous && previous.firstObservedBlock < pool.createdBlock
        ? previous.firstObservedBlock
        : pool.createdBlock,
    lastObservedBlock:
      previous && previous.lastObservedBlock > pool.createdBlock
        ? previous.lastObservedBlock
        : pool.createdBlock,
    updatedAt: now,
  });
}
indexer.onEvent(
  { contract: "TradeV3Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    await discover(context, normalizeTradeDexPool("v3", event, event.params));
  },
);
indexer.onEvent(
  { contract: "TradeV4PoolManager", event: "Initialize" },
  async ({ event, context }) => {
    await discover(context, normalizeTradeDexPool("v4", event, event.params));
  },
);
