import { describe, expect, it } from "vitest";
import { getAddress, keccak256, stringToHex, zeroHash } from "viem";
import { assertProFeeProgramCycleReceipt } from "./vendor/xoox-sdk/pro-fee-program-receipts";
import { readProFeeProgramLaunch } from "./vendor/xoox-sdk/pro-fee-program-launch";
import { proFeeProgramConfigHash } from "./vendor/xoox-sdk/pro-fee-programs";
import {
  PRO_PROGRAM_EVIDENCE_MAX_INFRASTRUCTURE,
  replayVerifiedProProgramPlan,
} from "./pro-program-evidence";
import {
  assertVerifiedProProgramPlan,
  assertVerifiedProFundedReward,
  finalizeVerifiedProProgramReward,
  planVerifiedProProgramCycle,
  proProgramEvidenceJson,
} from "./pro-program-execution";
import { verifiedProgramExecutionFixture } from "./test/pro-program-execution-fixture";

describe("production program plan and funded reward issuance", () => {
  it("binds a supplied local test creator throughout the issued source, plan and receipt", async () => {
    const creator = getAddress("0x1234567890000000000000000000000000000000");
    const f = await verifiedProgramExecutionFixture({ creator });
    expect(f.launch.creator).toBe(creator);
    expect(f.launch.configuration.programs[0].authority).toBe(creator);
    expect(f.plan.identity.executor.toLowerCase()).toBe(creator.toLowerCase());
    expect(f.receipt.sender).toBe(creator);
    expect(f.receipt.launch.creator).toBe(creator);
  });
  it("issues a genuine pending conversion plan and finalizes actual83 rather than quoted output", async () => {
    const f = await verifiedProgramExecutionFixture();
    assertVerifiedProProgramPlan(f.plan);
    assertProFeeProgramCycleReceipt(f.receipt);
    const final = finalizeVerifiedProProgramReward(
      f.plan,
      0,
      f.receipt,
      f.currentLaunch,
    );
    assertVerifiedProFundedReward(final);
    expect(final.allocation.total).toBe(83n);
    expect(final.observedAt).toBe(1000n);
    expect(() => assertVerifiedProProgramPlan({ ...f.plan })).toThrow();
    expect(() => assertVerifiedProFundedReward({ ...final })).toThrow();
    expect(() =>
      finalizeVerifiedProProgramReward(
        f.plan,
        0,
        { ...f.receipt },
        f.currentLaunch,
      ),
    ).toThrow();
    expect(() =>
      finalizeVerifiedProProgramReward(
        { ...f.plan },
        0,
        f.receipt,
        f.currentLaunch,
      ),
    ).toThrow();
    expect(() =>
      finalizeVerifiedProProgramReward(f.plan, 0, f.receipt, {
        ...f.currentLaunch,
      }),
    ).toThrow();
  });
  it("rejects forged launch admission and differing canonical identities/state", async () => {
    const f = await verifiedProgramExecutionFixture();
    await expect(
      planVerifiedProProgramCycle({ ...f.launch }, f.input),
    ).rejects.toThrow();
    await expect(
      planVerifiedProProgramCycle(f.launch, {
        ...f.input,
        source: { ...f.input.source, blockHash: zeroHash },
      }),
    ).rejects.toThrow();
    await expect(
      planVerifiedProProgramCycle(f.launch, {
        ...f.input,
        state: { ...f.input.state, budget: 101n },
      }),
    ).rejects.toThrow();
    expect(() =>
      finalizeVerifiedProProgramReward(f.plan, 0, f.receipt, f.launch),
    ).toThrow();
    expect(() =>
      finalizeVerifiedProProgramReward(f.plan, 99, f.receipt, f.currentLaunch),
    ).toThrow();
  });
});

describe("replay of committed public program evidence", () => {
  it("retains the legacy ai null field and the exact ordinary cycle commitment", async () => {
    const f = await verifiedProgramExecutionFixture();
    expect(JSON.parse(f.plan.evidenceJson!).ai).toBeNull();
    // Commitment captured from the ordinary writer before retiring modules 27–30.
    expect(f.plan.cycle!.evidence).toBe(
      "0x9c5285b7a3659c5877f2d49e32b8de5de42a8215f44cf09a79fecb7c28c400c6",
    );
    const replay = await replayVerifiedProProgramPlan(
      f.launch,
      f.plan.evidenceJson!,
      f.plan.cycle!.evidence,
    );
    expect(replay.evidenceJson).toBe(f.plan.evidenceJson);
    expect(replay.cycle).toEqual(f.plan.cycle);
  });
  it("refuses a nonnull model observation in ordinary cycle evidence", async () => {
    const f = await verifiedProgramExecutionFixture();
    const evidenceJson = proProgramEvidenceJson({
      ...JSON.parse(f.plan.evidenceJson!),
      ai: {
        provider: "retired-provider",
        model: "retired-model",
        instructions: "",
        evidence: keccak256("0x99aa"),
      },
    });
    await expect(
      replayVerifiedProProgramPlan(
        f.launch,
        evidenceJson,
        keccak256(stringToHex(evidenceJson)),
      ),
    ).rejects.toThrow(/observation/);
  });
  it("preserves actual settled token output in saved buyer observations and rejects noncanonical units", async () => {
    const f = await verifiedProgramExecutionFixture();
    const configuration = {
      ...f.launch.configuration,
      programs: [
        {
          ...f.launch.configuration.programs[0]!,
          moduleId: 21,
          intervalSeconds: 300,
          rulesHash: keccak256("0xcafe"),
        },
      ],
    };
    const configurationHash = proFeeProgramConfigHash(configuration);
    f.f.set(f.vault, "programAt", configuration.programs[0], [0n]);
    f.f.set(f.vault, "configurationHash", configurationHash);
    f.f.set(f.vault, "waitingSince", 500n, [0n]);
    f.f.set(
      f.launch.bootstrapInfrastructure.programSource.programDeployer,
      "configurationHashOf",
      configurationHash,
      [f.vault],
    );
    const launch = await readProFeeProgramLaunch(
      f.client,
      f.launch.bootstrapInfrastructure,
      f.token,
    );
    const plan = await planVerifiedProProgramCycle(launch, {
      ...f.input,
      configuration,
      configurationHash,
      source: { ...f.input.source, configurationHash },
      state: { ...f.input.state, waitingSince: 500n },
      trades: {
        buys: [
          {
            id: "fixture-canonical-purchase",
            token: f.launch.token,
            buyer: f.holder,
            recipient: f.holder,
            quoteAmount: 90n,
            tokenAmount: 83n,
            blockNumber: f.launch.blockNumber,
            blockHash: f.launch.blockHash,
            timestamp: f.launch.blockTimestamp,
            logIndex: 9,
            source: "curve",
          },
        ],
        coverage: [
          {
            token: f.launch.token,
            fromTimestamp: 0n,
            throughTimestamp: f.launch.blockTimestamp,
            throughBlock: f.launch.blockNumber,
            throughBlockHash: f.launch.blockHash,
            source: "curve",
            scope: "all-public-swaps",
            complete: true,
            evidence: keccak256("0x1234"),
          },
        ],
        windowFrom: 0n,
        requiredSources: ["curve"],
        consumedLastBuyerIds: [],
      },
    });
    const replay = await replayVerifiedProProgramPlan(
      launch,
      plan.evidenceJson!,
      plan.cycle!.evidence,
    );
    expect(replay.evidenceJson).toBe(plan.evidenceJson);
    expect(
      JSON.parse(replay.evidenceJson!).dependencies.find(
        (row: { trades?: unknown }) => row.trades,
      ).trades.buys[0].tokenAmount,
    ).toBe("83");
    const data = JSON.parse(plan.evidenceJson!);
    data.dependencies.find(
      (row: { trades?: unknown }) => row.trades,
    ).trades.buys[0].tokenAmount = "8.3e1";
    const altered = JSON.stringify(data);
    await expect(
      replayVerifiedProProgramPlan(
        launch,
        altered,
        keccak256(stringToHex(altered)),
      ),
    ).rejects.toThrow();
  });
  it("replays a plan whose payout addresses contain hex letters, which the planner lowercases and the SDK checksums", async () => {
    const f = await verifiedProgramExecutionFixture();
    const configuration = {
      ...f.launch.configuration,
      programs: [
        {
          ...f.launch.configuration.programs[0]!,
          moduleId: 21,
          intervalSeconds: 300,
          rulesHash: keccak256("0xcafe"),
        },
      ],
    };
    const configurationHash = proFeeProgramConfigHash(configuration);
    f.f.set(f.vault, "programAt", configuration.programs[0], [0n]);
    f.f.set(f.vault, "configurationHash", configurationHash);
    f.f.set(f.vault, "waitingSince", 500n, [0n]);
    f.f.set(
      f.launch.bootstrapInfrastructure.programSource.programDeployer,
      "configurationHashOf",
      configurationHash,
      [f.vault],
    );
    const launch = await readProFeeProgramLaunch(
      f.client,
      f.launch.bootstrapInfrastructure,
      f.token,
    );
    // Nearly every real address has letters; the fixture's own addresses are digit-only and cannot show a case mismatch.
    const winner = getAddress("0xc0dec0dec0dec0dec0dec0dec0dec0dec0dec0de");
    const plan = await planVerifiedProProgramCycle(launch, {
      ...f.input,
      configuration,
      configurationHash,
      source: { ...f.input.source, configurationHash },
      state: { ...f.input.state, waitingSince: 500n },
      trades: {
        buys: [
          {
            id: "fixture-canonical-purchase",
            token: f.launch.token,
            buyer: winner,
            recipient: winner,
            quoteAmount: 90n,
            tokenAmount: 83n,
            blockNumber: f.launch.blockNumber,
            blockHash: f.launch.blockHash,
            timestamp: f.launch.blockTimestamp,
            logIndex: 9,
            source: "curve",
          },
        ],
        coverage: [
          {
            token: f.launch.token,
            fromTimestamp: 0n,
            throughTimestamp: f.launch.blockTimestamp,
            throughBlock: f.launch.blockNumber,
            throughBlockHash: f.launch.blockHash,
            source: "curve",
            scope: "all-public-swaps",
            complete: true,
            evidence: keccak256("0x1234"),
          },
        ],
        windowFrom: 0n,
        requiredSources: ["curve"],
        consumedLastBuyerIds: [],
      },
    });
    expect(plan.status).toBe("ready");
    expect(plan.cycle!.actions[0]!.beneficiaries).toEqual([
      winner.toLowerCase(),
    ]);
    const replay = await replayVerifiedProProgramPlan(
      launch,
      plan.evidenceJson!,
      plan.cycle!.evidence,
    );
    expect(replay.evidenceJson).toBe(plan.evidenceJson);
    expect(replay.cycle).toEqual(plan.cycle);
  });
  it("replays a plan that excludes far more wallets than the reviewed infrastructure, up to the stated bound", async () => {
    const f = await verifiedProgramExecutionFixture();
    const excluded = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `0x${(0xe0000 + i).toString(16).padStart(40, "0")}`,
      );
    const replayWith = async (count: number) => {
      const plan = await planVerifiedProProgramCycle(f.launch, {
        ...f.input,
        source: {
          ...f.input.source,
          infrastructure: [
            ...f.input.source.infrastructure,
            ...excluded(count),
          ],
        },
      });
      expect(plan.status).toBe("ready");
      return replayVerifiedProProgramPlan(
        f.launch,
        plan.evidenceJson!,
        plan.cycle!.evidence,
      );
    };
    // Wallets that cannot receive native currency join the source's infrastructure list, and a hostile holder set can
    // make that list long; replay must keep accepting the plan the planner issued.
    const replay = await replayWith(300);
    expect(JSON.parse(replay.evidenceJson!).source.infrastructure).toHaveLength(
      f.input.source.infrastructure.length + 300,
    );
    await expect(
      replayWith(PRO_PROGRAM_EVIDENCE_MAX_INFRASTRUCTURE),
    ).rejects.toThrow(/infrastructure/);
  });
  it("replays provider-shaped quote preimages and rejects a changed preimage even with a recomputed cycle hash", async () => {
    const f = await verifiedProgramExecutionFixture({
      quoteEvidenceJson: '{"domain":"xoox.pro-program-quote","amountOut":"83"}',
    });
    const replay = await replayVerifiedProProgramPlan(
      f.launch,
      f.plan.evidenceJson!,
      f.plan.cycle!.evidence,
    );
    expect(replay.evidenceJson).toBe(f.plan.evidenceJson);
    const data = JSON.parse(f.plan.evidenceJson!);
    data.dependencies[0].evidenceJson = '{"amountOut":"84"}';
    const json = proProgramEvidenceJson(data);
    await expect(
      replayVerifiedProProgramPlan(
        f.launch,
        json,
        keccak256(stringToHex(json)),
      ),
    ).rejects.toThrow("public preimage differs");
  });
  it("preserves optional public listing and lottery observations", async () => {
    const listingEvidenceJson =
      '{"schema":"public-canonical-book","complete":true}';
    const f = await verifiedProgramExecutionFixture({
      observations: {
        lottery: {
          seed: zeroHash,
          seedEvidence: keccak256("0x1122"),
          authority: getAddress("0x9300000000000000000000000000000000000000"),
        },
        listings: {
          collection: getAddress("0x9800000000000000000000000000000000000000"),
          blockHash: keccak256("0x3344"),
          complete: true,
          evidence: keccak256(stringToHex(listingEvidenceJson)),
          evidenceJson: listingEvidenceJson,
          items: [
            {
              collection: getAddress(
                "0x9800000000000000000000000000000000000000",
              ),
              tokenId: 22n,
              price: 83n,
              expiresAt: 2000n,
              orderHash: keccak256("0x7788"),
              data: "0x0102",
            },
          ],
        },
      },
    });
    const replay = await replayVerifiedProProgramPlan(
      f.launch,
      f.plan.evidenceJson!,
      f.plan.cycle!.evidence,
    );
    expect(replay.evidenceJson).toBe(f.plan.evidenceJson);
    expect(replay.cycle).toEqual(f.plan.cycle);
    const altered = JSON.parse(f.plan.evidenceJson!);
    altered.listings.evidenceJson += " ";
    const changed = JSON.stringify(altered);
    await expect(
      replayVerifiedProProgramPlan(
        f.launch,
        changed,
        keccak256(stringToHex(changed)),
      ),
    ).rejects.toThrow(/preimage/);
    expect(replay.rewards).toEqual(f.plan.rewards);
  });
  it("re-issues the same plan, actions and rebuilt holder allocation from the original issued snapshot", async () => {
    const f = await verifiedProgramExecutionFixture();
    const replay = await replayVerifiedProProgramPlan(
      f.launch,
      f.plan.evidenceJson!,
      f.plan.cycle!.evidence,
    );
    assertVerifiedProProgramPlan(replay);
    expect(replay).not.toBe(f.plan);
    expect(replay.evidenceJson).toBe(f.plan.evidenceJson);
    expect(replay.cycle).toEqual(f.plan.cycle);
    expect(replay.rewards).toEqual(f.plan.rewards);
    expect(replay.rewards[0].population).not.toBe(f.plan.rewards[0].population);
    expect(
      finalizeVerifiedProProgramReward(replay, 0, f.receipt, f.currentLaunch)
        .allocation.total,
    ).toBe(83n);
  });
  it.each([
    "digest",
    "whitespace",
    "duplicate key",
    "units",
    "action",
    "population",
    "quote",
    "unknown",
    "source",
    "later snapshot",
  ])("rejects %s evidence tampering", async (kind) => {
    const f = await verifiedProgramExecutionFixture();
    let json = f.plan.evidenceJson!,
      evidence = f.plan.cycle!.evidence;
    const data = JSON.parse(json);
    if (kind === "digest") evidence = zeroHash;
    if (kind === "whitespace") json += " ";
    if (kind === "duplicate key")
      json = json.replace('"domain":', '"domain":"forged","domain":');
    if (kind === "units") data.state.budget = "1e2";
    if (kind === "action") data.actions[0].minOut = "1";
    if (kind === "population")
      data.dependencies.at(-1).populationHash = zeroHash;
    if (kind === "quote") data.dependencies[0].amountSpent = "101";
    if (kind === "unknown") data.secret = "not part of the public schema";
    if (kind === "source") data.source.currentSupply = "999";
    if (
      !["digest", "whitespace", "duplicate key", "later snapshot"].includes(
        kind,
      )
    )
      json = proProgramEvidenceJson(data);
    // For semantic changes, supply a matching hash to ensure replay independently
    // validates observations and rebuilds outputs instead of trusting their digest.
    if (kind !== "digest") evidence = keccak256(stringToHex(json));
    await expect(
      replayVerifiedProProgramPlan(
        kind === "later snapshot" ? f.currentLaunch : f.launch,
        json,
        evidence,
      ),
    ).rejects.toThrow();
  });
});
