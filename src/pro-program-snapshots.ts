import {
  concatHex,
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

const UINT256 = (1n << 256n) - 1n;
const DEAD = "0x000000000000000000000000000000000000dead";
const lower = (value: string) => value.toLowerCase();
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Pro snapshot: ${message}`);
}
function address(value: string, allowZero = false): Address {
  ensure(
    isAddress(value, { strict: true }) &&
      (allowZero || lower(value) !== zeroAddress),
    "invalid address.",
  );
  return lower(value) as Address;
}
function hash(value: string): Hex {
  ensure(/^0x[\da-fA-F]{64}$/.test(value), "invalid evidence hash.");
  return lower(value) as Hex;
}
function uint(value: bigint, maximum = UINT256) {
  ensure(
    typeof value === "bigint" && value >= 0n && value <= maximum,
    "invalid integer units.",
  );
  return value;
}
function digest(value: unknown): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify(value, (_, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    ),
  );
}
const compareAddress = (a: { account: string }, b: { account: string }) =>
  a.account < b.account ? -1 : a.account > b.account ? 1 : 0;

export type ProBalance = Readonly<{ account: string; balance: bigint }>;
export type ProSnapshotSource = Readonly<{
  chainId: number;
  token: string;
  factory: string;
  curve: string;
  vault: string;
  creator: string;
  configurationHash: string;
  tokenCodeHash: string;
  createdBlock: bigint;
  blockNumber: bigint;
  blockHash: string;
  timestamp: bigint;
  tokenDecimals: number;
  genesisSupply: bigint;
  cumulativeBurned: bigint;
  currentSupply: bigint;
  /** Full canonical Transfer replay from the receipt-verified constructor mint. */
  balancesComplete: boolean;
  balancesFromBlock: bigint;
  balancesThroughBlock: bigint;
  infrastructure: readonly string[];
  poolCreatedBlock?: bigint;
  poolCreatedAt?: bigint;
}>;
const acceptedPopulations = new WeakSet<object>();
export type ProHolderRules = Readonly<{
  kind: "pro-rata" | "equal" | "top-n" | "shrimp-band";
  /** Only canonical M15/M19 planner branches select these creator exclusions.
   * Generic equal/ranked populations retain their independent creator policy. */
  moduleId?: 15 | 19;
  minHolding: bigint;
  maxHolding?: bigint;
  topN?: number;
  /** Ranked and balance-band payouts still explicitly select their weighting. */
  weighting?: "balance" | "equal";
}>;
export type ProAcceptedPopulation = Readonly<{
  source: ProSnapshotSource;
  rules: ProHolderRules;
  members: readonly ProBalance[];
  excluded: readonly Address[];
  populationHash: Hex;
}>;

/** Integer balances and thresholds are token base units, including fractional tokens.
 * The caller must read the complete holder ledger at the stated canonical block.
 * This pure engine does not turn an unverified API response into canonical evidence.
 */
export function buildProHolderPopulation(
  source: ProSnapshotSource,
  balances: readonly ProBalance[],
  rules: ProHolderRules,
): ProAcceptedPopulation {
  ensure(
    Number.isSafeInteger(source.chainId) &&
      source.chainId > 0 &&
      Number.isSafeInteger(source.tokenDecimals) &&
      source.tokenDecimals >= 0 &&
      source.tokenDecimals <= 255,
    "invalid chain/decimals.",
  );
  ensure(
    (source.poolCreatedBlock === undefined) ===
      (source.poolCreatedAt === undefined),
    "pool transition evidence is incomplete.",
  );
  const captured: ProSnapshotSource = Object.freeze({
    chainId: source.chainId,
    token: address(source.token),
    factory: address(source.factory),
    curve: address(source.curve),
    vault: address(source.vault),
    creator: address(source.creator),
    configurationHash: hash(source.configurationHash),
    tokenCodeHash: hash(source.tokenCodeHash),
    createdBlock: source.createdBlock,
    blockNumber: source.blockNumber,
    blockHash: hash(source.blockHash),
    timestamp: source.timestamp,
    tokenDecimals: source.tokenDecimals,
    genesisSupply: source.genesisSupply,
    cumulativeBurned: source.cumulativeBurned,
    currentSupply: source.currentSupply,
    balancesComplete: source.balancesComplete,
    balancesFromBlock: source.balancesFromBlock,
    balancesThroughBlock: source.balancesThroughBlock,
    infrastructure: Object.freeze(
      [...new Set(source.infrastructure.map((item) => address(item)))].sort(),
    ),
    ...(source.poolCreatedBlock === undefined
      ? {}
      : {
          poolCreatedBlock: source.poolCreatedBlock,
          poolCreatedAt: source.poolCreatedAt,
        }),
  });
  [
    captured.createdBlock,
    captured.blockNumber,
    captured.timestamp,
    captured.genesisSupply,
    captured.cumulativeBurned,
    captured.currentSupply,
    captured.balancesFromBlock,
    captured.balancesThroughBlock,
  ].forEach((item) => uint(item));
  ensure(
    captured.genesisSupply > 0n &&
      captured.cumulativeBurned <= captured.genesisSupply &&
      captured.currentSupply + captured.cumulativeBurned ===
        captured.genesisSupply,
    "supply/burn reconciliation differs.",
  );
  ensure(
    captured.balancesComplete &&
      captured.balancesFromBlock === captured.createdBlock &&
      captured.balancesThroughBlock === captured.blockNumber &&
      captured.blockNumber >= captured.createdBlock,
    "complete canonical balance replay is unavailable.",
  );
  ensure(
    (captured.poolCreatedBlock === undefined) ===
      (captured.poolCreatedAt === undefined),
    "pool transition evidence is incomplete.",
  );
  if (captured.poolCreatedBlock !== undefined)
    ensure(
      captured.poolCreatedBlock >= captured.createdBlock &&
        captured.poolCreatedBlock <= captured.blockNumber &&
        captured.poolCreatedAt! <= captured.timestamp &&
        captured.poolCreatedAt! >= 0n,
      "pool transition is outside accepted history.",
    );
  ensure(
    ["pro-rata", "equal", "top-n", "shrimp-band"].includes(rules.kind),
    "unknown holder rule.",
  );
  ensure(
    rules.moduleId === undefined ||
      (rules.moduleId === 15 && rules.kind === "top-n") ||
      (rules.moduleId === 19 && rules.kind === "equal"),
    "module-specific creator policy differs from holder rule.",
  );
  uint(rules.minHolding);
  if (rules.maxHolding !== undefined) uint(rules.maxHolding);
  ensure(
    rules.maxHolding === undefined || rules.maxHolding >= rules.minHolding,
    "holding band is inverted.",
  );
  ensure(
    rules.kind !== "shrimp-band" || rules.maxHolding !== undefined,
    "shrimp band requires an upper bound.",
  );
  ensure(
    rules.kind !== "top-n" ||
      (Number.isSafeInteger(rules.topN) && rules.topN! > 0),
    "top-N requires a positive count.",
  );
  ensure(
    rules.weighting === undefined ||
      ["equal", "balance"].includes(rules.weighting),
    "unknown weighting.",
  );
  const excluded = Object.freeze(
    [
      ...new Set(
        [
          zeroAddress,
          DEAD,
          captured.token,
          captured.factory,
          captured.curve,
          captured.vault,
          // The module selector is derived from the immutable program, then
          // reconstructed on replay; callers cannot add arbitrary exclusions.
          ...(rules.moduleId === 15 || rules.moduleId === 19
            ? [captured.creator]
            : []),
          ...captured.infrastructure,
        ].map(lower),
      ),
    ].sort() as Address[],
  );
  const excludedSet = new Set(excluded),
    seen = new Set<string>();
  let sum = 0n;
  const all = balances.map((item) => {
    const account = address(item.account);
    uint(item.balance);
    ensure(!seen.has(account), "duplicate holder row.");
    seen.add(account);
    sum += item.balance;
    return Object.freeze({ account, balance: item.balance });
  });
  ensure(
    sum === captured.currentSupply,
    "holder balances do not conserve accepted supply.",
  );
  let members = all.filter(
    (item) =>
      item.balance > 0n &&
      !excludedSet.has(item.account) &&
      item.balance >= rules.minHolding &&
      (rules.maxHolding === undefined || item.balance <= rules.maxHolding),
  );
  if (rules.kind === "top-n")
    members = members
      .sort((a, b) =>
        a.balance === b.balance
          ? compareAddress(a, b)
          : a.balance > b.balance
            ? -1
            : 1,
      )
      .slice(0, rules.topN);
  members.sort(compareAddress);
  const capturedRules = Object.freeze({
    kind: rules.kind,
    ...(rules.moduleId === undefined ? {} : { moduleId: rules.moduleId }),
    minHolding: rules.minHolding,
    ...(rules.maxHolding === undefined ? {} : { maxHolding: rules.maxHolding }),
    ...(rules.topN === undefined ? {} : { topN: rules.topN }),
    ...(rules.weighting === undefined ? {} : { weighting: rules.weighting }),
  });
  const populationHash = digest({
    domain: "xoox-pro-holder-population-v4",
    source: captured,
    rules: capturedRules,
    excluded,
    members,
  });
  const result = Object.freeze({
    source: captured,
    rules: capturedRules,
    excluded,
    members: Object.freeze(members),
    populationHash,
  });
  acceptedPopulations.add(result);
  return result;
}

export type ProHolderAllocation = Readonly<{
  account: Address;
  amount: bigint;
  leaf: Hex;
  proof: readonly Hex[];
}>;
/** Exact Solidity Vault.holderLeaf; the contract domain is the vault address.
 * Chain/source/snapshot evidence belongs in Cycle.evidence, outside this ABI leaf.
 */
export function proHolderLeaf(
  vault: string,
  program: bigint,
  cycle: bigint,
  asset: string,
  beneficiary: string,
  amount: bigint,
): Hex {
  uint(program);
  uint(cycle, (1n << 64n) - 1n);
  uint(amount);
  const inner = keccak256(
    encodeAbiParameters(
      parseAbiParameters("address,uint256,uint64,address,address,uint256"),
      [
        address(vault),
        program,
        cycle,
        address(asset, true),
        address(beneficiary),
        amount,
      ],
    ),
  );
  return keccak256(inner);
}
function pair(a: Hex, b: Hex) {
  return keccak256(a < b ? concatHex([a, b]) : concatHex([b, a]));
}
export function verifyProHolderProof(
  leaf: Hex,
  proof: readonly Hex[],
  root: Hex,
) {
  return (
    proof.reduce(
      (node, sibling) => pair(hash(node), hash(sibling)),
      hash(leaf),
    ) === hash(root)
  );
}

/** Largest-remainder allocation spends every base unit. Ties resolve by address,
 * never input order. Zero entitlements are omitted because Vault forbids zero claims.
 */
export function allocateProHolderRewards(
  population: ProAcceptedPopulation,
  input: Readonly<{
    program: bigint;
    cycle: bigint;
    asset: string;
    assetDecimals: number;
    amount: bigint;
  }>,
) {
  ensure(
    acceptedPopulations.has(population),
    "population must come from the validated builder.",
  );
  uint(input.amount);
  ensure(
    input.amount > 0n && population.members.length > 0,
    "funded nonempty population required.",
  );
  ensure(
    Number.isSafeInteger(input.assetDecimals) &&
      input.assetDecimals >= 0 &&
      input.assetDecimals <= 255,
    "invalid reward decimals.",
  );
  const weighted =
    population.rules.kind === "pro-rata" ||
    (population.rules.kind !== "equal" &&
      population.rules.weighting !== "equal");
  const rows = population.members.map((member) => ({
    ...member,
    weight: weighted ? member.balance : 1n,
    amount: 0n,
    remainder: 0n,
  }));
  const denominator = rows.reduce((sum, row) => sum + row.weight, 0n);
  for (const row of rows) {
    const product = input.amount * row.weight;
    row.amount = product / denominator;
    row.remainder = product % denominator;
  }
  const dust = input.amount - rows.reduce((sum, row) => sum + row.amount, 0n);
  const remainderOrder = [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? compareAddress(a, b)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; BigInt(i) < dust; i++) remainderOrder[i]!.amount++;
  const funded = rows.filter((row) => row.amount > 0n).sort(compareAddress);
  const leaves = funded.map((row) =>
    proHolderLeaf(
      population.source.vault,
      input.program,
      input.cycle,
      input.asset,
      row.account,
      row.amount,
    ),
  );
  const levels: Hex[][] = [leaves];
  while (levels.at(-1)!.length > 1) {
    const prior = levels.at(-1)!,
      next: Hex[] = [];
    for (let i = 0; i < prior.length; i += 2)
      next.push(prior[i + 1] ? pair(prior[i]!, prior[i + 1]!) : prior[i]!);
    levels.push(next);
  }
  const allocations: ProHolderAllocation[] = funded.map((row, index) => {
    let cursor = index;
    const proof: Hex[] = [];
    for (const level of levels.slice(0, -1)) {
      const sibling = cursor ^ 1;
      if (level[sibling]) proof.push(level[sibling]!);
      cursor = Math.floor(cursor / 2);
    }
    return Object.freeze({
      account: row.account as Address,
      amount: row.amount,
      leaf: leaves[index]!,
      proof: Object.freeze(proof),
    });
  });
  const root = levels.at(-1)![0]!;
  const evidence = digest({
    domain: "xoox-pro-holder-allocation-v4",
    populationHash: population.populationHash,
    program: input.program,
    cycle: input.cycle,
    asset: address(input.asset, true),
    assetDecimals: input.assetDecimals,
    amount: input.amount,
    root,
  });
  return Object.freeze({
    root,
    evidence,
    populationHash: population.populationHash,
    total: input.amount,
    asset: address(input.asset, true),
    assetDecimals: input.assetDecimals,
    program: input.program,
    cycle: input.cycle,
    vault: address(population.source.vault),
    allocations: Object.freeze(allocations),
  });
}

export type ProCanonicalBuy = Readonly<{
  id: string;
  token: string;
  buyer: string;
  recipient: string;
  quoteAmount: bigint;
  /** Actual settled token output, when a canonical producer supplies it. */
  tokenAmount?: bigint;
  blockNumber: bigint;
  blockHash: string;
  timestamp: bigint;
  logIndex: number;
  source: "curve" | "pool";
}>;
export type ProBuyerCoverage = Readonly<{
  token: string;
  fromTimestamp: bigint;
  throughTimestamp: bigint;
  throughBlock: bigint;
  throughBlockHash: string;
  source: "curve" | "pool";
  scope: "all-public-swaps" | "reviewed-router-only";
  complete: boolean;
  evidence: string;
}>;
/** A public-router subset cannot be marked complete. A pool indexer must also
 * establish buyer attribution for alternate public routes before contest use.
 */
export function selectProBuyerContest(
  population: ProAcceptedPopulation,
  buys: readonly ProCanonicalBuy[],
  coverage: readonly ProBuyerCoverage[],
  rules: Readonly<{
    kind: "biggest-buyer" | "last-buyer";
    fromTimestamp: bigint;
    throughTimestamp: bigint;
    requiredSources: readonly ("curve" | "pool")[];
    quietSeconds?: bigint;
  }>,
) {
  ensure(
    acceptedPopulations.has(population),
    "population must come from the validated builder.",
  );
  uint(rules.fromTimestamp);
  uint(rules.throughTimestamp);
  ensure(
    rules.fromTimestamp <= rules.throughTimestamp &&
      rules.throughTimestamp <= population.source.timestamp &&
      rules.requiredSources.length > 0 &&
      new Set(rules.requiredSources).size === rules.requiredSources.length &&
      rules.requiredSources.every((source) =>
        ["curve", "pool"].includes(source),
      ),
    "invalid buyer window/sources.",
  );
  const poolAt = population.source.poolCreatedAt;
  ensure(
    poolAt !== undefined && rules.throughTimestamp >= poolAt
      ? rules.requiredSources.includes("pool")
      : true,
    "graduated window requires all-public pool buyer coverage.",
  );
  ensure(
    poolAt === undefined || rules.fromTimestamp <= poolAt
      ? rules.requiredSources.includes("curve")
      : true,
    "pregraduation window requires complete Curve buyer coverage.",
  );
  for (const source of rules.requiredSources)
    ensure(
      coverage.some(
        (item) =>
          item.source === source &&
          item.scope === "all-public-swaps" &&
          item.complete &&
          lower(item.token) === population.source.token &&
          item.fromTimestamp <= rules.fromTimestamp &&
          item.throughTimestamp >= rules.throughTimestamp &&
          item.throughBlock === population.source.blockNumber &&
          lower(item.throughBlockHash) === population.source.blockHash &&
          hash(item.evidence) !== `0x${"00".repeat(32)}`,
      ),
      `complete canonical ${source} buyer coverage is unavailable.`,
    );
  const excluded = new Set([
      ...population.excluded,
      address(population.source.creator),
    ]),
    seen = new Set<string>(),
    positions = new Set<string>(),
    blocks = new Map<bigint, { hash: Hex; timestamp: bigint }>();
  const candidates = buys
    .map((buy) => {
      ensure(!seen.has(buy.id), "duplicate buyer event.");
      seen.add(buy.id);
      ensure(
        lower(buy.token) === population.source.token &&
          Number.isSafeInteger(buy.logIndex) &&
          buy.logIndex >= 0 &&
          rules.requiredSources.includes(buy.source),
        "buyer event identity/source differs.",
      );
      uint(buy.blockNumber);
      uint(buy.timestamp);
      uint(buy.quoteAmount);
      hash(buy.blockHash);
      const blockHash = hash(buy.blockHash),
        position = `${buy.blockNumber}:${buy.logIndex}`,
        priorBlock = blocks.get(buy.blockNumber);
      ensure(
        !positions.has(position),
        "duplicate canonical buyer log position.",
      );
      positions.add(position);
      ensure(
        !priorBlock ||
          (priorBlock.hash === blockHash &&
            priorBlock.timestamp === buy.timestamp),
        "buyer history mixes canonical block identities.",
      );
      blocks.set(buy.blockNumber, {
        hash: blockHash,
        timestamp: buy.timestamp,
      });
      ensure(
        buy.blockNumber >= population.source.createdBlock &&
          buy.blockNumber <= population.source.blockNumber &&
          (buy.blockNumber !== population.source.blockNumber ||
            blockHash === population.source.blockHash) &&
          buy.timestamp <= population.source.timestamp &&
          buy.quoteAmount > 0n,
        "buyer event is outside accepted history.",
      );
      return Object.freeze({
        ...buy,
        buyer: address(buy.buyer),
        recipient: address(buy.recipient),
        blockHash: hash(buy.blockHash),
      });
    })
    .filter(
      (buy) =>
        buy.timestamp >= rules.fromTimestamp &&
        buy.timestamp <= rules.throughTimestamp &&
        !excluded.has(buy.buyer),
    );
  ensure(candidates.length > 0, "no eligible canonical buyers.");
  let winner: Address;
  if (rules.kind === "biggest-buyer") {
    const totals = new Map<Address, bigint>();
    for (const buy of candidates)
      totals.set(buy.buyer, (totals.get(buy.buyer) ?? 0n) + buy.quoteAmount);
    winner = [...totals].sort(([a, av], [b, bv]) =>
      av === bv ? (a < b ? -1 : a > b ? 1 : 0) : av > bv ? -1 : 1,
    )[0]![0];
  } else {
    ensure(
      rules.kind === "last-buyer" &&
        rules.quietSeconds !== undefined &&
        rules.quietSeconds > 0n &&
        rules.throughTimestamp === population.source.timestamp,
      "last buyer requires a complete current quiet window.",
    );
    const last = candidates
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? a.logIndex - b.logIndex
          : a.blockNumber < b.blockNumber
            ? -1
            : 1,
      )
      .at(-1)!;
    ensure(
      population.source.timestamp - last.timestamp >= rules.quietSeconds,
      "last buyer quiet period is incomplete.",
    );
    winner = last.buyer;
  }
  return Object.freeze({
    winner,
    evidence: digest({
      domain: "xoox-pro-canonical-buyer-v4",
      populationHash: population.populationHash,
      rules,
      coverage: [...coverage].sort((a, b) => a.source.localeCompare(b.source)),
      buys: [...candidates].sort((a, b) => a.id.localeCompare(b.id)),
      winner,
    }),
  });
}

/** Deterministic replay of an explicitly attested seed, not an oracle fairness
 * guarantee. Immutable Vault authority chooses/attests the seed and evidence.
 */
export function drawProContestWinners(
  population: ProAcceptedPopulation,
  input: Readonly<{
    seed: string;
    seedEvidence: string;
    authority: string;
    count: number;
    weighting: "balance" | "equal";
  }>,
) {
  ensure(
    acceptedPopulations.has(population),
    "population must come from the validated builder.",
  );
  const seed = hash(input.seed),
    seedEvidence = hash(input.seedEvidence),
    authority = address(input.authority);
  const remaining = population.members
      .filter((member) => member.account !== population.source.creator)
      .sort(compareAddress),
    winners: Address[] = [];
  ensure(
    seedEvidence !== `0x${"00".repeat(32)}` &&
      Number.isSafeInteger(input.count) &&
      input.count > 0 &&
      input.count <= remaining.length &&
      ["balance", "equal"].includes(input.weighting),
    "invalid seed evidence/count/weighting.",
  );
  const contestPopulationHash = digest({
    domain: "xoox-pro-contest-population-v4",
    holderPopulationHash: population.populationHash,
    excludedCreator: population.source.creator,
    members: remaining,
  });
  for (let draw = 0; draw < input.count; draw++) {
    const weight = (item: ProBalance) =>
      input.weighting === "balance" ? item.balance : 1n;
    const total = remaining.reduce((sum, member) => sum + weight(member), 0n);
    ensure(
      total > 0n && total <= UINT256,
      "contest weight exceeds integer range.",
    );
    const ceiling = (1n << 256n) - ((1n << 256n) % total);
    let ticket: bigint | undefined;
    for (let attempt = 0; attempt < 256; attempt++) {
      const random = BigInt(
        keccak256(
          encodeAbiParameters(
            parseAbiParameters("bytes32,bytes32,uint256,uint256"),
            [seed, contestPopulationHash, BigInt(draw), BigInt(attempt)],
          ),
        ),
      );
      if (random < ceiling) {
        ticket = random % total;
        break;
      }
    }
    ensure(ticket !== undefined, "randomness rejection sampling exhausted.");
    let cursor = ticket,
      selected = 0;
    while (cursor >= weight(remaining[selected]!)) {
      cursor -= weight(remaining[selected]!);
      selected++;
    }
    winners.push(address(remaining.splice(selected, 1)[0]!.account));
  }
  return Object.freeze({
    winners: Object.freeze(winners),
    populationHash: contestPopulationHash,
    holderPopulationHash: population.populationHash,
    seed,
    seedEvidence,
    authority,
    trust: "immutable-authority-attested-seed" as const,
    evidence: digest({
      domain: "xoox-pro-attested-contest-v4",
      populationHash: contestPopulationHash,
      seed,
      seedEvidence,
      authority,
      count: input.count,
      weighting: input.weighting,
      winners,
    }),
  });
}

/** Mirrors Vault.execute freshness/cycle gates before a keeper constructs actions.
 * Program interval, budget and exact authority still require canonical Vault reads.
 */
export function validateProSnapshotCycle(
  population: ProAcceptedPopulation,
  input: Readonly<{
    cycle: bigint;
    lastCycle: bigint;
    now: bigint;
    deadline: bigint;
    snapshotMaxAge: bigint;
  }>,
) {
  ensure(
    acceptedPopulations.has(population),
    "population must come from the validated builder.",
  );
  uint(input.cycle, (1n << 64n) - 1n);
  uint(input.lastCycle, (1n << 64n) - 1n);
  uint(input.now);
  uint(input.deadline);
  ensure(
    input.snapshotMaxAge > 0n &&
      input.snapshotMaxAge <= 86400n &&
      input.cycle === input.lastCycle + 1n &&
      population.source.timestamp <= input.now &&
      input.now - population.source.timestamp <= input.snapshotMaxAge &&
      input.deadline >= input.now &&
      input.deadline <= input.now + input.snapshotMaxAge,
    "stale/future snapshot, replayed cycle or invalid deadline.",
  );
}

/** Produces the schema rows for an atomic later keeper/API persistence transaction.
 * Creating rows is not publishing a root or making a production index write.
 */
export function proProgramSnapshotRows(
  population: ProAcceptedPopulation,
  reward: ReturnType<typeof allocateProHolderRewards>,
  authority: string,
) {
  ensure(
    acceptedPopulations.has(population) &&
      reward.populationHash === population.populationHash &&
      reward.vault === population.source.vault &&
      reward.allocations.reduce((sum, row) => sum + row.amount, 0n) ===
        reward.total &&
      reward.allocations.every((row) =>
        verifyProHolderProof(
          proHolderLeaf(
            reward.vault,
            reward.program,
            reward.cycle,
            reward.asset,
            row.account,
            row.amount,
          ),
          row.proof,
          reward.root,
        ),
      ),
    "reward rows differ from accepted snapshot.",
  );
  const launchId = `${population.source.chainId}:${population.source.token}`,
    id = `${launchId}:${reward.program}:${reward.cycle}`;
  return Object.freeze({
    snapshot: Object.freeze({
      id,
      launchId,
      program: reward.program,
      cycle: reward.cycle,
      populationHash: reward.populationHash,
      evidence: reward.evidence,
      root: reward.root,
      asset: reward.asset,
      assetDecimals: reward.assetDecimals,
      total: reward.total,
      observedBlock: population.source.blockNumber,
      observedBlockHash: population.source.blockHash,
      observedAt: population.source.timestamp,
      authority: address(authority),
    }),
    claims: Object.freeze(
      reward.allocations.map((row) =>
        Object.freeze({
          id: `${id}:${row.account}`,
          snapshotId: id,
          beneficiary: row.account,
          amount: row.amount,
          leaf: row.leaf,
          proof: row.proof,
        }),
      ),
    ),
  });
}
