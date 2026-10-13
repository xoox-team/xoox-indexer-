import { beforeEach, describe, expect, it, vi } from "vitest";
const sourceLoader = vi.hoisted(() => vi.fn());
vi.mock("./pro-holder-source", () => ({ loadProHolderSource: sourceLoader }));
import { createTestIndexer } from "envio";
import { proFactoryAbi } from "./vendor/xoox-sdk/pro-token";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { proHolderId } from "./pro-holder-handlers";
import "./handlers/index";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const factory = "0xe000000000000000000000000000000000000000" as Address;
const token = addr(101),
  curve = addr(102),
  policy = addr(103),
  creator = addr(104),
  alice = addr(105),
  bob = addr(106),
  vault = addr(107),
  manager = addr(108);
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const supply = 1000n * 10n ** 18n;
const launchId = `143:${token}`;
const provenance = (block: number, logIndex: number) => ({
  block: { number: block, timestamp: block * 10, hash: hash(block) },
  transaction: { hash: hash(block + 1000) },
  logIndex,
});
function launch() {
  const metadata = {
    name: "Program",
    symbol: "PRG",
    description: "",
    image: "",
    website: "",
    twitter: "",
    telegram: "",
  };
  const curveConfig = {
    quoteAsset: zeroAddress,
    phantomQuote: 100n * 10n ** 18n,
    graduationThreshold: 0n,
    baseFeeBps: 0,
    buyTaxBps: 0,
    sellTaxBps: 0,
    perpetual: true,
    feeRecipient: vault,
  };
  const rules = [{ rule: 0, data: hash(8) }],
    deadline = 1000n,
    requestedSalt = hash(55);
  const call = encodeFunctionData({
    abi: proFactoryAbi,
    functionName: "createLaunch",
    args: [metadata, supply, curveConfig, rules, [], requestedSalt, deadline],
  });
  const configurationHash = keccak256(`0x${call.slice(10)}`);
  const launchSalt = keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"), [
      creator,
      requestedSalt,
      configurationHash,
    ]),
  );
  return {
    contract: "ProFactory" as const,
    event: "LaunchCreated" as const,
    srcAddress: factory,
    ...provenance(2, 5),
    params: {
      creator,
      token,
      curveAddress: curve,
      policy,
      supply,
      configurationHash,
      launchSalt,
      metadata,
      curveConfig: {
        ...curveConfig,
        baseFeeBps: 0n,
        buyTaxBps: 0n,
        sellTaxBps: 0n,
      },
      rules: rules.map((r) => ({ ...r, rule: BigInt(r.rule) })),
      walletExemptions: [],
      requestedSalt,
      deadline,
    },
  };
}
const transfer = (
  from: Address,
  to: Address,
  value: bigint,
  block = 3,
  index = 1,
) => ({
  contract: "ProToken" as const,
  event: "Transfer" as const,
  srcAddress: token,
  ...provenance(block, index),
  params: { from, to, value },
});
const mint = () => transfer(zeroAddress, curve, supply, 2, 1);
type Test = ReturnType<typeof createTestIndexer>;
type Events = NonNullable<
  NonNullable<Parameters<Test["process"]>[0]["chains"][143]>["simulate"]
>;
const process = (test: Test, events: Events) =>
  test.process({ chains: { 143: { simulate: events } } });
beforeEach(() => {
  sourceLoader.mockReset().mockResolvedValue({
    tokenCodeHash: hash(77),
    sourceVersion: 4,
    reviewId: "reviewed-test-source4",
    tokenDecimals: 18,
    mintLogIndex: 1,
    programVault: vault,
    infrastructure: [factory, manager, vault],
    cumulativeBurned: 0n,
  });
});
describe("authentic isolated Pro holder replay", () => {
  it("dynamically registers the distinct ProToken role and bootstraps a late-discovered constructor mint", async () => {
    const test = createTestIndexer(),
      created = launch();
    const result = await process(test, [created]);
    expect(
      result.changes.flatMap((c) => c.addresses?.sets ?? []),
    ).toContainEqual({ contract: "ProToken", address: token });
    expect(await test.ProHolderLedger.get(launchId)).toBeUndefined();
    await process(test, [transfer(curve, alice, 100n)]);
    expect(sourceLoader).toHaveBeenCalledOnce();
    expect(
      await test.ProHolder.getOrThrow(proHolderId(143, token, curve)),
    ).toMatchObject({ balance: supply - 100n });
    expect(
      await test.ProHolder.getOrThrow(proHolderId(143, token, alice)),
    ).toMatchObject({ balance: 100n });
    expect(await test.ProHolderLedger.getOrThrow(launchId)).toMatchObject({
      genesisSupply: supply,
      currentSupply: supply,
      cumulativeBurned: 0n,
      sourceVersion: 4,
      programVault: vault,
      holderCount: 2n,
    });
    expect(await test.Holder.get(`${token}:${alice}`)).toBeUndefined();
    expect(await test.Launch.get(token)).toBeUndefined();
  });
  it("accepts constructor ordering before LaunchCreated exactly once", async () => {
    const test = createTestIndexer();
    await process(test, [mint(), launch()]);
    expect(
      await test.ProHolder.getOrThrow(proHolderId(143, token, curve)),
    ).toMatchObject({ balance: supply });
    expect(await test.ProPendingMint.get(launchId)).toBeUndefined();
    expect(await test.ProTokenTransfer.getAll()).toHaveLength(1);
    await process(test, [transfer(curve, alice, 1n, 3)]);
    expect(
      await test.ProHolder.getOrThrow(proHolderId(143, token, curve)),
    ).toMatchObject({ balance: supply - 1n });
  });
  it("conserves balances through wallet transfers, infrastructure custody, zero/self transfers and own-Vault burns", async () => {
    const test = createTestIndexer();
    await process(test, [launch()]);
    await process(test, [
      transfer(curve, alice, 100n, 3, 1),
      transfer(alice, bob, 30n, 3, 2),
      transfer(bob, manager, 10n, 3, 3),
      transfer(alice, alice, 7n, 3, 4),
      transfer(bob, alice, 0n, 3, 5),
      transfer(alice, vault, 20n, 3, 6),
      transfer(vault, zeroAddress, 12n, 3, 7),
    ]);
    expect(
      await test.ProHolder.getOrThrow(proHolderId(143, token, alice)),
    ).toMatchObject({ balance: 50n });
    expect(
      await test.ProHolder.getOrThrow(proHolderId(143, token, bob)),
    ).toMatchObject({ balance: 20n });
    expect(
      await test.ProHolder.getOrThrow(proHolderId(143, token, vault)),
    ).toMatchObject({ balance: 8n });
    const ledger = await test.ProHolderLedger.getOrThrow(launchId),
      holders = await test.ProHolder.getAll();
    expect(holders.reduce((sum, h) => sum + h.balance, 0n)).toBe(supply - 12n);
    expect(ledger.currentSupply + ledger.cumulativeBurned).toBe(supply);
    expect(ledger).toMatchObject({ cumulativeBurned: 12n, holderCount: 5n });
    expect(
      await test.ProHolder.get(proHolderId(143, token, zeroAddress)),
    ).toBeUndefined();
  });
  it("deduplicates repeated event identity without changing balances or supply", async () => {
    const test = createTestIndexer();
    await process(test, [launch()]);
    const buy = transfer(curve, alice, 100n);
    await process(test, [buy]);
    const resumed = createTestIndexer();
    await process(resumed, [launch()]);
    for (const row of await test.ProHolder.getAll()) resumed.ProHolder.set(row);
    for (const row of await test.ProHolderLedger.getAll())
      resumed.ProHolderLedger.set(row);
    for (const row of await test.ProTokenTransfer.getAll())
      resumed.ProTokenTransfer.set(row);
    for (const row of await test.ProHolderProcessedEvent.getAll())
      resumed.ProHolderProcessedEvent.set(row);
    await process(resumed, [buy]);
    expect(
      await resumed.ProHolder.getOrThrow(proHolderId(143, token, alice)),
    ).toMatchObject({ balance: 100n });
    expect(await resumed.ProTokenTransfer.getAll()).toHaveLength(2);
  });
  it("rejects missing earlier history and unauthorized burns", async () => {
    const test = createTestIndexer();
    await process(test, [launch()]);
    await expect(process(test, [transfer(alice, bob, 1n)])).rejects.toThrow(
      "earlier balance",
    );
    const other = createTestIndexer();
    await process(other, [launch()]);
    await expect(
      process(other, [transfer(curve, zeroAddress, 1n)]),
    ).rejects.toThrow("Vault");
  });
  it("rejects conflicting constructor evidence and additional mint issuance", async () => {
    const test = createTestIndexer();
    await expect(
      process(test, [
        { ...mint(), params: { ...mint().params, value: supply - 1n } },
        launch(),
      ]),
    ).rejects.toThrow("constructor mint differs");
    const other = createTestIndexer();
    await process(other, [launch()]);
    await expect(
      process(other, [transfer(zeroAddress, alice, 1n)]),
    ).rejects.toThrow("additional mint");
  });
  it("does not route an arbitrary token mint without authenticated factory discovery", async () => {
    const test = createTestIndexer();
    await expect(process(test, [mint()])).rejects.toThrow(
      "never reached a handler",
    );
    expect(await test.ProHolder.getAll()).toEqual([]);
    expect(await test.ProHolderLedger.getAll()).toEqual([]);
  });
  it("rejects a legacy token burn even when a source claims a Vault address", async () => {
    sourceLoader.mockResolvedValue({
      tokenCodeHash: hash(77),
      sourceVersion: 1,
      reviewId: "reviewed-test-source1",
      tokenDecimals: 18,
      mintLogIndex: 1,
      programVault: "",
      infrastructure: [factory],
      cumulativeBurned: 0n,
    });
    const test = createTestIndexer();
    await process(test, [launch()]);
    await expect(
      process(test, [transfer(curve, zeroAddress, 1n)]),
    ).rejects.toThrow("Vault");
  });
  it("replays the same canonical history into a fresh ledger deterministically", async () => {
    const events = [
      mint(),
      launch(),
      transfer(curve, alice, 100n, 3, 1),
      transfer(alice, bob, 30n, 4, 1),
    ];
    const first = createTestIndexer(),
      second = createTestIndexer();
    await process(first, events);
    await process(second, events);
    expect(await second.ProHolder.getAll()).toEqual(
      await first.ProHolder.getAll(),
    );
    expect(await second.ProHolderLedger.getAll()).toEqual(
      await first.ProHolderLedger.getAll(),
    );
  });
  it("requires canonical rollback when resumed event identity changes", async () => {
    const first = createTestIndexer();
    await process(first, [launch()]);
    const move = transfer(curve, alice, 100n);
    await process(first, [move]);
    const resumed = createTestIndexer();
    await process(resumed, [launch()]);
    for (const row of await first.ProHolderProcessedEvent.getAll())
      resumed.ProHolderProcessedEvent.set(row);
    await expect(
      process(resumed, [{ ...move, params: { ...move.params, value: 99n } }]),
    ).rejects.toThrow("canonical rollback");
  });
  it("publishes no accepted balances when canonical source verification fails", async () => {
    sourceLoader.mockRejectedValue(
      new Error("launch block is no longer canonical"),
    );
    const test = createTestIndexer();
    await process(test, [{ ...launch(), logIndex: 6 }]);
    await expect(process(test, [transfer(curve, alice, 100n)])).rejects.toThrow(
      "no longer canonical",
    );
    expect(await test.ProHolder.getAll()).toEqual([]);
    expect(await test.ProHolderLedger.getAll()).toEqual([]);
  });
});
