import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { readProFeeProgramLaunch } from "./vendor/xoox-sdk/pro-fee-program-launch";
import {
  proFeeProgramConfigHash,
  type ProFeeProgramModule,
} from "./vendor/xoox-sdk/pro-fee-programs";
import { replayVerifiedProProgramPlan } from "./pro-program-evidence";
import {
  planVerifiedProProgramCycle,
  proProgramEvidenceJson,
} from "./pro-program-execution";
import { buildProHolderPopulation } from "./pro-program-snapshots";
import { verifiedProgramExecutionFixture } from "./test/pro-program-execution-fixture";

/** Actual SDK source issuance over canonical RPC fixtures. These runtime pins
 * establish the test's identity boundary, not a public deployment approval. */
async function fixture(moduleId: 1 | 15 | 19) {
  const f = await verifiedProgramExecutionFixture();
  const configuration = {
    ...f.launch.configuration,
    programs: [
      {
        ...f.launch.configuration.programs[0]!,
        moduleId: moduleId as ProFeeProgramModule,
        count: moduleId === 15 ? 3 : 0,
        rulesHash: keccak256("0xcafe"),
      },
    ],
  };
  const configurationHash = proFeeProgramConfigHash(configuration);
  f.f.set(f.vault, "programAt", configuration.programs[0], [0n]);
  f.f.set(f.vault, "configurationHash", configurationHash);
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
  const balances = [
    { account: f.curve, balance: 600n },
    { account: f.creator, balance: 300n },
    { account: f.holder, balance: 50n },
    { account: "0x9800000000000000000000000000000000000000", balance: 30n },
    { account: "0x9900000000000000000000000000000000000000", balance: 20n },
  ];
  const input = {
    ...f.input,
    configuration,
    configurationHash,
    source: { ...f.input.source, configurationHash },
    balances,
  };
  return { ...f, launch, input, balances };
}

describe("immutable Whale Club and Flat Dividend creator policy", () => {
  it.each([15, 19] as const)(
    "excludes the largest creator balance from M%d while retaining it in the canonical supply census",
    async (moduleId) => {
      const f = await fixture(moduleId);
      const plan = await planVerifiedProProgramCycle(f.launch, f.input);
      const population = plan.rewards[0]!.population;
      expect(plan.status).toBe("ready");
      expect(population.excluded).toContain(f.creator.toLowerCase());
      expect(population.members.map((row) => row.balance)).toEqual([
        50n,
        30n,
        20n,
      ]);
      expect(
        population.members.some(
          (row) => row.account === f.creator.toLowerCase(),
        ),
      ).toBe(false);
      expect(f.balances.reduce((sum, row) => sum + row.balance, 0n)).toBe(
        population.source.currentSupply,
      );
      const replay = await replayVerifiedProProgramPlan(
        f.launch,
        plan.evidenceJson!,
        plan.cycle!.evidence,
      );
      expect(replay.rewards[0]!.population.populationHash).toBe(
        population.populationHash,
      );
      expect(replay.cycle).toEqual(plan.cycle);
    },
  );

  it("keeps the same creator eligible for M01 proportional rewards", async () => {
    const f = await fixture(1);
    const plan = await planVerifiedProProgramCycle(f.launch, f.input);
    const population = plan.rewards[0]!.population;
    expect(population.excluded).not.toContain(f.creator.toLowerCase());
    expect(population.members.map((row) => row.balance)).toEqual([
      300n,
      50n,
      30n,
      20n,
    ]);
  });

  it.each([15, 19] as const)(
    "rejects an M%d legacy creator-inclusive population commitment even if its outer evidence hash is recomputed",
    async (moduleId) => {
      const f = await fixture(moduleId);
      const plan = await planVerifiedProProgramCycle(f.launch, f.input);
      const population = plan.rewards[0]!.population;
      const excluded = population.excluded.filter(
        (row) => row !== f.creator.toLowerCase(),
      );
      let members = f.balances
        .map((row) => ({ ...row, account: row.account.toLowerCase() }))
        .filter((row) => !excluded.includes(row.account as never));
      if (moduleId === 15)
        members = members
          .sort((a, b) =>
            a.balance > b.balance
              ? -1
              : a.balance < b.balance
                ? 1
                : a.account.localeCompare(b.account),
          )
          .slice(0, 3);
      members.sort((a, b) => a.account.localeCompare(b.account));
      const legacyPopulationHash = keccak256(
        stringToHex(
          JSON.stringify(
            {
              domain: "xoox-pro-holder-population-v4",
              source: population.source,
              rules: population.rules,
              excluded,
              members,
            },
            (_, item) => (typeof item === "bigint" ? item.toString() : item),
          ),
        ),
      );
      const data = JSON.parse(plan.evidenceJson!);
      data.dependencies.find(
        (row: { populationHash?: string }) => row.populationHash,
      ).populationHash = legacyPopulationHash;
      const changed = proProgramEvidenceJson(data);
      await expect(
        replayVerifiedProProgramPlan(
          f.launch,
          changed,
          keccak256(stringToHex(changed)),
        ),
      ).rejects.toThrow(
        "re-derived actions, allocations or public evidence differ",
      );
    },
  );

  it.each(["top-n", "equal"] as const)(
    "excludes the creator before %s filtering without accepting a caller-supplied exclusion list",
    async (kind) => {
      const f = await fixture(kind === "top-n" ? 15 : 19);
      const population = buildProHolderPopulation(f.input.source, f.balances, {
        kind,
        moduleId: kind === "top-n" ? 15 : 19,
        minHolding: 0n,
        ...(kind === "top-n" ? { topN: 2 } : {}),
      });
      expect(population.members.map((row) => row.balance)).toEqual(
        kind === "top-n" ? [50n, 30n] : [50n, 30n, 20n],
      );
    },
  );

  it.each(["top-n", "equal", "shrimp-band"] as const)(
    "preserves creator eligibility for a generic %s population",
    async (kind) => {
      const f = await fixture(1);
      const population = buildProHolderPopulation(f.input.source, f.balances, {
        kind,
        minHolding: 0n,
        ...(kind === "top-n" ? { topN: 2 } : {}),
        ...(kind === "shrimp-band" ? { maxHolding: 1000n } : {}),
      });
      expect(population.excluded).not.toContain(f.creator.toLowerCase());
      expect(
        population.members.some(
          (row) => row.account === f.creator.toLowerCase(),
        ),
      ).toBe(true);
    },
  );

  it.each([
    { kind: "equal", moduleId: 15 },
    { kind: "top-n", moduleId: 19, topN: 2 },
  ] as const)(
    "rejects a mismatched module creator policy %o",
    async (rules) => {
      const f = await fixture(1);
      expect(() =>
        buildProHolderPopulation(f.input.source, f.balances, {
          ...rules,
          minHolding: 0n,
        }),
      ).toThrow("module-specific creator policy");
    },
  );

  it.each([15, 19] as const)(
    "retains M%d fees when the creator is the only noncustody holder",
    async (moduleId) => {
      const f = await fixture(moduleId);
      const plan = await planVerifiedProProgramCycle(f.launch, {
        ...f.input,
        balances: [
          { account: f.curve, balance: 700n },
          { account: f.creator, balance: 300n },
        ],
      });
      expect(plan.status).toBe("retained");
      expect(plan.rewards).toHaveLength(0);
      expect(plan.cycle!.actions[0]!.amount).toBe(0n);
    },
  );
});
