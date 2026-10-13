import { expect, it } from "vitest";
import { createTestIndexer } from "envio";
import type { Address } from "viem";
import "./handlers/index";

const token: Address = "0x1000000000000000000000000000000000000000";
const curve: Address = "0x2000000000000000000000000000000000000000";
const creator: Address = "0x3000000000000000000000000000000000000000";
const factory: Address = "0x4000000000000000000000000000000000000000";
const vault: Address = "0xa000000000000000000000000000000000000000";
const buyer: Address = "0xc000000000000000000000000000000000000000";
const zero: Address = "0x0000000000000000000000000000000000000000";
const hash = (byte: string) => `0x${byte.repeat(32)}` as `0x${string}`;

async function seed(test: ReturnType<typeof createTestIndexer>, policyFirst = false) {
  const policy = {
    contract: "Factory" as const, event: "HolderFeeSharingConfigured" as const, srcAddress: factory,
    block: { number: 1 }, params: { token, vault, mode: 4n, baseShareBps: 10000n, taxShareBps: 10000n },
  };
  const launch = {
    contract: "Factory" as const, event: "TokenLaunched" as const, srcAddress: factory,
    block: { number: 1 }, params: { token, curve, creator, quoteAsset: zero, configId: 0n },
  };
  const events = [
    ...(policyFirst ? [policy, launch] : [launch, policy]),
    { contract: "Token", event: "Transfer", srcAddress: token, block: { number: 1 }, params: { from: zero, to: curve, value: 1000n } },
    { contract: "Factory", event: "LaunchEconomicsSnapshotted", srcAddress: factory, block: { number: 1 }, params: {
      token, supply: 1000n, phantomQuote: 100n, graduationThreshold: 250n, baseBps: 100n, creatorTaxBps: 500n,
      protocolShareBps: 3000n, buybackShareBps: 0n, buybackEnabled: false, dividendVault: vault, dividendShareBps: 10000n,
    } },
  ] as const;
  await test.process({ chains: { 143: { simulate: events.map((event, logIndex) => ({ ...event, logIndex, transaction: { hash: hash("11") } })) } } });
}

it.each([false, true])("discovers OG vaults from the explicit factory policy (policy first=%s)", async policyFirst => {
  const test = createTestIndexer();
  await seed(test, policyFirst);
  await test.process({ chains: { 143: { simulate: [
    { contract: "OgDividendVault", event: "OgRewardsDeposited", srcAddress: vault, block: { number: 2 }, params: { amount: 70n } },
  ] } } });
  expect(await test.Launch.getOrThrow(token)).toMatchObject({ holderFeeMode: 4, dividendShareBps: 10000n, dividendTaxShareBps: 10000n });
  expect(await test.OgRewardBalance.getOrThrow(vault)).toMatchObject({ token, quoteAsset: zero, deposited: 70n, queued: 70n, allocated: 0n, remaining: 70n });
  expect(await test.DividendEpoch.getAll()).toHaveLength(0);
});

it("retains disqualification after further transfers and pays already-funded claims without epochs", async () => {
  const test = createTestIndexer();
  await seed(test);
  await test.process({ chains: { 143: { simulate: [
    { contract: "Token", event: "Transfer", srcAddress: token, block: { number: 2 }, params: { from: curve, to: creator, value: 100n } },
    { contract: "OgDividendVault", event: "OgRewardsDeposited", srcAddress: vault, block: { number: 3 }, params: { amount: 100n } },
    { contract: "OgDividendVault", event: "OgRewardsAllocated", srcAddress: vault, block: { number: 3 }, params: { amount: 100n, eligibleSupply: 100n } },
    { contract: "OgDividendVault", event: "OgHolderDisqualified", srcAddress: vault, block: { number: 4 }, params: { account: creator } },
    { contract: "Token", event: "Transfer", srcAddress: token, block: { number: 4 }, params: { from: creator, to: buyer, value: 40n } },
    { contract: "Token", event: "Transfer", srcAddress: token, block: { number: 5 }, params: { from: curve, to: creator, value: 20n } },
    { contract: "OgDividendVault", event: "OgDividendClaimed", srcAddress: vault, block: { number: 6 }, params: { beneficiary: creator, amount: 90n } },
  ] } } });
  expect(await test.Holder.getOrThrow(`${token}:${creator}`)).toMatchObject({ balance: 80n });
  expect(await test.OgHolderEligibility.getOrThrow(`${vault}:${creator}`)).toMatchObject({ token, account: creator, disqualified: true, blockNumber: 4n });
  // Receiving tokens alone does not prove activation or exemption status.
  expect(await test.OgHolderEligibility.get(`${vault}:${buyer}`)).toBeUndefined();
  expect(await test.OgRewardBalance.getOrThrow(vault)).toMatchObject({ deposited: 100n, allocated: 100n, queued: 0n, claimed: 90n, remaining: 10n });
  expect(await test.OgRewardClaim.getAll()).toHaveLength(1);
  expect(await test.OgRewardAllocation.getAll()).toHaveLength(1);
  expect(await test.DividendEpoch.getAll()).toHaveLength(0);
});

it("deduplicates OG deposits, allocations, disqualifications and claims by canonical log identity", async () => {
  const test = createTestIndexer();
  await seed(test);
  const deposit = { contract: "OgDividendVault" as const, event: "OgRewardsDeposited" as const, srcAddress: vault, block: { number: 2 }, transaction: { hash: hash("21") }, logIndex: 1, params: { amount: 100n } };
  const allocation = { contract: "OgDividendVault" as const, event: "OgRewardsAllocated" as const, srcAddress: vault, block: { number: 2 }, transaction: { hash: hash("21") }, logIndex: 2, params: { amount: 100n, eligibleSupply: 100n } };
  const disqualification = { contract: "OgDividendVault" as const, event: "OgHolderDisqualified" as const, srcAddress: vault, block: { number: 3 }, transaction: { hash: hash("31") }, logIndex: 1, params: { account: creator } };
  const claim = { contract: "OgDividendVault" as const, event: "OgDividendClaimed" as const, srcAddress: vault, block: { number: 4 }, transaction: { hash: hash("41") }, logIndex: 1, params: { beneficiary: creator, amount: 25n } };
  const events = [deposit, allocation, disqualification, claim];
  await test.process({ chains: { 143: { simulate: events } } });
  // Resume from persisted entities with an earlier scan cursor. Envio's test
  // runner forbids replay behind its current cursor, so restore a fresh runner.
  const replay = createTestIndexer();
  await seed(replay);
  replay.OgRewardBalance.set(await test.OgRewardBalance.getOrThrow(vault));
  for (const row of await test.OgRewardAllocation.getAll()) replay.OgRewardAllocation.set(row);
  for (const row of await test.OgRewardClaim.getAll()) replay.OgRewardClaim.set(row);
  for (const row of await test.OgHolderEligibility.getAll()) replay.OgHolderEligibility.set(row);
  for (const row of await test.ProcessedEvent.getAll()) replay.ProcessedEvent.set(row);
  await replay.process({ chains: { 143: { simulate: events } } });
  expect(await replay.OgRewardBalance.getOrThrow(vault)).toMatchObject({ deposited: 100n, allocated: 100n, claimed: 25n, remaining: 75n });
  expect(await replay.OgRewardAllocation.getAll()).toHaveLength(1);
  expect(await replay.OgRewardClaim.getAll()).toHaveLength(1);
  expect(await replay.OgHolderEligibility.getAll()).toHaveLength(1);
});

it("fails closed when claims would spend funding that has not been allocated", async () => {
  const test = createTestIndexer();
  await seed(test);
  await test.process({ chains: { 143: { simulate: [
    { contract: "OgDividendVault", event: "OgRewardsDeposited", srcAddress: vault, block: { number: 2 }, params: { amount: 100n } },
  ] } } });
  await expect(test.process({ chains: { 143: { simulate: [
    { contract: "OgDividendVault", event: "OgDividendClaimed", srcAddress: vault, block: { number: 3 }, transaction: { hash: hash("31") }, params: { beneficiary: creator, amount: 1n } },
  ] } } })).rejects.toThrow();
});
