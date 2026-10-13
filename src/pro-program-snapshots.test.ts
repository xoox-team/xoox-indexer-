import { describe, expect, it } from "vitest";
import { zeroAddress, type Address, type Hex } from "viem";
import {
  allocateProHolderRewards,
  buildProHolderPopulation,
  drawProContestWinners,
  proHolderLeaf,
  proProgramSnapshotRows,
  selectProBuyerContest,
  validateProSnapshotCycle,
  verifyProHolderProof,
  type ProBuyerCoverage,
  type ProCanonicalBuy,
  type ProHolderRules,
  type ProSnapshotSource,
} from "./pro-program-snapshots";
const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const source: ProSnapshotSource = {
  chainId: 143,
  token: address(1),
  factory: address(2),
  curve: address(3),
  vault: address(4),
  creator: address(7),
  configurationHash: hash(1),
  tokenCodeHash: hash(2),
  createdBlock: 10n,
  blockNumber: 20n,
  blockHash: hash(20),
  timestamp: 200n,
  tokenDecimals: 18,
  genesisSupply: 1000n,
  cumulativeBurned: 10n,
  currentSupply: 990n,
  balancesComplete: true,
  balancesFromBlock: 10n,
  balancesThroughBlock: 20n,
  infrastructure: [address(5), address(6)],
};
const balances = [
  { account: source.curve, balance: 500n },
  { account: source.vault, balance: 100n },
  { account: address(5), balance: 100n },
  { account: address(10), balance: 90n },
  { account: address(11), balance: 90n },
  { account: address(12), balance: 110n },
];
const population = (
  rules: ProHolderRules = { kind: "pro-rata", minHolding: 0n },
) => buildProHolderPopulation(source, balances, rules);
const allocationInput = {
  program: 2n,
  cycle: 7n,
  asset: zeroAddress,
  assetDecimals: 18,
  amount: 17n,
};

describe("Pro current-balance population and dust-conserving Vault proofs", () => {
  it("excludes Curve, Vault, Manager, Router and infrastructure without dropping supply conservation", () => {
    const p = population();
    expect(p.members.map((row) => row.account)).toEqual([
      address(10),
      address(11),
      address(12),
    ]);
    expect(p.members.map((row) => row.balance)).toEqual([90n, 90n, 110n]);
    expect(Object.isFrozen(p.members)).toBe(true);
  });
  it("preserves token base units and inclusive fractional min/max bands", () => {
    const p = population({
      kind: "shrimp-band",
      minHolding: 90n,
      maxHolding: 90n,
      weighting: "equal",
    });
    expect(p.members.map((row) => row.account)).toEqual([
      address(10),
      address(11),
    ]);
    expect(
      population({ kind: "equal", minHolding: 91n }).members.map(
        (row) => row.account,
      ),
    ).toEqual([address(12)]);
  });
  it("selects top-N with deterministic address ties independent of database order", () => {
    const rules = { kind: "top-n", minHolding: 0n, topN: 2 } as const;
    const p = population(rules),
      reversed = buildProHolderPopulation(
        source,
        [...balances].reverse(),
        rules,
      );
    expect(p.members.map((row) => row.account)).toEqual([
      address(10),
      address(12),
    ]);
    expect(p.populationHash).toBe(reversed.populationHash);
  });
  it.each([
    { balancesComplete: false },
    { balancesFromBlock: 11n },
    { balancesThroughBlock: 19n },
    { currentSupply: 991n },
    { tokenDecimals: -1 },
  ])("rejects incomplete or inconsistent snapshot %o", (change) =>
    expect(() =>
      buildProHolderPopulation({ ...source, ...change }, balances, {
        kind: "equal",
        minHolding: 0n,
      }),
    ).toThrow(),
  );
  it("rejects missing rows, duplicate accounts, invalid bands and negative balances", () => {
    expect(() =>
      buildProHolderPopulation(source, balances.slice(1), {
        kind: "equal",
        minHolding: 0n,
      }),
    ).toThrow("conserve");
    expect(() =>
      buildProHolderPopulation(
        source,
        [...balances, { account: address(10), balance: 0n }],
        { kind: "equal", minHolding: 0n },
      ),
    ).toThrow("duplicate");
    expect(() =>
      population({ kind: "shrimp-band", minHolding: 100n, maxHolding: 99n }),
    ).toThrow("inverted");
    expect(() =>
      buildProHolderPopulation(
        source,
        [{ account: address(10), balance: -1n }],
        { kind: "equal", minHolding: 0n },
      ),
    ).toThrow("units");
  });
  it("allocates pro-rata dust by largest remainder and validates every sorted-pair proof", () => {
    const result = allocateProHolderRewards(population(), allocationInput);
    expect(result.allocations.map((row) => row.amount)).toEqual([5n, 5n, 7n]);
    expect(result.allocations.reduce((sum, row) => sum + row.amount, 0n)).toBe(
      17n,
    );
    for (const row of result.allocations)
      expect(verifyProHolderProof(row.leaf, row.proof, result.root)).toBe(true);
    const first = result.allocations[0]!;
    expect(
      verifyProHolderProof(
        proHolderLeaf(
          source.vault,
          2n,
          7n,
          zeroAddress,
          first.account,
          first.amount + 1n,
        ),
        first.proof,
        result.root,
      ),
    ).toBe(false);
  });
  it("allocates equal rewards exactly with address tie-breaking and 6-decimal payout units", () => {
    const result = allocateProHolderRewards(
      population({ kind: "equal", minHolding: 0n }),
      { ...allocationInput, amount: 5n, asset: address(20), assetDecimals: 6 },
    );
    expect(result.allocations.map((row) => row.amount)).toEqual([2n, 2n, 1n]);
    expect(result.assetDecimals).toBe(6);
    expect(
      allocateProHolderRewards(population(), { ...allocationInput, amount: 1n })
        .allocations,
    ).toHaveLength(1);
  });
  it("rejects empty, unfunded and uint64-overflow reward roots", () => {
    expect(() =>
      allocateProHolderRewards(population(), {
        ...allocationInput,
        amount: 0n,
      }),
    ).toThrow("funded");
    expect(() =>
      allocateProHolderRewards(
        population({ kind: "equal", minHolding: 111n }),
        allocationInput,
      ),
    ).toThrow("funded");
    expect(() =>
      allocateProHolderRewards(population(), {
        ...allocationInput,
        cycle: 1n << 64n,
      }),
    ).toThrow("units");
  });
  it("matches an independently generated cast ABI/double-keccak vector", () => {
    expect(
      proHolderLeaf(address(4), 2n, 7n, zeroAddress, address(10), 17n),
    ).toBe(
      "0x01f52b110c2197d6ff6be68e3c0b95bfc0a8672540a362d28c9862665844f0b7",
    );
  });
  it("produces exact schema rows and rejects stale/replayed cycles before keeper execution", () => {
    const p = population(),
      reward = allocateProHolderRewards(p, allocationInput),
      rows = proProgramSnapshotRows(p, reward, address(99));
    expect(rows.snapshot).toMatchObject({
      id: `143:${source.token}:2:7`,
      total: 17n,
      root: reward.root,
      observedBlockHash: source.blockHash,
    });
    expect(rows.claims.reduce((sum, row) => sum + row.amount, 0n)).toBe(
      rows.snapshot.total,
    );
    expect(() =>
      validateProSnapshotCycle(p, {
        cycle: 7n,
        lastCycle: 6n,
        now: 205n,
        deadline: 215n,
        snapshotMaxAge: 30n,
      }),
    ).not.toThrow();
    for (const change of [
      { now: 231n },
      { lastCycle: 7n },
      { deadline: 204n },
      { deadline: 236n },
      { now: 199n },
    ])
      expect(() =>
        validateProSnapshotCycle(p, {
          cycle: 7n,
          lastCycle: 6n,
          now: 205n,
          deadline: 215n,
          snapshotMaxAge: 30n,
          ...change,
        }),
      ).toThrow("stale/future");
  });
  it("keeps canonical commitments stable across input field/infrastructure order", () => {
    const reversed = Object.fromEntries(
      Object.entries(source).reverse(),
    ) as ProSnapshotSource;
    expect(
      buildProHolderPopulation(
        { ...reversed, infrastructure: [...source.infrastructure].reverse() },
        [...balances].reverse(),
        { minHolding: 0n, kind: "pro-rata" },
      ).populationHash,
    ).toBe(population().populationHash);
  });
});

const buys: ProCanonicalBuy[] = [
  {
    id: "tx1:1",
    token: source.token,
    buyer: address(10),
    recipient: address(11),
    quoteAmount: 10n,
    blockNumber: 12n,
    blockHash: hash(12),
    timestamp: 120n,
    logIndex: 1,
    source: "curve",
  },
  {
    id: "tx2:1",
    token: source.token,
    buyer: address(11),
    recipient: address(11),
    quoteAmount: 8n,
    blockNumber: 14n,
    blockHash: hash(14),
    timestamp: 140n,
    logIndex: 1,
    source: "pool",
  },
  {
    id: "tx2:2",
    token: source.token,
    buyer: address(11),
    recipient: address(11),
    quoteAmount: 3n,
    blockNumber: 14n,
    blockHash: hash(14),
    timestamp: 140n,
    logIndex: 2,
    source: "pool",
  },
];
const coverage: ProBuyerCoverage[] = ["curve", "pool"].map((kind) => ({
  token: source.token,
  fromTimestamp: 100n,
  throughTimestamp: 200n,
  throughBlock: 20n,
  throughBlockHash: hash(20),
  source: kind as "curve" | "pool",
  scope: "all-public-swaps",
  complete: true,
  evidence: hash(kind === "curve" ? 1 : 2),
}));
const buyerRules = {
  kind: "biggest-buyer",
  fromTimestamp: 100n,
  throughTimestamp: 200n,
  requiredSources: ["curve", "pool"],
} as const;
describe("Pro canonical buyer contest windows", () => {
  it("aggregates canonical quote spent by buyer, including repeat buys and recipient differences", () => {
    const result = selectProBuyerContest(
      population(),
      buys,
      coverage,
      buyerRules,
    );
    expect(result.winner).toBe(address(11));
    expect(
      selectProBuyerContest(
        population(),
        [...buys].reverse(),
        [...coverage].reverse(),
        buyerRules,
      ).evidence,
    ).toBe(result.evidence);
  });
  it("uses canonical block/log order for last buyer and enforces the quiet timer", () => {
    expect(
      selectProBuyerContest(population(), buys, coverage, {
        ...buyerRules,
        kind: "last-buyer",
        quietSeconds: 60n,
      }).winner,
    ).toBe(address(11));
    expect(() =>
      selectProBuyerContest(population(), buys, coverage, {
        ...buyerRules,
        kind: "last-buyer",
        quietSeconds: 61n,
      }),
    ).toThrow("quiet");
  });
  it("refuses incomplete alternate-route coverage, stale block identity and duplicate trades", () => {
    expect(() =>
      selectProBuyerContest(
        population(),
        buys,
        coverage.map((c) => ({ ...c, complete: c.source !== "pool" })),
        buyerRules,
      ),
    ).toThrow("pool buyer coverage");
    expect(() =>
      selectProBuyerContest(
        population(),
        buys,
        coverage.map((c) => ({ ...c, throughBlockHash: hash(21) })),
        buyerRules,
      ),
    ).toThrow("coverage");
    expect(() =>
      selectProBuyerContest(
        population(),
        [...buys, buys[0]!],
        coverage,
        buyerRules,
      ),
    ).toThrow("duplicate");
    expect(() =>
      selectProBuyerContest(
        population(),
        buys,
        coverage.map((c) => ({
          ...c,
          scope:
            c.source === "pool" ? "reviewed-router-only" : "all-public-swaps",
        })),
        buyerRules,
      ),
    ).toThrow("pool buyer coverage");
  });
  it("excludes infrastructure buyers and resolves biggest-buyer ties by address", () => {
    const sameTotals = [
      { ...buys[0]!, quoteAmount: 11n },
      ...buys.slice(1),
      {
        ...buys[0]!,
        id: "infrastructure",
        logIndex: 3,
        buyer: source.curve,
        quoteAmount: 1000n,
      },
    ];
    expect(
      selectProBuyerContest(population(), sameTotals, coverage, buyerRules)
        .winner,
    ).toBe(address(10));
  });
  it("requires pool coverage after graduation and excludes creator contest payouts", () => {
    const p = buildProHolderPopulation(
      { ...source, poolCreatedBlock: 14n, poolCreatedAt: 140n },
      balances,
      { kind: "equal", minHolding: 0n },
    );
    expect(() =>
      selectProBuyerContest(p, buys, coverage, {
        ...buyerRules,
        requiredSources: ["curve"],
      }),
    ).toThrow("pool buyer coverage");
    expect(
      selectProBuyerContest(
        p,
        [
          ...buys,
          {
            ...buys[0]!,
            id: "creator",
            logIndex: 3,
            buyer: source.creator,
            quoteAmount: 1000n,
          },
        ],
        coverage,
        buyerRules,
      ).winner,
    ).toBe(address(11));
  });
});
describe("Pro explicitly attested lottery/raffle selection", () => {
  const draw = {
    seed: hash(44),
    seedEvidence: hash(55),
    authority: address(99),
    count: 3,
    weighting: "balance",
  } as const;
  it("replays the same seed/population without replacement and discloses authority trust", () => {
    const result = drawProContestWinners(population(), draw);
    expect(new Set(result.winners).size).toBe(3);
    expect(drawProContestWinners(population(), draw)).toEqual(result);
    expect(result.trust).toBe("immutable-authority-attested-seed");
    expect(Object.isFrozen(result.winners)).toBe(true);
  });
  it("supports equal chances and rejects insufficient entrants or missing seed evidence", () => {
    expect(
      drawProContestWinners(population(), {
        ...draw,
        weighting: "equal",
        count: 2,
      }).winners,
    ).toHaveLength(2);
    expect(() =>
      drawProContestWinners(population(), { ...draw, count: 4 }),
    ).toThrow("count");
    expect(() =>
      drawProContestWinners(population(), { ...draw, seedEvidence: hash(0) }),
    ).toThrow("evidence");
  });
  it("keeps creator holder earnings eligible while excluding creator from lottery entrants", () => {
    const p = buildProHolderPopulation(
      { ...source, creator: address(10) },
      balances,
      { kind: "equal", minHolding: 0n },
    );
    expect(
      allocateProHolderRewards(p, allocationInput).allocations.some(
        (row) => row.account === address(10),
      ),
    ).toBe(true);
    const result = drawProContestWinners(p, { ...draw, count: 2 });
    expect(result.winners).not.toContain(address(10));
    expect(result.populationHash).not.toBe(p.populationHash);
    expect(() => drawProContestWinners(p, draw)).toThrow("count");
  });
});
