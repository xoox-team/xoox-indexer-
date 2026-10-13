import { expect, it } from "vitest";
import { createTestIndexer } from "envio";
import type { Address } from "viem";
import "./handlers/index";

const token = "0x1000000000000000000000000000000000000000";
const curve = "0x2000000000000000000000000000000000000000";
const creator = "0x3000000000000000000000000000000000000000";
const factory = "0x4000000000000000000000000000000000000000";
const feeVault = "0x5000000000000000000000000000000000000000";
const hook = "0x6000000000000000000000000000000000000000";
const router = "0x7000000000000000000000000000000000000000";
const manager = "0x8000000000000000000000000000000000000000";
const publicRouter = "0xb000000000000000000000000000000000000000";
const usd = "0xc000000000000000000000000000000000000000";
const native = "0x0000000000000000000000000000000000000000";
const primaryPool = `0x${"ab".repeat(32)}`;
const secondPool = `0x${"cd".repeat(32)}`;

async function seed(
  test: ReturnType<typeof createTestIndexer>,
  primary: Address,
  withSwap = true,
) {
  const quoteIs0 = primary < token;
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "FeeVault",
            event: "BuybackExecutorConfigured",
            srcAddress: feeVault,
            block: { number: 1 },
            params: { executor: router },
          },
          {
            contract: "Factory",
            event: "QuoteAssetUpdated",
            srcAddress: factory,
            block: { number: 1 },
            params: { asset: usd, approved: true, decimals: 6n },
          },
          {
            contract: "Factory",
            event: "QuoteAssetUpdated",
            srcAddress: factory,
            block: { number: 1 },
            params: { asset: native, approved: true, decimals: 18n },
          },
          {
            contract: "Factory",
            event: "TokenLaunched",
            srcAddress: factory,
            block: { number: 1 },
            params: {
              token,
              curve,
              creator,
              quoteAsset: primary,
              configId: 0n,
            },
          },
          {
            contract: "Token",
            event: "TokenMetadata",
            srcAddress: token,
            block: { number: 1 },
            params: {
              name: "Duo",
              symbol: "DUO",
              image: "",
              description: "",
              website: "",
              twitter: "",
              telegram: "",
              supply: 10n ** 27n,
            },
          },
          {
            contract: "Hook",
            event: "PoolRegistered",
            srcAddress: hook,
            block: { number: 2 },
            params: { poolId: primaryPool, token },
          },
          {
            contract: "PoolManager",
            event: "Initialize",
            srcAddress: manager as Address,
            block: { number: 2 },
            params: {
              id: primaryPool,
              currency0: quoteIs0 ? primary : token,
              currency1: quoteIs0 ? token : primary,
              fee: 0n,
              tickSpacing: 200n,
              hooks: hook,
              sqrtPriceX96: 1n << 96n,
              tick: 0n,
            },
          },
          ...(withSwap
            ? [
                {
                  contract: "PoolManager" as const,
                  event: "Swap" as const,
                  srcAddress: manager as Address,
                  block: { number: 3 },
                  params: {
                    id: primaryPool,
                    sender: publicRouter as Address,
                    amount0: -(10n ** 18n),
                    amount1: 10n ** 18n,
                    sqrtPriceX96: 1n << 96n,
                    liquidity: 10n ** 18n,
                    tick: 0n,
                    fee: 0n,
                  },
                },
              ]
            : []),
        ],
      },
    },
  });
}

it("prices a direct launch from the initialized primary pool before its first trade", async () => {
  const test = createTestIndexer();
  await seed(test, native, false);
  expect((await test.Launch.getOrThrow(token)).priceQuoteX18).toBeUndefined();
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Hook",
            event: "PoolRegistered",
            srcAddress: hook,
            block: { number: 3 },
            params: { token, poolId: secondPool },
          },
          {
            contract: "PoolManager",
            event: "Initialize",
            srcAddress: manager,
            block: { number: 3 },
            params: {
              id: secondPool,
              currency0: token,
              currency1: usd,
              fee: 0n,
              tickSpacing: 200n,
              hooks: hook,
              sqrtPriceX96: 3n << 96n,
              tick: 21973n,
            },
          },
          {
            contract: "Factory",
            event: "Graduated",
            srcAddress: factory,
            block: { number: 3 },
            params: {
              token,
              poolId: primaryPool,
              positionId: 1n,
              residualTokensLocked: 0n,
            },
          },
          {
            contract: "Factory",
            event: "DuoPoolRecorded",
            srcAddress: factory,
            block: { number: 3 },
            params: { token, poolId: secondPool, positionId: 2n },
          },
        ],
      },
    },
  });
  expect(await test.Launch.getOrThrow(token)).toMatchObject({
    phase: 2,
    poolId: primaryPool,
    priceQuoteX18: 10n ** 36n,
    marketCapQuote: 10n ** 27n,
    quoteVolume: 0n,
    tradeCount: 0n,
    lastTradeAt: undefined,
  });
  expect(await test.PoolSwap.getAll()).toHaveLength(0);
});

it.each([
  { primary: native, secondary: usd, secondaryAmount: 123_000_000n },
  { primary: usd, secondary: native, secondaryAmount: 123n * 10n ** 18n },
] as const)(
  "preserves canonical metrics when the other pool trades in $secondary",
  async ({ primary, secondary, secondaryAmount }) => {
    const test = createTestIndexer();
    await seed(test, primary);
    const before = await test.Launch.getOrThrow(token);
    const quoteIs0 = secondary < token;
    await test.process({
      chains: {
        143: {
          simulate: [
            {
              contract: "Hook",
              event: "PoolRegistered",
              srcAddress: hook,
              block: { number: 4 },
              params: { poolId: secondPool, token },
            },
            {
              contract: "PoolManager",
              event: "Initialize",
              srcAddress: manager,
              block: { number: 4 },
              params: {
                id: secondPool,
                currency0: quoteIs0 ? secondary : token,
                currency1: quoteIs0 ? token : secondary,
                fee: 0n,
                tickSpacing: 200n,
                hooks: hook,
                sqrtPriceX96: 2n << 96n,
                tick: 13863n,
              },
            },
            {
              contract: "PoolManager",
              event: "Swap",
              srcAddress: manager,
              block: { number: 5 },
              params: {
                id: secondPool,
                sender: publicRouter,
                amount0: quoteIs0 ? -secondaryAmount : 10n ** 18n,
                amount1: quoteIs0 ? 10n ** 18n : -secondaryAmount,
                sqrtPriceX96: 3n << 96n,
                liquidity: 1234n,
                tick: 21973n,
                fee: 0n,
              },
            },
          ],
        },
      },
    });
    expect(await test.Launch.getOrThrow(token)).toEqual(before);
    expect(await test.Pool.getOrThrow(secondPool)).toMatchObject({
      sqrtPriceX96: 3n << 96n,
      liquidity: 1234n,
      tick: 21973,
    });
    const swaps = await test.PoolSwap.getAll();
    expect(swaps).toHaveLength(2);
    expect(swaps.find((swap) => swap.poolId === secondPool)).toMatchObject({
      amount0: quoteIs0 ? -secondaryAmount : 10n ** 18n,
      amount1: quoteIs0 ? 10n ** 18n : -secondaryAmount,
    });
    expect(await test.Trade.getAll()).toHaveLength(0);
  },
);

it("stores settled Duo trades in their own quote without changing the canonical pool or public volume", async () => {
  const test = createTestIndexer();
  await seed(test, native);
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Factory",
            event: "Graduated",
            srcAddress: factory,
            block: { number: 4 },
            params: {
              token,
              poolId: primaryPool,
              positionId: 1n,
              residualTokensLocked: 0n,
            },
          },
          {
            contract: "Factory",
            event: "DuoConfigured",
            srcAddress: factory,
            block: { number: 4 },
            params: { token, secondaryQuote: usd },
          },
          {
            contract: "Hook",
            event: "PoolRegistered",
            srcAddress: hook,
            block: { number: 4 },
            params: { poolId: secondPool, token },
          },
          {
            contract: "PoolManager",
            event: "Initialize",
            srcAddress: manager,
            block: { number: 4 },
            params: {
              id: secondPool,
              currency0: token,
              currency1: usd,
              fee: 0n,
              tickSpacing: 200n,
              hooks: hook,
              sqrtPriceX96: 1n << 96n,
              tick: 0n,
            },
          },
          {
            contract: "Factory",
            event: "DuoPoolRecorded",
            srcAddress: factory,
            block: { number: 4 },
            params: { token, poolId: secondPool, positionId: 2n },
          },
        ],
      },
    },
  });
  const before = await test.Launch.getOrThrow(token);
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "PoolManager",
            event: "Swap",
            srcAddress: manager,
            block: { number: 5 },
            params: {
              id: secondPool,
              sender: router,
              amount0: 10n ** 18n,
              amount1: -123_000_000n,
              sqrtPriceX96: 3n << 96n,
              liquidity: 1234n,
              tick: 21973n,
              fee: 0n,
            },
          },
          {
            contract: "SwapRouter",
            event: "DuoPoolTrade",
            srcAddress: router,
            block: { number: 5 },
            params: {
              token,
              trader: creator,
              poolId: secondPool,
              recipient: creator,
              quoteAsset: usd,
              buy: true,
              amountIn: 123_000_000n,
              amountOut: 10n ** 18n,
            },
          },
          {
            contract: "SwapRouter",
            event: "DuoPoolTrade",
            srcAddress: router,
            block: { number: 6 },
            params: {
              token,
              trader: creator,
              poolId: secondPool,
              recipient: creator,
              quoteAsset: usd,
              buy: false,
              amountIn: 5n * 10n ** 17n,
              amountOut: 50_000_000n,
            },
          },
        ],
      },
    },
  });
  expect(await test.Launch.getOrThrow(token)).toEqual(before);
  expect(before.poolId).toBe(primaryPool);
  expect(await test.DuoState.getOrThrow(token)).toMatchObject({
    secondaryQuote: usd,
    poolId: secondPool,
    positionId: 2n,
  });
  const trades = await test.DuoTrade.getAll();
  expect(trades).toHaveLength(2);
  expect(trades.find((trade) => trade.side === "buy")).toMatchObject({
    token,
    poolId: secondPool,
    quoteAsset: usd,
    quoteAmount: 123_000_000n,
    tokens: 10n ** 18n,
    trader: creator,
    recipient: creator,
  });
  expect(trades.find((trade) => trade.side === "sell")).toMatchObject({
    quoteAsset: usd,
    quoteAmount: 50_000_000n,
    tokens: 5n * 10n ** 17n,
  });
  expect(await test.Trade.getAll()).toHaveLength(0);
  expect(await test.LatestSettlement.getAll()).toHaveLength(0);
});

it("records the launch-time supply split without diverting any fee allocation into a Duo budget", async () => {
  const test = createTestIndexer();
  await seed(test, native);
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Factory",
            event: "DuoConfigured",
            srcAddress: factory,
            block: { number: 4 },
            params: { token, secondaryQuote: usd },
          },
          {
            contract: "Factory",
            event: "DuoLaunched",
            srcAddress: factory,
            block: { number: 4 },
            params: {
              token,
              primaryAllocation: 500n,
              secondaryAllocation: 500n,
            },
          },
          {
            contract: "FeeVault",
            event: "FeeStrategyAllocated",
            srcAddress: feeVault,
            block: { number: 5 },
            params: {
              token,
              asset: native,
              protocolAmount: 30n,
              creatorAmount: 0n,
              holderAmount: 50n,
              burnAmount: 20n,
              liquidityAmount: 100n,
            },
          },
        ],
      },
    },
  });
  expect(await test.StrategyBalance.getOrThrow(token)).toMatchObject({
    pendingLiquidity: 100n,
    pendingBurn: 20n,
  });
  expect(await test.DuoState.getOrThrow(token)).toMatchObject({
    secondaryQuote: usd,
    primaryAllocation: 500n,
    secondaryAllocation: 500n,
  });
  expect(await test.StrategyAllocation.getAll()).toHaveLength(1);
});

it("excludes configured Duo executor operations from primary public volume while updating price", async () => {
  const test = createTestIndexer();
  await seed(test, native);
  const before = await test.Launch.getOrThrow(token);
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Factory",
            event: "DuoExecutorConfigured",
            srcAddress: factory,
            block: { number: 4 },
            params: { executor: publicRouter },
          },
          {
            contract: "PoolManager",
            event: "Swap",
            srcAddress: manager,
            block: { number: 5 },
            params: {
              id: primaryPool,
              sender: publicRouter,
              amount0: -100n,
              amount1: 100n,
              sqrtPriceX96: 2n << 96n,
              liquidity: 1000n,
              tick: 0n,
              fee: 0n,
            },
          },
        ],
      },
    },
  });
  const after = await test.Launch.getOrThrow(token);
  expect(after.quoteVolume).toBe(before.quoteVolume);
  expect(after.tradeCount).toBe(before.tradeCount);
  expect(after.lastTradeAt).toBe(before.lastTradeAt);
  expect(after.priceQuoteX18).not.toBe(before.priceQuoteX18);
});
