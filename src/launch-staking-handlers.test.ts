import { expect, it } from "vitest";
import { createTestIndexer } from "envio";
import { quoteBuy, quoteSell, tokenReserveAt } from "./vendor/xoox-sdk/curve";
import "./handlers/index";
const token = "0x1000000000000000000000000000000000000000",
  curve = "0x2000000000000000000000000000000000000000",
  creator = "0x3000000000000000000000000000000000000000",
  factory = "0x4000000000000000000000000000000000000000",
  pool = "0xa000000000000000000000000000000000000000",
  zero = "0x0000000000000000000000000000000000000000";
const supply = 10n ** 27n,
  rewardAmount = supply / 4n,
  curveAllocation = supply - rewardAmount,
  unit = 10n ** 18n,
  phantomQuote = 100n * unit,
  graduationThreshold = 250n * unit;
const tx = (n: number) =>
  `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const snapshot = {
  contract: "Factory",
  event: "LaunchEconomicsSnapshotted",
  srcAddress: factory,
  params: {
    token,
    supply,
    phantomQuote,
    graduationThreshold,
    baseBps: 0n,
    creatorTaxBps: 0n,
    protocolShareBps: 3000n,
    buybackShareBps: 5000n,
    buybackEnabled: false,
    dividendVault: zero,
    dividendShareBps: 0n,
  },
} as const;
const staking = {
  contract: "Factory",
  event: "LaunchStakingConfigured",
  srcAddress: factory,
  params: {
    token,
    pool,
    totalSupply: supply,
    curveAllocation,
    rewardAmount,
    duration: 30n * 86_400n,
  },
} as const;
async function seed(
  test: ReturnType<typeof createTestIndexer>,
  snapshotFirst = true,
) {
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Factory",
            event: "TokenLaunched",
            srcAddress: factory,
            block: { number: 1 },
            transaction: { hash: tx(1) },
            params: { token, curve, creator, quoteAsset: zero, configId: 0n },
          },
          {
            ...(snapshotFirst ? snapshot : staking),
            block: { number: 2 },
            transaction: { hash: tx(2) },
          },
          {
            ...(snapshotFirst ? staking : snapshot),
            block: { number: 3 },
            transaction: { hash: tx(3) },
          },
        ],
      },
    },
  });
}
it.each([true, false])(
  "keeps full FDV supply and only reduces curve inventory, independent of snapshot order (%s)",
  async (snapshotFirst) => {
    const test = createTestIndexer();
    await seed(test, snapshotFirst);
    expect(await test.Launch.getOrThrow(token)).toMatchObject({
      supply,
      curveSupply: curveAllocation,
      tokenReserve: curveAllocation,
      stakingPool: pool,
      stakingRewardAmount: rewardAmount,
      stakingDuration: 30n * 86_400n,
      tradeCount: 0n,
      quoteVolume: 0n,
      marketCapQuote: (phantomQuote * supply) / curveAllocation,
    });
  },
);
it("preserves reserve metadata and full supply through buy, sell, and graduation", async () => {
  const test = createTestIndexer();
  await seed(test);
  const state = {
    supply: curveAllocation,
    phantomQuote,
    graduationThreshold,
    tokenReserve: curveAllocation,
    realQuoteReserve: 0n,
    feeBps: 0n,
    creatorTaxBps: 0n,
  };
  const buy = quoteBuy(state, 10n * unit);
  const next = {
    ...state,
    tokenReserve: curveAllocation - buy.tokensOut,
    realQuoteReserve: buy.spent,
  };
  const sell = quoteSell(next, buy.tokensOut / 2n);
  const finalReal = next.realQuoteReserve - sell.grossQuote,
    finalTokens = next.tokenReserve + buy.tokensOut / 2n;
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Curve",
            event: "CurveBuy",
            srcAddress: curve,
            block: { number: 4 },
            transaction: { hash: tx(4) },
            params: {
              buyer: creator,
              recipient: creator,
              ...buy,
              quoteSpent: buy.spent,
              quoteRefund: buy.refund,
              realQuoteReserve: next.realQuoteReserve,
              tokenReserve: next.tokenReserve,
            },
          },
          {
            contract: "Curve",
            event: "CurveSell",
            srcAddress: curve,
            block: { number: 5 },
            transaction: { hash: tx(5) },
            params: {
              seller: creator,
              recipient: creator,
              tokensIn: buy.tokensOut / 2n,
              quoteOut: sell.quoteOut,
              baseFee: 0n,
              creatorTax: 0n,
              realQuoteReserve: finalReal,
              tokenReserve: finalTokens,
            },
          },
        ],
      },
    },
  });
  expect(await test.Launch.getOrThrow(token)).toMatchObject({
    supply,
    curveSupply: curveAllocation,
    stakingRewardAmount: rewardAmount,
    realQuoteReserve: finalReal,
    tokenReserve: finalTokens,
    marketCapQuote: ((phantomQuote + finalReal) * supply) / finalTokens,
    tradeCount: 2n,
  });
  const terminal = tokenReserveAt(
      curveAllocation,
      phantomQuote,
      graduationThreshold,
    ),
    poolId = `0x${"ab".repeat(32)}` as const;
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Factory",
            event: "GraduationSwept",
            srcAddress: factory,
            block: { number: 6 },
            transaction: { hash: tx(6) },
            params: {
              token,
              quoteAmount: graduationThreshold,
              tokenAmount: terminal,
              sweptAt: 6n,
            },
          },
          {
            contract: "Factory",
            event: "Graduated",
            srcAddress: factory,
            block: { number: 7 },
            transaction: { hash: tx(7) },
            params: { token, poolId, positionId: 1n, residualTokensLocked: 0n },
          },
        ],
      },
    },
  });
  expect(await test.Launch.getOrThrow(token)).toMatchObject({
    phase: 2,
    supply,
    curveSupply: curveAllocation,
    stakingRewardAmount: rewardAmount,
    stakingPool: pool,
    marketCapQuote: ((phantomQuote + graduationThreshold) * supply) / terminal,
    tokenReserve: terminal,
    progressBps: 10000n,
  });
});
it("rejects impossible reserve splits rather than displaying misleading supply", async () => {
  const test = createTestIndexer();
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Factory",
            event: "TokenLaunched",
            srcAddress: factory,
            block: { number: 1 },
            transaction: { hash: tx(1) },
            params: { token, curve, creator, quoteAsset: zero, configId: 0n },
          },
          { ...snapshot, block: { number: 2 }, transaction: { hash: tx(2) } },
        ],
      },
    },
  });
  await expect(
    test.process({
      chains: {
        143: {
          simulate: [
            {
              ...staking,
              block: { number: 3 },
              transaction: { hash: tx(3) },
              params: { ...staking.params, curveAllocation: supply },
            },
          ],
        },
      },
    }),
  ).rejects.toThrow();
});
