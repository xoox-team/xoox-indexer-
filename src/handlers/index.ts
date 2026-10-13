import "../pro-handlers";
import "../trade-dex-handlers";
import "../terminal-feed/handlers";
import { royaltyRecipientsEffect } from "./royalty-effect";
import {
  indexer,
  type Launch,
  type Pool,
  type EvmOnEventContext as HandlerContext,
  type DividendEpoch,
  type DuoState,
  type OgRewardBalance,
} from "envio";
const ZERO = "0x0000000000000000000000000000000000000000";
type EventIdentity = {
  chainId: number;
  transaction: { hash: string };
  logIndex: number;
};
const eventId = (event: EventIdentity) =>
  `${event.chainId}:${event.transaction.hash}:${event.logIndex}`;
function emptyLaunch(id: string): Launch {
  return {
    id,
    factory: undefined,
    feeStrategyEnabled: undefined,
    baseFeeEnabled: undefined,
    strategyCreatorBps: undefined,
    strategyHolderBps: undefined,
    strategyBurnBps: undefined,
    strategyLiquidityBps: undefined,
    registered: false,
    creator: undefined,
    creatorFeeRecipient: undefined,
    curve: undefined,
    quoteAsset: undefined,
    configId: undefined,
    name: undefined,
    symbol: undefined,
    image: undefined,
    description: undefined,
    website: undefined,
    twitter: undefined,
    telegram: undefined,
    supply: 0n,
    curveSupply: undefined,
    stakingPool: undefined,
    stakingRewardAmount: undefined,
    stakingDuration: undefined,
    phantomQuote: undefined,
    graduationThreshold: undefined,
    phase: 0,
    realQuoteReserve: 0n,
    tokenReserve: 0n,
    quoteVolume: 0n,
    tradeCount: 0n,
    holderCount: 0n,
    createdAt: undefined,
    createdBlock: undefined,
    lastTradeAt: undefined,
    poolId: undefined,
    dividendVault: undefined,
    holderFeeMode: undefined,
    dividendShareBps: undefined,
    dividendTaxShareBps: undefined,
    baseFeeBps: undefined,
    creatorTaxBps: undefined,
    protocolShareBps: undefined,
    buybackShareBps: undefined,
    buybackEnabled: undefined,
    priceQuoteX18: undefined,
    marketCapQuote: undefined,
    progressBps: 0n,
  };
}
function curveMetrics(
  launch: Launch,
  real = launch.realQuoteReserve,
  tokens = launch.tokenReserve,
) {
  const virtual =
    launch.phantomQuote === undefined ? undefined : launch.phantomQuote + real;
  return {
    priceQuoteX18:
      virtual !== undefined && tokens > 0n
        ? (virtual * 10n ** 36n) / tokens
        : undefined,
    marketCapQuote:
      virtual !== undefined && tokens > 0n
        ? (virtual * launch.supply) / tokens
        : undefined,
    progressBps: launch.graduationThreshold
      ? (real * 10_000n) / launch.graduationThreshold
      : 0n,
  };
}
function canonicalPool(launch: Launch, pool: Pool): boolean {
  return (
    pool.token === launch.id &&
    ((pool.currency0 === pool.token && pool.currency1 === launch.quoteAsset) ||
      (pool.currency1 === pool.token && pool.currency0 === launch.quoteAsset))
  );
}
function poolMetrics(launch: Launch, pool: Pool) {
  const squared = pool.sqrtPriceX96 * pool.sqrtPriceX96,
    Q192 = 1n << 192n;
  const priceQuoteX18 =
    pool.currency0 === launch.quoteAsset
      ? squared === 0n
        ? undefined
        : (Q192 * 10n ** 36n) / squared
      : (squared * 10n ** 36n) / Q192;
  return {
    priceQuoteX18,
    marketCapQuote:
      priceQuoteX18 === undefined
        ? undefined
        : (priceQuoteX18 * launch.supply) / 10n ** 36n,
  };
}
async function recordHourCandle(
  context: HandlerContext,
  launch: Launch,
  timestamp: bigint,
  quoteVolume: bigint,
  priceQuoteX18: bigint | undefined,
) {
  if (!launch.quoteAsset)
    throw new Error(
      `Canonical trade is missing its quote asset for ${launch.id}.`,
    );
  const secondId = `${launch.id}:${timestamp}`,
    previousSecond = await context.MarketSecond.get(secondId);
  if (previousSecond && previousSecond.quoteAsset !== launch.quoteAsset)
    throw new Error(
      `Canonical quote asset changed inside market second ${secondId}.`,
    );
  context.MarketSecond.set({
    id: secondId,
    token: launch.id,
    quoteAsset: launch.quoteAsset,
    timestamp,
    quoteVolume: (previousSecond?.quoteVolume ?? 0n) + quoteVolume,
    tradeCount: (previousSecond?.tradeCount ?? 0n) + 1n,
    cumulativeQuoteVolume: launch.quoteVolume + quoteVolume,
    cumulativeTradeCount: launch.tradeCount + 1n,
  });
  const bucketStart = timestamp - (timestamp % 3_600n),
    id = `${launch.id}:${bucketStart}`;
  const previous = await context.HourCandle.get(id);
  if (!previous) {
    context.HourCandle.set({
      id,
      token: launch.id,
      quoteAsset: launch.quoteAsset,
      bucketStart,
      quoteVolume,
      tradeCount: 1n,
      cumulativeQuoteVolume: launch.quoteVolume + quoteVolume,
      cumulativeTradeCount: launch.tradeCount + 1n,
      openPriceQuoteX18: priceQuoteX18,
      highPriceQuoteX18: priceQuoteX18,
      lowPriceQuoteX18: priceQuoteX18,
      closePriceQuoteX18: priceQuoteX18,
    });
    return;
  }
  if (previous.quoteAsset !== launch.quoteAsset)
    throw new Error(`Canonical quote asset changed inside hour candle ${id}.`);
  context.HourCandle.set({
    ...previous,
    quoteVolume: previous.quoteVolume + quoteVolume,
    tradeCount: previous.tradeCount + 1n,
    cumulativeQuoteVolume: launch.quoteVolume + quoteVolume,
    cumulativeTradeCount: launch.tradeCount + 1n,
    openPriceQuoteX18: previous.openPriceQuoteX18 ?? priceQuoteX18,
    highPriceQuoteX18:
      priceQuoteX18 === undefined
        ? previous.highPriceQuoteX18
        : previous.highPriceQuoteX18 === undefined ||
            priceQuoteX18 > previous.highPriceQuoteX18
          ? priceQuoteX18
          : previous.highPriceQuoteX18,
    lowPriceQuoteX18:
      priceQuoteX18 === undefined
        ? previous.lowPriceQuoteX18
        : previous.lowPriceQuoteX18 === undefined ||
            priceQuoteX18 < previous.lowPriceQuoteX18
          ? priceQuoteX18
          : previous.lowPriceQuoteX18,
    closePriceQuoteX18: priceQuoteX18 ?? previous.closePriceQuoteX18,
  });
}
async function once(
  context: HandlerContext,
  event: EventIdentity,
): Promise<boolean> {
  const id = eventId(event);
  if (await context.ProcessedEvent.get(id)) return false;
  context.ProcessedEvent.set({ id });
  return true;
}
async function duoState(
  context: HandlerContext,
  token: string,
): Promise<DuoState> {
  return (
    (await context.DuoState.get(token)) ?? {
      id: token,
      secondaryQuote: undefined,
      primaryAllocation: undefined,
      secondaryAllocation: undefined,
      poolId: undefined,
      positionId: undefined,
    }
  );
}

indexer.onEvent(
  { contract: "Factory", event: "DuoExecutorConfigured" },
  async ({ event, context }) => {
    context.InternalRouter.set({ id: event.params.executor });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "DuoConfigured" },
  async ({ event, context }) => {
    const p = event.params,
      previous = await duoState(context, p.token);
    context.DuoState.set({ ...previous, secondaryQuote: p.secondaryQuote });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "DuoPoolRecorded" },
  async ({ event, context }) => {
    const p = event.params,
      previous = await duoState(context, p.token);
    context.DuoState.set({
      ...previous,
      poolId: p.poolId,
      positionId: p.positionId,
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "DuoLaunched" },
  async ({ event, context }) => {
    const p = event.params,
      previous = await duoState(context, p.token);
    context.DuoState.set({
      ...previous,
      primaryAllocation: p.primaryAllocation,
      secondaryAllocation: p.secondaryAllocation,
    });
  },
);

indexer.contractRegister(
  { contract: "Factory", event: "TokenLaunched" },
  async ({ event, context }) => {
    context.chain.Token.add(event.params.token);
    context.chain.Curve.add(event.params.curve);
  },
);
indexer.contractRegister(
  { contract: "Token", event: "DividendVaultSet" },
  async ({ event, context }) =>
    context.chain.DividendVault.add(event.params.vault),
);
indexer.onEvent(
  { contract: "Factory", event: "TokenLaunched" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      previous = (await context.Launch.get(p.token)) ?? emptyLaunch(p.token);
    if (
      previous.factory !== undefined &&
      previous.factory.toLowerCase() !== event.srcAddress.toLowerCase()
    )
      throw new Error(
        `Token ${p.token} is registered by multiple deployment factories.`,
      );
    context.Launch.set({
      ...previous,
      registered: true,
      factory: event.srcAddress,
      creator: p.creator,
      curve: p.curve,
      quoteAsset: p.quoteAsset,
      configId: p.configId,
      createdAt: BigInt(event.block.timestamp),
      createdBlock: BigInt(event.block.number),
    });
    context.Curve.set({ id: p.curve, token: p.token });
    if (previous.dividendVault)
      context.DividendVault.set({
        id: previous.dividendVault,
        token: p.token,
        quoteAsset: p.quoteAsset,
      });
  },
);
indexer.onEvent(
  { contract: "Token", event: "TokenMetadata" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const previous =
      (await context.Launch.get(event.srcAddress)) ??
      emptyLaunch(event.srcAddress);
    context.Launch.set({
      ...previous,
      ...event.params,
      marketCapQuote:
        previous.priceQuoteX18 === undefined
          ? previous.marketCapQuote
          : (previous.priceQuoteX18 * event.params.supply) / 10n ** 36n,
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "LaunchEconomicsSnapshotted" },
  async ({ event, context }) => {
    const p = event.params,
      launch = await context.Launch.getOrThrow(p.token);
    // The unchanged legacy event proves the base share only. Full tax sharing
    // requires HolderFeeSharingConfigured, which can precede this snapshot.
    const legacyMode =
      p.dividendVault === ZERO && p.dividendShareBps === 0n
        ? 0
        : p.dividendVault !== ZERO && p.dividendShareBps === 2000n
          ? 1
          : undefined;
    const updated = {
      ...launch,
      supply: p.supply,
      curveSupply: launch.curveSupply ?? p.supply,
      tokenReserve: launch.curveSupply ?? p.supply,
      phantomQuote: p.phantomQuote,
      graduationThreshold: p.graduationThreshold,
      dividendVault: p.dividendVault === ZERO ? undefined : p.dividendVault,
      baseFeeBps: p.baseBps,
      creatorTaxBps: p.creatorTaxBps,
      protocolShareBps: p.protocolShareBps,
      buybackShareBps: p.buybackShareBps,
      buybackEnabled: p.buybackEnabled,
      dividendShareBps: p.dividendShareBps,
      holderFeeMode: launch.holderFeeMode ?? legacyMode,
      dividendTaxShareBps:
        launch.dividendTaxShareBps ??
        (legacyMode !== undefined ? 0n : undefined),
    };
    context.Launch.set({ ...updated, ...curveMetrics(updated) });
    if (p.dividendVault !== ZERO && launch.quoteAsset)
      context.DividendVault.set({
        id: p.dividendVault,
        token: p.token,
        quoteAsset: launch.quoteAsset,
      });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "LaunchStakingConfigured" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params, launch = await context.Launch.getOrThrow(p.token);
    if (!launch.registered || launch.factory !== event.srcAddress || p.pool === ZERO ||
      p.totalSupply !== 10n ** 27n || p.curveAllocation <= 0n || p.rewardAmount <= 0n ||
      p.curveAllocation + p.rewardAmount !== p.totalSupply ||
      ![30n, 60n, 90n, 180n].some(days => days * 86_400n === p.duration) ||
      (launch.supply !== 0n && launch.supply !== p.totalSupply) ||
      launch.phase !== 0 || launch.realQuoteReserve !== 0n || launch.tradeCount !== 0n ||
      (launch.stakingPool !== undefined && launch.stakingPool !== p.pool)) {
      throw new Error("Invalid launch staking allocation event.");
    }
    // The reserve transfer is neither a burn nor a public trade. Full ERC20 supply
    // continues to determine FDV; only the bonding-curve inventory is reduced.
    const updated = { ...launch, supply: p.totalSupply, curveSupply: p.curveAllocation,
      tokenReserve: p.curveAllocation, stakingPool: p.pool,
      stakingRewardAmount: p.rewardAmount, stakingDuration: p.duration };
    context.Launch.set({ ...updated, ...curveMetrics(updated) });
  },
);
indexer.contractRegister(
  { contract: "Factory", event: "HolderFeeSharingConfigured" },
  async ({ event, context }) => {
    if (event.params.vault === ZERO) return;
    if (event.params.mode === 4n)
      context.chain.OgDividendVault.add(event.params.vault);
    else context.chain.DividendVault.add(event.params.vault);
  },
);
indexer.onEvent(
  { contract: "Factory", event: "HolderFeeSharingConfigured" },
  async ({ event, context }) => {
    const p = event.params,
      launch = (await context.Launch.get(p.token)) ?? emptyLaunch(p.token);
    context.Launch.set({
      ...launch,
      holderFeeMode: Number(p.mode),
      dividendVault: p.vault === ZERO ? undefined : p.vault,
      dividendShareBps: p.baseShareBps,
      dividendTaxShareBps: p.taxShareBps,
    });
    if (p.vault !== ZERO && launch.quoteAsset)
      context.DividendVault.set({
        id: p.vault,
        token: p.token,
        quoteAsset: launch.quoteAsset,
      });
  },
);
indexer.onEvent(
  { contract: "Token", event: "DividendVaultSet" },
  async ({ event, context }) => {
    const launch =
      (await context.Launch.get(event.srcAddress)) ??
      emptyLaunch(event.srcAddress);
    context.Launch.set({ ...launch, dividendVault: event.params.vault });
    if (launch.quoteAsset)
      context.DividendVault.set({
        id: event.params.vault,
        token: launch.id,
        quoteAsset: launch.quoteAsset,
      });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "FeeStrategySnapshotted" },
  async ({ event, context }) => {
    const p = event.params,
      launch = (await context.Launch.get(p.token)) ?? emptyLaunch(p.token);
    if (p.creatorBps + p.holderBps + p.burnBps + p.liquidityBps !== 10_000n)
      throw new Error("Invalid fee strategy snapshot.");
    context.Launch.set({
      ...launch,
      feeStrategyEnabled: true,
      baseFeeEnabled: p.baseFeeEnabled,
      strategyCreatorBps: p.creatorBps,
      strategyHolderBps: p.holderBps,
      strategyBurnBps: p.burnBps,
      strategyLiquidityBps: p.liquidityBps,
    });
  },
);
indexer.onEvent(
  { contract: "Token", event: "Transfer" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      token = event.srcAddress,
      launch = (await context.Launch.get(token)) ?? emptyLaunch(token);
    let count = launch.holderCount;
    if (p.from === p.to) return;
    for (const [account, delta] of [
      [p.from, -p.value],
      [p.to, p.value],
    ] as const) {
      if (account === ZERO) continue;
      const id = `${token}:${account}`,
        previous = await context.Holder.get(id),
        before = previous?.balance ?? 0n,
        balance = before + delta;
      if (balance < 0n)
        throw new Error(
          `Transfer replay is missing earlier history for ${id}.`,
        );
      context.Holder.set({
        id,
        token,
        account,
        balance,
        updatedAt: BigInt(event.block.timestamp),
      });
      if (before === 0n && balance > 0n) count++;
      if (before > 0n && balance === 0n) count--;
    }
    const supply =
      p.from === ZERO
        ? launch.supply + p.value
        : p.to === ZERO
          ? launch.supply - p.value
          : launch.supply;
    if (supply < 0n) throw new Error("Burn exceeds indexed supply.");
    context.Launch.set({
      ...launch,
      holderCount: count,
      supply,
      marketCapQuote:
        launch.priceQuoteX18 === undefined
          ? launch.marketCapQuote
          : (launch.priceQuoteX18 * supply) / 10n ** 36n,
    });
  },
);
indexer.onEvent(
  { contract: "Curve", event: "CurveBuy" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const curve = await context.Curve.getOrThrow(event.srcAddress),
      launch = await context.Launch.getOrThrow(curve.token),
      p = event.params;
    const updated = {
      ...launch,
      ...curveMetrics(launch, p.realQuoteReserve, p.tokenReserve),
      realQuoteReserve: p.realQuoteReserve,
      tokenReserve: p.tokenReserve,
    };
    // The registered executor buys on the curve only for internal fee processing.
    // Preserve its price impact without recording a public trade or payment link.
    if (await context.InternalRouter.get(p.buyer)) {
      context.Launch.set(updated);
      return;
    }
    context.LatestSettlement.set({
      id: `${event.chainId}:${event.transaction.hash}:${curve.token}`,
      tradeId: eventId(event),
    });
    context.Trade.set({
      id: eventId(event),
      token: curve.token,
      venue: "curve",
      side: "buy",
      trader: p.buyer,
      recipient: p.recipient,
      tokens: p.tokensOut,
      quoteAmount: p.quoteSpent,
      refund: p.quoteRefund,
      baseFee: p.baseFee,
      creatorTax: p.creatorTax,
      snipeTax: p.snipeTax,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
    await recordHourCandle(
      context,
      updated,
      BigInt(event.block.timestamp),
      p.quoteSpent,
      updated.priceQuoteX18,
    );
    context.Launch.set({
      ...updated,
      quoteVolume: launch.quoteVolume + p.quoteSpent,
      tradeCount: launch.tradeCount + 1n,
      lastTradeAt: BigInt(event.block.timestamp),
    });
  },
);
indexer.onEvent(
  { contract: "Curve", event: "CurveSell" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const curve = await context.Curve.getOrThrow(event.srcAddress),
      launch = await context.Launch.getOrThrow(curve.token),
      p = event.params;
    const updated = {
      ...launch,
      ...curveMetrics(launch, p.realQuoteReserve, p.tokenReserve),
      realQuoteReserve: p.realQuoteReserve,
      tokenReserve: p.tokenReserve,
    };
    if (await context.InternalRouter.get(p.seller)) {
      context.Launch.set(updated);
      return;
    }
    context.LatestSettlement.set({
      id: `${event.chainId}:${event.transaction.hash}:${curve.token}`,
      tradeId: eventId(event),
    });
    context.Trade.set({
      id: eventId(event),
      token: curve.token,
      venue: "curve",
      side: "sell",
      trader: p.seller,
      recipient: p.recipient,
      tokens: p.tokensIn,
      quoteAmount: p.quoteOut,
      refund: 0n,
      baseFee: p.baseFee,
      creatorTax: p.creatorTax,
      snipeTax: 0n,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
    await recordHourCandle(
      context,
      updated,
      BigInt(event.block.timestamp),
      p.quoteOut,
      updated.priceQuoteX18,
    );
    context.Launch.set({
      ...updated,
      quoteVolume: launch.quoteVolume + p.quoteOut,
      tradeCount: launch.tradeCount + 1n,
      lastTradeAt: BigInt(event.block.timestamp),
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "GraduationSwept" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      launch = await context.Launch.getOrThrow(p.token);
    context.Launch.set({
      ...launch,
      ...curveMetrics(launch, p.quoteAmount, p.tokenAmount),
      phase: 1,
      realQuoteReserve: p.quoteAmount,
      tokenReserve: p.tokenAmount,
    });
    context.Graduation.set({
      id: eventId(event),
      token: p.token,
      phase: 1,
      quoteAmount: p.quoteAmount,
      tokenAmount: p.tokenAmount,
      poolId: undefined,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "Graduated" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      launch = await context.Launch.getOrThrow(p.token);
    const pool = await context.Pool.get(p.poolId);
    context.Launch.set({
      ...launch,
      ...(pool && canonicalPool(launch, pool) && pool.sqrtPriceX96 > 0n
        ? poolMetrics(launch, pool)
        : {}),
      phase: 2,
      poolId: p.poolId,
      progressBps: 10_000n,
    });
    context.Graduation.set({
      id: eventId(event),
      token: p.token,
      phase: 2,
      quoteAmount: launch.realQuoteReserve,
      tokenAmount: launch.tokenReserve,
      poolId: p.poolId,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "Rescued" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      launch = await context.Launch.getOrThrow(p.token);
    context.Launch.set({ ...launch, phase: 3 });
    context.Graduation.set({
      id: eventId(event),
      token: p.token,
      phase: 3,
      quoteAmount: p.quoteAmount,
      tokenAmount: p.tokenAmount,
      poolId: undefined,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "BuybackEnabledUpdated" },
  async ({ event, context }) => {
    const launch = await context.Launch.getOrThrow(event.params.token);
    context.Launch.set({ ...launch, buybackEnabled: event.params.enabled });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "CreatorFeeRecipientUpdated" },
  async ({ event, context }) => {
    const launch = await context.Launch.getOrThrow(event.params.token);
    context.Launch.set({
      ...launch,
      creatorFeeRecipient: event.params.recipient,
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "QuoteAssetUpdated" },
  async ({ event, context }) => {
    const p = event.params,
      previous = await context.QuoteAsset.get(p.asset);
    context.QuoteAsset.set({
      id: p.asset,
      approved: p.approved,
      decimals: Number(p.decimals),
      phantomQuote: previous?.phantomQuote ?? 0n,
      graduationThreshold: previous?.graduationThreshold ?? 0n,
    });
  },
);
indexer.onEvent(
  { contract: "Factory", event: "PairTokenEconomicsUpdated" },
  async ({ event, context }) => {
    const p = event.params,
      previous = await context.QuoteAsset.getOrThrow(p.asset);
    context.QuoteAsset.set({
      ...previous,
      phantomQuote: p.phantomQuote,
      graduationThreshold: p.graduationThreshold,
    });
  },
);
indexer.onEvent(
  { contract: "FeeVault", event: "FeeCredited" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      id = `${p.token}:${p.asset}:${p.beneficiary}`,
      previous = await context.FeeBalance.get(id);
    context.FeeBalance.set({
      id,
      token: p.token,
      asset: p.asset,
      beneficiary: p.beneficiary,
      credited: (previous?.credited ?? 0n) + p.amount,
      claimed: previous?.claimed ?? 0n,
      balance: (previous?.balance ?? 0n) + p.amount,
    });
  },
);
indexer.onEvent(
  { contract: "FeeVault", event: "FeeStrategyAllocated" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      previous = await context.StrategyBalance.get(p.token);
    if (previous && previous.asset !== p.asset)
      throw new Error("Strategy quote asset changed.");
    context.StrategyBalance.set({
      id: p.token,
      asset: p.asset,
      pendingBurn: (previous?.pendingBurn ?? 0n) + p.burnAmount,
      pendingLiquidity: (previous?.pendingLiquidity ?? 0n) + p.liquidityAmount,
      pendingLiquidityTokens: previous?.pendingLiquidityTokens ?? 0n,
      tokensBurned: previous?.tokensBurned ?? 0n,
      liquidityAdded: previous?.liquidityAdded ?? 0n,
    });
    context.StrategyAllocation.set({
      id: eventId(event),
      ...p,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "FeeVault", event: "BurnProcessed" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      previous = await context.StrategyBalance.getOrThrow(p.token);
    context.StrategyBalance.set({
      ...previous,
      pendingBurn: p.quoteRemaining,
      tokensBurned: previous.tokensBurned + p.tokensBurned,
    });
    context.StrategyExecution.set({
      id: eventId(event),
      token: p.token,
      kind: "burn",
      quoteSpent: p.quoteSpent,
      tokensBought: p.tokensBurned,
      tokensUsed: p.tokensBurned,
      liquidityAdded: 0n,
      positionId: undefined,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "FeeVault", event: "LiquidityProcessed" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      previous = await context.StrategyBalance.getOrThrow(p.token);
    context.StrategyBalance.set({
      ...previous,
      pendingLiquidity: p.quoteRemaining,
      pendingLiquidityTokens: p.tokensRemaining,
      liquidityAdded: previous.liquidityAdded + p.liquidityAdded,
    });
    context.StrategyExecution.set({
      id: eventId(event),
      token: p.token,
      kind: "liquidity",
      quoteSpent: p.quoteSpent,
      tokensBought: p.tokensBought,
      tokensUsed: p.tokensUsed,
      liquidityAdded: p.liquidityAdded,
      positionId: p.positionId,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "FeeVault", event: "BuybackExecutorConfigured" },
  async ({ event, context }) => {
    context.InternalRouter.set({ id: event.params.executor });
  },
);
indexer.onEvent(
  { contract: "FeeVault", event: "Claimed" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      id = `${p.token}:${p.asset}:${p.beneficiary}`,
      previous = await context.FeeBalance.getOrThrow(id);
    if (previous.balance < p.amount)
      throw new Error(`Claim exceeds indexed credits for ${id}.`);
    context.FeeBalance.set({
      ...previous,
      claimed: previous.claimed + p.amount,
      balance: previous.balance - p.amount,
    });
  },
);
async function epoch(
  context: HandlerContext,
  vault: string,
  number: bigint,
): Promise<DividendEpoch> {
  const id = `${vault}:${number}`,
    previous = await context.DividendEpoch.get(id);
  if (previous) return previous;
  const source = await context.DividendVault.getOrThrow(vault);
  if ((await context.Launch.getOrThrow(source.token)).holderFeeMode === 4)
    throw new Error("OG rewards cannot be indexed as epochs.");
  return {
    id,
    vault,
    token: source.token,
    quoteAsset: source.quoteAsset,
    epoch: number,
    deposited: 0n,
    claimed: 0n,
    rolledOut: 0n,
    remaining: 0n,
  };
}
async function ogRewards(
  context: HandlerContext,
  vault: string,
): Promise<OgRewardBalance> {
  const source = await context.DividendVault.getOrThrow(vault),
    launch = await context.Launch.getOrThrow(source.token);
  if (launch.holderFeeMode !== 4 || launch.dividendVault !== vault)
    throw new Error("OG event is missing its factory policy registration.");
  return (
    (await context.OgRewardBalance.get(vault)) ?? {
      id: vault,
      token: source.token,
      quoteAsset: source.quoteAsset,
      deposited: 0n,
      allocated: 0n,
      queued: 0n,
      claimed: 0n,
      remaining: 0n,
    }
  );
}
indexer.onEvent(
  { contract: "OgDividendVault", event: "OgRewardsDeposited" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const previous = await ogRewards(context, event.srcAddress),
      amount = event.params.amount;
    context.OgRewardBalance.set({
      ...previous,
      deposited: previous.deposited + amount,
      queued: previous.queued + amount,
      remaining: previous.remaining + amount,
    });
  },
);
indexer.onEvent(
  { contract: "OgDividendVault", event: "OgRewardsAllocated" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const previous = await ogRewards(context, event.srcAddress),
      p = event.params;
    if (previous.queued < p.amount)
      throw new Error("OG allocation exceeds indexed queued deposits.");
    context.OgRewardBalance.set({
      ...previous,
      allocated: previous.allocated + p.amount,
      queued: previous.queued - p.amount,
    });
    context.OgRewardAllocation.set({
      id: eventId(event),
      vault: event.srcAddress,
      token: previous.token,
      amount: p.amount,
      eligibleSupply: p.eligibleSupply,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "OgDividendVault", event: "OgDividendClaimed" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const previous = await ogRewards(context, event.srcAddress),
      p = event.params;
    if (previous.allocated - previous.claimed < p.amount)
      throw new Error("OG claim exceeds indexed allocations.");
    // Disqualification stops future accrual, not claims for already-funded rewards.
    context.OgRewardBalance.set({
      ...previous,
      claimed: previous.claimed + p.amount,
      remaining: previous.remaining - p.amount,
    });
    context.OgRewardClaim.set({
      id: eventId(event),
      vault: event.srcAddress,
      token: previous.token,
      beneficiary: p.beneficiary,
      amount: p.amount,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "OgDividendVault", event: "OgHolderDisqualified" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const source = await ogRewards(context, event.srcAddress),
      id = `${event.srcAddress}:${event.params.account}`;
    if (await context.OgHolderEligibility.get(id)) return;
    context.OgHolderEligibility.set({
      id,
      vault: event.srcAddress,
      token: source.token,
      account: event.params.account,
      disqualified: true,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "DividendVault", event: "RewardsDeposited" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const previous = await epoch(context, event.srcAddress, event.params.epoch);
    context.DividendEpoch.set({
      ...previous,
      deposited: previous.deposited + event.params.amount,
      remaining: previous.remaining + event.params.amount,
    });
  },
);
indexer.onEvent(
  { contract: "DividendVault", event: "DividendClaimed" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const previous = await epoch(context, event.srcAddress, event.params.epoch);
    if (previous.remaining < event.params.amount)
      throw new Error("Dividend claim exceeds indexed deposits.");
    context.DividendEpoch.set({
      ...previous,
      claimed: previous.claimed + event.params.amount,
      remaining: previous.remaining - event.params.amount,
    });
  },
);
indexer.onEvent(
  { contract: "DividendVault", event: "EmptyEpochRolledOver" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      source = await epoch(context, event.srcAddress, p.sourceEpoch),
      target = await epoch(context, event.srcAddress, p.targetEpoch);
    if (source.remaining < p.amount)
      throw new Error("Rollover exceeds indexed deposits.");
    context.DividendEpoch.set({
      ...source,
      rolledOut: source.rolledOut + p.amount,
      remaining: source.remaining - p.amount,
    });
    context.DividendEpoch.set({
      ...target,
      deposited: target.deposited + p.amount,
      remaining: target.remaining + p.amount,
    });
  },
);

indexer.onEvent(
  { contract: "Hook", event: "PoolRegistered" },
  async ({ event, context }) => {
    context.Pool.set({
      id: event.params.poolId,
      token: event.params.token,
      hook: event.srcAddress,
      currency0: undefined,
      currency1: undefined,
      sqrtPriceX96: 0n,
      tick: 0,
      liquidity: 0n,
    });
  },
);
indexer.onEvent(
  { contract: "PoolManager", event: "Initialize" },
  async ({ event, context }) => {
    const pool = await context.Pool.get(event.params.id);
    if (!pool) return;
    context.Pool.set({
      ...pool,
      currency0: event.params.currency0,
      currency1: event.params.currency1,
      sqrtPriceX96: event.params.sqrtPriceX96,
      tick: Number(event.params.tick),
    });
  },
);
indexer.onEvent(
  { contract: "PoolManager", event: "Swap" },
  async ({ event, context }) => {
    const p = event.params,
      pool = await context.Pool.get(p.id);
    if (!pool || !(await once(context, event))) return;
    context.Pool.set({
      ...pool,
      sqrtPriceX96: p.sqrtPriceX96,
      liquidity: p.liquidity,
      tick: Number(p.tick),
    });
    context.PoolSwap.set({
      id: eventId(event),
      poolId: p.id,
      token: pool.token,
      sender: p.sender,
      amount0: p.amount0,
      amount1: p.amount1,
      sqrtPriceX96: p.sqrtPriceX96,
      liquidity: p.liquidity,
      tick: Number(p.tick),
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
    const launch = await context.Launch.getOrThrow(pool.token),
      quoteIs0 = pool.currency0 === launch.quoteAsset;
    // Secondary pairs retain their own raw swaps and price state. Their amounts
    // are not denominated in the launch's canonical quote asset.
    if (
      !canonicalPool(launch, pool) ||
      (launch.poolId !== undefined && launch.poolId !== p.id)
    )
      return;
    const q = quoteIs0 ? p.amount0 : p.amount1;
    const priced = {
      ...launch,
      ...poolMetrics(launch, { ...pool, sqrtPriceX96: p.sqrtPriceX96 }),
    };
    // The authenticated protocol router executes public trades and internal fee
    // conversions. Only its PoolTrade event identifies a settled public trade.
    // Other routers are counted from the core event, preserving all-router coverage.
    if (
      (await context.InternalRouter.get(p.sender)) ||
      p.sender === pool.hook
    ) {
      context.Launch.set(priced);
      return;
    }
    await recordHourCandle(
      context,
      priced,
      BigInt(event.block.timestamp),
      q < 0n ? -q : q,
      priced.priceQuoteX18,
    );
    context.Launch.set({
      ...priced,
      quoteVolume: launch.quoteVolume + (q < 0n ? -q : q),
      tradeCount: launch.tradeCount + 1n,
      lastTradeAt: BigInt(event.block.timestamp),
    });
  },
);
indexer.onEvent(
  { contract: "PoolManager", event: "ModifyLiquidity" },
  async ({ event, context }) => {
    const p = event.params,
      pool = await context.Pool.get(p.id);
    if (!pool || !(await once(context, event))) return;
    if (pool.tick >= Number(p.tickLower) && pool.tick < Number(p.tickUpper)) {
      const liquidity = pool.liquidity + p.liquidityDelta;
      if (liquidity < 0n)
        throw new Error(
          "Liquidity removal exceeds the indexed active position supply.",
        );
      context.Pool.set({ ...pool, liquidity });
    }
    context.LiquidityChange.set({
      id: eventId(event),
      poolId: p.id,
      sender: p.sender,
      tickLower: Number(p.tickLower),
      tickUpper: Number(p.tickUpper),
      liquidityDelta: p.liquidityDelta,
      salt: p.salt,
      timestamp: BigInt(event.block.timestamp),
    });
  },
);
indexer.onEvent(
  { contract: "SwapRouter", event: "PoolTrade" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params;
    if (!(await context.InternalRouter.get(event.srcAddress)))
      throw new Error(
        "Public router is missing its canonical executor registration. Replay from protocol setup.",
      );
    // Settled wallet amounts for our router. PoolSwap contains all routers' core
    // deltas; keeping it separate prevents counting this transaction twice.
    context.LatestSettlement.set({
      id: `${event.chainId}:${event.transaction.hash}:${p.token}`,
      tradeId: eventId(event),
    });
    context.Trade.set({
      id: eventId(event),
      token: p.token,
      venue: "pool",
      side: p.buy ? "buy" : "sell",
      trader: p.trader,
      recipient: p.recipient,
      tokens: p.buy ? p.amountOut : p.amountIn,
      quoteAmount: p.buy ? p.amountIn : p.amountOut,
      refund: 0n,
      baseFee: undefined,
      creatorTax: undefined,
      snipeTax: 0n,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
    const launch = await context.Launch.getOrThrow(p.token);
    await recordHourCandle(
      context,
      launch,
      BigInt(event.block.timestamp),
      p.buy ? p.amountIn : p.amountOut,
      launch.priceQuoteX18,
    );
    context.Launch.set({
      ...launch,
      quoteVolume: launch.quoteVolume + (p.buy ? p.amountIn : p.amountOut),
      tradeCount: launch.tradeCount + 1n,
      lastTradeAt: BigInt(event.block.timestamp),
    });
  },
);
indexer.onEvent(
  { contract: "SwapRouter", event: "DuoPoolTrade" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      pool = await context.Pool.getOrThrow(p.poolId),
      launch = await context.Launch.getOrThrow(p.token);
    if (!(await context.InternalRouter.get(event.srcAddress)))
      throw new Error(
        "Public router is missing its canonical executor registration. Replay from protocol setup.",
      );
    const matches =
      (pool.currency0 === p.token && pool.currency1 === p.quoteAsset) ||
      (pool.currency1 === p.token && pool.currency0 === p.quoteAsset);
    if (
      pool.token !== p.token ||
      !matches ||
      p.quoteAsset === launch.quoteAsset
    )
      throw new Error(
        "Duo trade does not match its registered secondary pool.",
      );
    context.DuoTrade.set({
      id: eventId(event),
      token: p.token,
      poolId: p.poolId,
      quoteAsset: p.quoteAsset,
      side: p.buy ? "buy" : "sell",
      trader: p.trader,
      recipient: p.recipient,
      tokens: p.buy ? p.amountOut : p.amountIn,
      quoteAmount: p.buy ? p.amountIn : p.amountOut,
      blockNumber: BigInt(event.block.number),
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
  },
);
indexer.onEvent(
  { contract: "Hook", event: "HookFeesAccrued" },
  async ({ event, context }) => {
    const p = event.params;
    context.HookFee.set({
      id: eventId(event),
      token: p.token,
      asset: p.asset,
      baseFee: p.baseFee,
      creatorTax: p.creatorTax,
      timestamp: BigInt(event.block.timestamp),
      transactionHash: event.transaction.hash,
    });
  },
);
indexer.onEvent(
  { contract: "Treasury", event: "IncomeAllocated" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      previous = await context.TreasuryAsset.get(p.asset);
    context.TreasuryAsset.set({
      id: p.asset,
      received: (previous?.received ?? 0n) + p.received,
      reservedBuyback: (previous?.reservedBuyback ?? 0n) + p.buybackAmount,
      opsAccrued: (previous?.opsAccrued ?? 0n) + p.opsAmount,
      opsClaimed: previous?.opsClaimed ?? 0n,
    });
  },
);
indexer.onEvent(
  { contract: "Treasury", event: "OpsClaimed" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const previous = await context.TreasuryAsset.getOrThrow(event.params.asset);
    context.TreasuryAsset.set({
      ...previous,
      opsClaimed: previous.opsClaimed + event.params.amount,
    });
  },
);
indexer.onEvent(
  { contract: "Treasury", event: "ProtocolBuybackProcessed" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params,
      previous = await context.TreasuryAsset.getOrThrow(p.quoteAsset);
    if (previous.reservedBuyback < p.quoteSpent)
      throw new Error("Protocol buyback exceeds indexed reserve.");
    context.TreasuryAsset.set({
      ...previous,
      reservedBuyback: previous.reservedBuyback - p.quoteSpent,
    });
  },
);

indexer.onEvent(
  { contract: "PaymentRouter", event: "RoutedTrade" },
  async ({ event, context }) => {
    if (!(await once(context, event))) return;
    const p = event.params;
    const link = await context.LatestSettlement.getOrThrow(
      `${event.chainId}:${event.transaction.hash}:${p.token}`,
    );
    const trade = await context.Trade.getOrThrow(link.tradeId);
    if (
      trade.trader !== event.srcAddress ||
      trade.tokens !== p.tokenAmount ||
      trade.quoteAmount !== p.quoteAmount ||
      trade.side !== (p.buy ? "buy" : "sell") ||
      trade.venue !== (p.phase === 0n ? "curve" : "pool")
    )
      throw new Error("Routed payment does not match its settled trade.");
    context.Trade.set({ ...trade, trader: p.trader, recipient: p.trader });
    context.RoutedPayment.set({
      id: eventId(event),
      tradeId: trade.id,
      router: event.srcAddress,
      paymentAsset: p.paymentAsset,
      paymentAmount: p.paymentAmount,
      refundAsset: p.refundAsset,
      refundAmount: p.refundAmount,
    });
    // Source events already updated reserves, fees, volume and trade count.
  },
);

// Launch options are emitted after TokenLaunched, so membership is already known.
// A bounded effect resolves the immutable recipient set once, not per portfolio request.
indexer.onEvent(
  { contract: "LaunchRouter", event: "LaunchOptionsConfigured" },
  async ({event, context}) => {
    if (!(await once(context, event))) return;
    if (event.params.royaltySplitter === ZERO) return;
    const launch = await context.Launch.get(event.params.token);
    if (!launch?.registered || !launch.factory || !launch.quoteAsset)
      throw new Error("Royalty options are missing their canonical factory launch.");
    const recipients = await context.effect(royaltyRecipientsEffect, {
      factory: launch.factory, router: event.srcAddress, token: event.params.token,
      quote: launch.quoteAsset, splitter: event.params.royaltySplitter,
      blockNumber: BigInt(event.block.number), blockHash: event.block.hash,
      buyTaxBps: Number(event.params.buyTaxBps), sellTaxBps: Number(event.params.sellTaxBps),
      minimumHolderBalance: event.params.minimumHolderBalance, optionsHash: event.params.optionsHash,
    });
    for (const recipient of recipients) context.RoyaltyRecipient.set({
      id: `${event.params.token}:${recipient.account}`, token: event.params.token,
      account: recipient.account, splitter: event.params.royaltySplitter,
      factory: launch.factory, shareBps: recipient.shareBps, createdBlock: BigInt(event.block.number),
    });
  },
);
