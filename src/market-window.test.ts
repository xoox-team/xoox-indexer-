import { expect, it } from "vitest";
import { createTestIndexer } from "envio";
import type { Address } from "viem";
import "./handlers/index";

const token = "0x1000000000000000000000000000000000000000" as Address;
const curve = "0x2000000000000000000000000000000000000000" as Address;
const creator = "0x3000000000000000000000000000000000000000" as Address;
const factory = "0x4000000000000000000000000000000000000000" as Address;
const feeVault = "0x5000000000000000000000000000000000000000" as Address;
const hook = "0x6000000000000000000000000000000000000000" as Address;
const router = "0x7000000000000000000000000000000000000000" as Address;
const manager = "0x8000000000000000000000000000000000000000" as Address;
const externalRouter = "0xb000000000000000000000000000000000000000" as Address;
const secondaryQuote = "0xc000000000000000000000000000000000000000" as Address;
const otherFactory = "0xd000000000000000000000000000000000000000" as Address;
const zero = "0x0000000000000000000000000000000000000000" as Address;
const primaryPool = `0x${"ab".repeat(32)}` as `0x${string}`;
const secondaryPool = `0x${"cd".repeat(32)}` as `0x${string}`;

async function seedLaunch(test: ReturnType<typeof createTestIndexer>) {
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "FeeVault",
            event: "BuybackExecutorConfigured",
            srcAddress: feeVault,
            block: { number: 1, timestamp: 1 },
            params: { executor: router },
          },
          {
            contract: "Factory",
            event: "TokenLaunched",
            srcAddress: factory,
            block: { number: 1, timestamp: 1 },
            params: { token, curve, creator, quoteAsset: zero, configId: 0n },
          },
          {
            contract: "Factory",
            event: "LaunchEconomicsSnapshotted",
            srcAddress: factory,
            block: { number: 1, timestamp: 1 },
            params: {
              token,
              supply: 1_000n,
              phantomQuote: 100n,
              graduationThreshold: 250n,
              baseBps: 100n,
              creatorTaxBps: 0n,
              protocolShareBps: 3_000n,
              buybackShareBps: 5_000n,
              buybackEnabled: false,
              dividendVault: zero,
              dividendShareBps: 0n,
            },
          },
        ],
      },
    },
  });
}

it("aggregates public curve trades into hourly OHLC and volume", async () => {
  const test = createTestIndexer();
  await seedLaunch(test);
  expect((await test.Launch.getOrThrow(token)).factory).toBe(factory);
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Curve",
            event: "CurveBuy",
            srcAddress: curve,
            block: { number: 2, timestamp: 3_605 },
            transaction: { hash: `0x${"21".repeat(32)}` },
            logIndex: 1,
            params: {
              buyer: creator,
              recipient: creator,
              tokensOut: 100n,
              quoteSpent: 12n,
              quoteRefund: 0n,
              baseFee: 1n,
              creatorTax: 0n,
              snipeTax: 0n,
              realQuoteReserve: 11n,
              tokenReserve: 900n,
            },
          },
          {
            contract: "Curve",
            event: "CurveSell",
            srcAddress: curve,
            block: { number: 3, timestamp: 3_605 },
            transaction: { hash: `0x${"31".repeat(32)}` },
            logIndex: 1,
            params: {
              seller: creator,
              recipient: creator,
              tokensIn: 50n,
              quoteOut: 4n,
              baseFee: 1n,
              creatorTax: 0n,
              realQuoteReserve: 7n,
              tokenReserve: 950n,
            },
          },
        ],
      },
    },
  });

  const candle = await test.HourCandle.getOrThrow(`${token}:3600`);
  const open = (111n * 10n ** 36n) / 900n;
  const close = (107n * 10n ** 36n) / 950n;
  expect(candle).toMatchObject({
    token,
    quoteAsset: zero,
    bucketStart: 3_600n,
    quoteVolume: 16n,
    tradeCount: 2n,
    cumulativeQuoteVolume: 16n,
    cumulativeTradeCount: 2n,
    openPriceQuoteX18: open,
    highPriceQuoteX18: open,
    lowPriceQuoteX18: close,
    closePriceQuoteX18: close,
  });
  expect(await test.MarketSecond.getOrThrow(`${token}:3605`)).toMatchObject({
    token,
    quoteAsset: zero,
    timestamp: 3_605n,
    quoteVolume: 16n,
    tradeCount: 2n,
    cumulativeQuoteVolume: 16n,
    cumulativeTradeCount: 2n,
  });
});

it("rejects the same token registered by two deployment factories", async () => {
  const test = createTestIndexer();
  await seedLaunch(test);
  test.Launch.set({
    ...(await test.Launch.getOrThrow(token)),
    factory: otherFactory,
  } as never);
  await expect(
    test.process({
      chains: {
        143: {
          simulate: [
            {
              contract: "Factory",
              event: "TokenLaunched",
              srcAddress: factory,
              block: { number: 2, timestamp: 2 },
              transaction: { hash: `0x${"d1".repeat(32)}` },
              logIndex: 1,
              params: { token, curve, creator, quoteAsset: zero, configId: 0n },
            },
          ],
        },
      },
    }),
  ).rejects.toThrow("multiple deployment factories");
});

it("starts a new candle at the exact hour boundary", async () => {
  const test = createTestIndexer();
  await seedLaunch(test);
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Curve",
            event: "CurveBuy",
            srcAddress: curve,
            block: { number: 2, timestamp: 3_599 },
            transaction: { hash: `0x${"41".repeat(32)}` },
            logIndex: 1,
            params: {
              buyer: creator,
              recipient: creator,
              tokensOut: 10n,
              quoteSpent: 2n,
              quoteRefund: 0n,
              baseFee: 0n,
              creatorTax: 0n,
              snipeTax: 0n,
              realQuoteReserve: 2n,
              tokenReserve: 990n,
            },
          },
          {
            contract: "Curve",
            event: "CurveBuy",
            srcAddress: curve,
            block: { number: 3, timestamp: 3_600 },
            transaction: { hash: `0x${"51".repeat(32)}` },
            logIndex: 1,
            params: {
              buyer: creator,
              recipient: creator,
              tokensOut: 10n,
              quoteSpent: 3n,
              quoteRefund: 0n,
              baseFee: 0n,
              creatorTax: 0n,
              snipeTax: 0n,
              realQuoteReserve: 5n,
              tokenReserve: 980n,
            },
          },
        ],
      },
    },
  });

  expect(await test.HourCandle.getAll()).toHaveLength(2);
  expect(await test.HourCandle.getOrThrow(`${token}:0`)).toMatchObject({
    quoteVolume: 2n,
    tradeCount: 1n,
    bucketStart: 0n,
  });
  expect(await test.HourCandle.getOrThrow(`${token}:3600`)).toMatchObject({
    quoteVolume: 3n,
    tradeCount: 1n,
    bucketStart: 3_600n,
  });
});

it("counts each public primary-pair pool trade once and excludes internal and Duo swaps", async () => {
  const test = createTestIndexer();
  await seedLaunch(test);
  const protocolTx = `0x${"61".repeat(32)}` as `0x${string}`;
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Hook",
            event: "PoolRegistered",
            srcAddress: hook,
            block: { number: 2, timestamp: 7_100 },
            params: { poolId: primaryPool, token },
          },
          {
            contract: "PoolManager",
            event: "Initialize",
            srcAddress: manager,
            block: { number: 2, timestamp: 7_100 },
            params: {
              id: primaryPool,
              currency0: zero,
              currency1: token,
              fee: 0n,
              tickSpacing: 200n,
              hooks: hook,
              sqrtPriceX96: 1n << 96n,
              tick: 0n,
            },
          },
          {
            contract: "Factory",
            event: "Graduated",
            srcAddress: factory,
            block: { number: 2, timestamp: 7_100 },
            params: {
              token,
              poolId: primaryPool,
              positionId: 1n,
              residualTokensLocked: 0n,
            },
          },
          {
            contract: "PoolManager",
            event: "Swap",
            srcAddress: manager,
            block: { number: 3, timestamp: 7_205 },
            transaction: { hash: `0x${"71".repeat(32)}` },
            logIndex: 1,
            params: {
              id: primaryPool,
              sender: externalRouter,
              amount0: -7n,
              amount1: 6n,
              sqrtPriceX96: 1n << 96n,
              liquidity: 1_000n,
              tick: 0n,
              fee: 0n,
            },
          },
          {
            contract: "PoolManager",
            event: "Swap",
            srcAddress: manager,
            block: { number: 4, timestamp: 7_210 },
            transaction: { hash: protocolTx },
            logIndex: 1,
            params: {
              id: primaryPool,
              sender: router,
              amount0: 3n,
              amount1: -4n,
              sqrtPriceX96: 2n << 96n,
              liquidity: 1_000n,
              tick: 0n,
              fee: 0n,
            },
          },
          {
            contract: "SwapRouter",
            event: "PoolTrade",
            srcAddress: router,
            block: { number: 4, timestamp: 7_210 },
            transaction: { hash: protocolTx },
            logIndex: 2,
            params: {
              token,
              trader: creator,
              recipient: creator,
              buy: false,
              amountIn: 4n,
              amountOut: 3n,
            },
          },
          {
            contract: "Hook",
            event: "PoolRegistered",
            srcAddress: hook,
            block: { number: 5, timestamp: 7_220 },
            params: { poolId: secondaryPool, token },
          },
          {
            contract: "PoolManager",
            event: "Initialize",
            srcAddress: manager,
            block: { number: 5, timestamp: 7_220 },
            params: {
              id: secondaryPool,
              currency0: secondaryQuote,
              currency1: token,
              fee: 0n,
              tickSpacing: 200n,
              hooks: hook,
              sqrtPriceX96: 1n << 96n,
              tick: 0n,
            },
          },
          {
            contract: "PoolManager",
            event: "Swap",
            srcAddress: manager,
            block: { number: 6, timestamp: 7_230 },
            transaction: { hash: `0x${"81".repeat(32)}` },
            logIndex: 1,
            params: {
              id: secondaryPool,
              sender: externalRouter,
              amount0: -50n,
              amount1: 40n,
              sqrtPriceX96: 1n << 96n,
              liquidity: 1_000n,
              tick: 0n,
              fee: 0n,
            },
          },
          {
            contract: "SwapRouter",
            event: "DuoPoolTrade",
            srcAddress: router,
            block: { number: 6, timestamp: 7_230 },
            transaction: { hash: `0x${"91".repeat(32)}` },
            logIndex: 2,
            params: {
              token,
              trader: creator,
              poolId: secondaryPool,
              recipient: creator,
              quoteAsset: secondaryQuote,
              buy: true,
              amountIn: 50n,
              amountOut: 40n,
            },
          },
        ],
      },
    },
  });

  const candle = await test.HourCandle.getOrThrow(`${token}:7200`);
  expect(candle).toMatchObject({ quoteVolume: 10n, tradeCount: 2n });
  expect(await test.HourCandle.getAll()).toHaveLength(1);
  const externalSwap = (await test.PoolSwap.getAll()).find(
    (swap) => swap.sender === externalRouter && swap.poolId === primaryPool,
  );
  expect(externalSwap).toMatchObject({ blockNumber: 3n, logIndex: 1 });
});

it("does not count internal curve buy or sell conversions", async () => {
  const test = createTestIndexer();
  await seedLaunch(test);
  const publicEvent = {
    contract: "Curve" as const,
    event: "CurveBuy" as const,
    srcAddress: curve,
    block: { number: 4, timestamp: 10_900 },
    transaction: { hash: `0x${"a1".repeat(32)}` as `0x${string}` },
    logIndex: 1,
    params: {
      buyer: creator,
      recipient: creator,
      tokensOut: 10n,
      quoteSpent: 5n,
      quoteRefund: 0n,
      baseFee: 0n,
      creatorTax: 0n,
      snipeTax: 0n,
      realQuoteReserve: 8n,
      tokenReserve: 985n,
    },
  };
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Curve",
            event: "CurveBuy",
            srcAddress: curve,
            block: { number: 2, timestamp: 10_850 },
            transaction: { hash: `0x${"b1".repeat(32)}` },
            logIndex: 1,
            params: {
              buyer: router,
              recipient: feeVault,
              tokensOut: 10n,
              quoteSpent: 4n,
              quoteRefund: 0n,
              baseFee: 0n,
              creatorTax: 0n,
              snipeTax: 0n,
              realQuoteReserve: 4n,
              tokenReserve: 990n,
            },
          },
          {
            contract: "Curve",
            event: "CurveSell",
            srcAddress: curve,
            block: { number: 3, timestamp: 10_860 },
            transaction: { hash: `0x${"c1".repeat(32)}` },
            logIndex: 1,
            params: {
              seller: router,
              recipient: feeVault,
              tokensIn: 5n,
              quoteOut: 1n,
              baseFee: 0n,
              creatorTax: 0n,
              realQuoteReserve: 3n,
              tokenReserve: 995n,
            },
          },
          publicEvent,
        ],
      },
    },
  });
  expect(await test.HourCandle.getAll()).toHaveLength(1);
  expect(await test.HourCandle.getOrThrow(`${token}:10800`)).toMatchObject({
    quoteVolume: 5n,
    tradeCount: 1n,
  });
});
