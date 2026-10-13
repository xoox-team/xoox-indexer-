import { expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import { hashLaunchOptions } from "./vendor/xoox-sdk/launch-options";
import { readRoyaltyRecipients } from "./royalty-recipients";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const [factory, router, token, quote, vault, splitter, alice, bob] = Array.from(
  { length: 8 },
  (_, i) => addr(i + 1),
);
const blockHash = `0x${"ab".repeat(32)}`;
const options = {
  buyTaxBps: 300,
  sellTaxBps: 500,
  minimumHolderBalance: 100n,
  recipients: [alice, bob],
  shares: [6000, 4000],
};
const input = {
  factory,
  router,
  token,
  quote,
  splitter,
  blockNumber: 25n,
  blockHash,
  buyTaxBps: 300,
  sellTaxBps: 500,
  minimumHolderBalance: 100n,
  optionsHash: hashLaunchOptions(options),
};
function mock(overrides: Record<string, unknown> = {}) {
  const readContract = vi.fn(
    async (r: {
      functionName: string;
      address: Address;
      args?: unknown[];
      blockNumber: bigint;
    }) => {
      expect(r.blockNumber).toBe(25n);
      if (r.functionName in overrides) return overrides[r.functionName];
      return (
        {
          factory,
          launchRouter: router,
          royaltySplitter: splitter,
          launchOptionsVersion: 1n,
          token,
          quoteAsset: quote,
          feeVault: vault,
          royaltyVersion: 1n,
          recipientCount: 2n,
          feePolicy: { creatorFeeRecipient: splitter },
          recipients: options.recipients[Number(r.args?.[0])],
          shares: r.args?.[0] === alice ? 6000 : 4000,
          launchOptionsHash: input.optionsHash,
        } as Record<string, unknown>
      )[r.functionName];
    },
  );
  return {
    readContract,
    getBlock: vi.fn(async () => ({ hash: blockHash })),
  } as unknown as PublicClient;
}
it("reads immutable royalty recipients at the event block and verifies the complete options hash", async () => {
  await expect(readRoyaltyRecipients(mock(), input)).resolves.toEqual([
    { account: alice, shareBps: 6000 },
    { account: bob, shareBps: 4000 },
  ]);
});
it.each(["factory", "launchRouter", "royaltySplitter", "token", "quoteAsset"])(
  "rejects mismatched %s custody",
  async (field) => {
    await expect(
      readRoyaltyRecipients(mock({ [field]: addr(99) }), input),
    ).rejects.toThrow();
  },
);
it("rejects changed recipients even when the returned shares still total 100%", async () => {
  await expect(
    readRoyaltyRecipients(mock({ recipients: addr(99) }), input),
  ).rejects.toThrow();
});
it("rejects an event block that is no longer canonical", async () => {
  const client = mock();
  vi.mocked(client.getBlock).mockResolvedValueOnce({
    hash: `0x${"cd".repeat(32)}`,
  } as never);
  await expect(readRoyaltyRecipients(client, input)).rejects.toThrow(
    /canonical/i,
  );
  expect(client.readContract).not.toHaveBeenCalled();
});
