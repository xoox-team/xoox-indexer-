import { beforeEach, describe, expect, it, vi } from "vitest";
const loader = vi.hoisted(() => vi.fn());
vi.mock("./pro-consent-source", async (original) => {
  const actual = await original<typeof import("./pro-consent-source")>();
  return { ...actual, loadProConsentSource: loader };
});
import { createTestIndexer } from "envio";
import { readProConsentSource } from "./pro-consent-source";
import {
  onceProConsentEvent,
  proConsentParticipantId,
  proLaunchId,
} from "./pro-handlers";
import "./handlers/index";
import { consentHash, consentIndexerFixture } from "./test/pro-consent-fixture";
import { envioConfiguration } from "./configuration";

type Fixture = ReturnType<typeof consentIndexerFixture>;
const stamp = (f: Fixture, logIndex: number, tx = 900) => ({
  block: { number: 123, timestamp: 1000, hash: f.base.blockHash },
  transaction: { hash: consentHash(tx) },
  logIndex,
});
const registered = (f: Fixture, role: 0 | 1 = 0) => ({
  contract: "ProConsentRegistry" as const,
  event: "ReactiveParticipantRegistered" as const,
  srcAddress: f.registry,
  ...stamp(f, 11 + role * 2, 900 + role),
  params: {
    participantId: f.ids[role],
    token: f.tokens[role],
    creator: f.creators[role],
    configurationHash: f.launches[role]!.configurationHash,
    role: BigInt(role),
    participantSalt: f.salts[role],
  },
});
const created = (f: Fixture, role: 0 | 1) => ({
  contract: "ProFactory" as const,
  event: "LaunchCreated" as const,
  srcAddress: f.factory,
  ...stamp(f, 10 + role * 2, 900 + role),
  params: f.launches[role]!,
});
const revoked = (f: Fixture, nonce = 1n, logIndex = 14) => ({
  contract: "ProConsentRegistry" as const,
  event: "ParticipantNonceAdvanced" as const,
  srcAddress: f.registry,
  ...stamp(f, logIndex),
  params: { participantId: f.ids[0], creator: f.creators[0], nonce },
});
const finalized = (f: Fixture, nonce0 = 0n, nonce1 = 0n, logIndex = 16) => ({
  contract: "ProConsentRegistry" as const,
  event: "ReactiveConsentFinalized" as const,
  srcAddress: f.registry,
  ...stamp(f, logIndex),
  params: {
    finalPairId: f.finalPairId,
    participantId0: f.ids[0],
    participantId1: f.ids[1],
    token0: f.tokens[0],
    token1: f.tokens[1],
    creator0: f.creators[0],
    creator1: f.creators[1],
    nonce0,
    nonce1,
  },
});
function setup(f = consentIndexerFixture()) {
  loader.mockImplementation((chainId, input) =>
    readProConsentSource(f.client, chainId, f.source(), input),
  );
  return { f, test: createTestIndexer() };
}
const seedEvents = (f: Fixture, both = false) =>
  both
    ? [created(f, 0), registered(f, 0), created(f, 1), registered(f, 1)]
    : [created(f, 0), registered(f, 0)];
async function simulate(
  test: ReturnType<typeof createTestIndexer>,
  events: Array<
    | ReturnType<typeof created>
    | ReturnType<typeof registered>
    | ReturnType<typeof revoked>
    | ReturnType<typeof finalized>
  >,
) {
  return test.process({ chains: { 143: { simulate: events } } });
}
beforeEach(() => {
  loader.mockReset();
});

describe("isolated genuine participant consent projections", () => {
  it("stores pending own participant ID and immutable creator/config independently of LP phase", async () => {
    const { f, test } = setup();
    await simulate(test, seedEvents(f));
    const id = proConsentParticipantId(143, f.registry, f.ids[0]);
    expect(await test.ProConsentParticipant.getOrThrow(id)).toMatchObject({
      factory: f.factory.toLowerCase(),
      helper: f.helper.toLowerCase(),
      registry: f.registry.toLowerCase(),
      participantId: f.ids[0],
      creator: f.creators[0].toLowerCase(),
      token: f.tokens[0].toLowerCase(),
      configurationHash: f.launches[0]!.configurationHash,
      role: 0,
      nonce: 0n,
      status: "AwaitingConsent",
      registeredBlock: 123n,
      registeredBlockHash: f.base.blockHash,
      registrationLogIndex: 11,
      partnerId: undefined,
      finalPairId: undefined,
    });
    expect(
      (await test.ProLaunch.getOrThrow(proLaunchId(143, f.tokens[0]))).phase,
    ).toBe("Trading");
    expect(
      await test.ProConsentToken.getOrThrow(proLaunchId(143, f.tokens[0])),
    ).toMatchObject({ participantEntityId: id });
    expect(loader).toHaveBeenCalledWith(
      143,
      expect.objectContaining({
        blockNumber: 123n,
        blockHash: f.base.blockHash,
        participantIds: [f.ids[0]],
      }),
    );
  });
  it("preserves historical registration/revocations when source is finalized later in the same block", async () => {
    const { f, test } = setup();
    f.finalize(2n, 0n);
    await simulate(test, [
      ...seedEvents(f, true),
      revoked(f, 1n, 14),
      revoked(f, 2n, 15),
      finalized(f, 2n, 0n),
    ]);
    const id0 = proConsentParticipantId(143, f.registry, f.ids[0]);
    expect((await test.ProConsentParticipant.getOrThrow(id0)).nonce).toBe(3n);
    const rows = await Promise.all(
      f.ids.map((id) =>
        test.ProConsentParticipant.getOrThrow(
          proConsentParticipantId(143, f.registry, id),
        ),
      ),
    );
    expect(rows.map((row) => [row.nonce, row.status])).toEqual([
      [3n, "Finalized"],
      [1n, "Finalized"],
    ]);
    expect(rows.map((row) => row.participantId)).toEqual(f.ids);
    expect(rows.map((row) => row.partnerId)).toEqual([f.ids[1], f.ids[0]]);
    expect(
      await test.ProConsentPair.getOrThrow(
        proConsentParticipantId(143, f.registry, f.finalPairId),
      ),
    ).toMatchObject({
      participantId0: f.ids[0],
      participantId1: f.ids[1],
      creator0: f.creators[0].toLowerCase(),
      creator1: f.creators[1].toLowerCase(),
      configurationHash0: f.launches[0]!.configurationHash,
      configurationHash1: f.launches[1]!.configurationHash,
      consumedNonce0: 2n,
      consumedNonce1: 0n,
      logIndex: 16,
    });
    expect(
      (await test.ProConsentEvent.getOrThrow(`143:${consentHash(900)}:11`))
        .nonce0,
    ).toBe(0n);
    expect(
      (await test.ProConsentEvent.getOrThrow(`143:${consentHash(900)}:14`))
        .nonce0,
    ).toBe(1n);
  });
  it("indexes both creator fields even when one creator controls both participants", async () => {
    const { f, test } = setup(consentIndexerFixture(3, true));
    f.finalize();
    await simulate(test, [...seedEvents(f, true), finalized(f)]);
    expect(
      await test.ProConsentPair.getOrThrow(
        proConsentParticipantId(143, f.registry, f.finalPairId),
      ),
    ).toMatchObject({
      creator0: f.creators[0].toLowerCase(),
      creator1: f.creators[0].toLowerCase(),
      participantId0: f.ids[0],
      participantId1: f.ids[1],
    });
    expect(f.ids[0]).not.toBe(f.ids[1]);
  });
  it("does not advance nonce or duplicate pair on repeat delivery", async () => {
    const { f, test } = setup();
    f.finalize();
    await simulate(test, [...seedEvents(f, true), finalized(f)]);
    const calls = loader.mock.calls.length;
    expect(
      await onceProConsentEvent(test, { ...finalized(f), chainId: 143 }),
    ).toBe(false);
    expect(
      await onceProConsentEvent(test, { ...registered(f), chainId: 143 }),
    ).toBe(false);
    expect(loader.mock.calls.length).toBe(calls);
    expect(await test.ProConsentPair.getAll()).toHaveLength(1);
    expect(await test.ProConsentEvent.getAll()).toHaveLength(3);
    expect(
      (
        await test.ProConsentParticipant.getOrThrow(
          proConsentParticipantId(143, f.registry, f.ids[0]),
        )
      ).nonce,
    ).toBe(1n);
  });
  it("rejects a conflicting fork delivery until Envio rolls back the old entities", async () => {
    const { f, test } = setup();
    await simulate(test, seedEvents(f));
    const event = registered(f);
    event.block.hash = consentHash(99);
    await expect(
      onceProConsentEvent(test, { ...event, chainId: 143 }),
    ).rejects.toThrow("different canonical provenance");
    expect(
      (
        await test.ProConsentParticipant.getOrThrow(
          proConsentParticipantId(143, f.registry, f.ids[0]),
        )
      ).registeredBlockHash,
    ).toBe(f.base.blockHash);
  });
  it.each([
    "participant ID",
    "creator",
    "configuration",
    "token",
    "role",
    "salt",
  ])("rejects mismatched registration %s", async (fault) => {
    const { f, test } = setup();
    const event = registered(f);
    if (fault === "participant ID") event.params.participantId = f.ids[1];
    if (fault === "creator") event.params.creator = f.creators[1];
    if (fault === "configuration")
      event.params.configurationHash = consentHash(99);
    if (fault === "token") event.params.token = f.tokens[1];
    if (fault === "role") event.params.role = 1n;
    if (fault === "salt") event.params.participantSalt = consentHash(99);
    await expect(simulate(test, [created(f, 0), event])).rejects.toThrow(
      "committed Factory launch",
    );
    expect(
      await test.ProConsentParticipant.get(
        proConsentParticipantId(143, f.registry, f.ids[0]),
      ),
    ).toBeUndefined();
  });
  it("rejects registration without its complete prior Factory launch", async () => {
    const { f, test } = setup();
    await expect(simulate(test, [registered(f)])).rejects.toThrow(
      "committed Factory launch",
    );
  });
  it("publishes no participant when reviewed source or canonical RPC fails", async () => {
    const { f, test } = setup();
    f.base.codes.set(f.registry.toLowerCase(), "0x6001");
    await expect(
      simulate(test, [created(f, 0), registered(f)]),
    ).rejects.toThrow("source hash");
    expect(
      await test.ProConsentParticipant.get(
        proConsentParticipantId(143, f.registry, f.ids[0]),
      ),
    ).toBeUndefined();
  });
  it.each(["jump", "creator", "participant", "out of order"])(
    "rejects nonce %s",
    async (fault) => {
      const { f, test } = setup();
      f.participants[0]!.nonce = 2n;
      const event = revoked(f);
      if (fault === "jump") event.params.nonce = 2n;
      if (fault === "creator") event.params.creator = f.creators[1];
      if (fault === "participant") event.params.participantId = f.ids[1];
      if (fault === "out of order") event.logIndex = 9;
      await expect(simulate(test, [...seedEvents(f), event])).rejects.toThrow(
        "nonce event differs",
      );
      expect(
        (
          await test.ProConsentParticipant.get(
            proConsentParticipantId(143, f.registry, f.ids[0]),
          )
        )?.nonce ?? 0n,
      ).toBe(0n);
    },
  );
  it.each([
    "pair ID",
    "role order",
    "creator0",
    "creator1",
    "token",
    "nonce0",
    "nonce1",
    "missing registration",
  ])("rejects finalization %s", async (fault) => {
    const { f, test } = setup();
    f.finalize();
    const event = finalized(f);
    if (fault === "pair ID") event.params.finalPairId = consentHash(99);
    if (fault === "role order")
      [event.params.participantId0, event.params.participantId1] = [
        f.ids[1],
        f.ids[0],
      ];
    if (fault === "creator0") event.params.creator0 = f.creators[1];
    if (fault === "creator1") event.params.creator1 = f.creators[0];
    if (fault === "token") event.params.token1 = f.tokens[0];
    if (fault === "nonce0") event.params.nonce0 = 1n;
    if (fault === "nonce1") event.params.nonce1 = 1n;
    await expect(
      simulate(test, [
        ...seedEvents(f, fault !== "missing registration"),
        event,
      ]),
    ).rejects.toThrow("Pro index:");
    expect(
      await test.ProConsentPair.get(
        proConsentParticipantId(143, f.registry, f.finalPairId),
      ),
    ).toBeUndefined();
    expect(
      (
        await test.ProConsentParticipant.get(
          proConsentParticipantId(143, f.registry, f.ids[0]),
        )
      )?.status,
    ).not.toBe("Finalized");
  });
});

describe("explicit consent subscriptions", () => {
  it("keeps consent disabled by default and subscribes only the selected address", () => {
    const f = consentIndexerFixture();
    expect(
      envioConfiguration().chains[0].contracts.find(
        (item) => item.name === "ProConsentRegistry",
      )!.address,
    ).toEqual([]);
    const config = envioConfiguration(undefined, [
      {
        chainId: 143,
        factory: f.factory,
        startBlock: "123",
        consentRegistry: f.registry,
      },
    ]);
    expect(
      config.chains[0].contracts.find(
        (item) => item.name === "ProConsentRegistry",
      )!.address,
    ).toEqual([f.registry]);
    expect(
      config.contracts.find((item) => item.name === "ProConsentRegistry")!
        .events,
    ).toHaveLength(3);
  });
  it.each([
    "zero",
    "Factory alias",
    "Router alias",
    "ambiguous Factory",
    "shared Registry",
  ])("rejects %s subscription", (fault) => {
    const f = consentIndexerFixture();
    const source: {
      chainId: number;
      factory: string;
      startBlock: string;
      consentRegistry: string;
      poolRouter: string;
    } = {
      chainId: 143,
      factory: f.factory,
      startBlock: "123",
      consentRegistry: f.registry,
      poolRouter: f.tokens[0],
    };
    const sources = [source];
    if (fault === "zero")
      source.consentRegistry = "0x0000000000000000000000000000000000000000";
    if (fault === "Factory alias") source.consentRegistry = f.factory;
    if (fault === "Router alias") source.consentRegistry = source.poolRouter;
    if (fault === "ambiguous Factory")
      sources.push({ ...source, consentRegistry: f.tokens[1] });
    if (fault === "shared Registry")
      sources.push({
        ...source,
        factory: f.tokens[1],
        poolRouter: f.curves[1],
      });
    expect(() => envioConfiguration(undefined, sources)).toThrow();
  });
});
