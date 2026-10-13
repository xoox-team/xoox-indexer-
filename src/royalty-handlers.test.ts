import { expect, it, vi } from "vitest";
import { createTestIndexer } from "envio";
const load = vi.hoisted(() =>
  vi.fn(async () => [
    { account: "0xa000000000000000000000000000000000000001", shareBps: 6000 },
    { account: "0xa000000000000000000000000000000000000002", shareBps: 4000 },
  ]),
);
vi.mock("./royalty-recipients", () => ({ loadRoyaltyRecipients: load }));
import "./handlers/index";
const token = "0x1000000000000000000000000000000000000000",
  curve = "0x2000000000000000000000000000000000000000";
const creator = "0x3000000000000000000000000000000000000000",
  factory = "0x4000000000000000000000000000000000000000";
const router = "0xd000000000000000000000000000000000000000",
  splitter = "0xe000000000000000000000000000000000000000";
const zero = "0x0000000000000000000000000000000000000000";
const event = (block = 2, selectedSplitter: `0x${string}` = splitter) => ({
  contract: "LaunchRouter" as const,
  event: "LaunchOptionsConfigured" as const,
  srcAddress: router,
  block: { number: block, hash: `0x${"ab".repeat(32)}` },
  logIndex: 1,
  transaction: { hash: `0x${"cd".repeat(32)}` },
  params: {
    token,
    buyTaxBps: 300n,
    sellTaxBps: 500n,
    minimumHolderBalance: 100n,
    royaltySplitter: selectedSplitter,
    optionsHash: `0x${"ef".repeat(32)}`,
  },
} as const);
async function seed(test: ReturnType<typeof createTestIndexer>) {
  await test.process({
    chains: {
      143: {
        simulate: [
          {
            contract: "Factory",
            event: "TokenLaunched",
            srcAddress: factory,
            block: { number: 1 },
            params: { token, curve, creator, quoteAsset: zero, configId: 0n },
          },
        ],
      },
    },
  });
}
it("indexes nonholding fixed recipients from a registered launch and preserves them on resumed replay", async () => {
  const test = createTestIndexer();
  await seed(test);
  await test.process({ chains: { 143: { simulate: [event()] } } });
  expect(await test.Holder.getAll()).toEqual([]);
  expect(await test.RoyaltyRecipient.getAll()).toHaveLength(2);
  expect(
    await test.RoyaltyRecipient.getOrThrow(
      `${token}:0xa000000000000000000000000000000000000001`,
    ),
  ).toMatchObject({ token, factory, splitter, shareBps: 6000 });
  expect(load).toHaveBeenCalledWith(
    143,
    expect.objectContaining({
      factory,
      router,
      token,
      blockNumber: 2n,
      blockHash: `0x${"ab".repeat(32)}`,
    }),
  );
  const replay = createTestIndexer();
  await seed(replay);
  for (const row of await test.RoyaltyRecipient.getAll())
    replay.RoyaltyRecipient.set(row);
  for (const row of await test.ProcessedEvent.getAll())
    replay.ProcessedEvent.set(row);
  await replay.process({ chains: { 143: { simulate: [event()] } } });
  expect(await replay.RoyaltyRecipient.getAll()).toHaveLength(2);
});
it("rejects options without canonical factory membership", async () => {
  const test = createTestIndexer();
  await expect(
    test.process({ chains: { 143: { simulate: [event(3)] } } }),
  ).rejects.toThrow();
  expect(await test.RoyaltyRecipient.getAll()).toEqual([]);
});
it("keeps ordinary nonroyalty options and legacy launches unchanged", async () => {
  const test = createTestIndexer();
  await seed(test);
  await test.process({ chains: { 143: { simulate: [event(4, zero)] } } });
  expect(await test.RoyaltyRecipient.getAll()).toEqual([]);
  expect(await test.Launch.getOrThrow(token)).toMatchObject({
    registered: true,
    factory,
    creator,
  });
});
