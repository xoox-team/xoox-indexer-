import {
  encodeFunctionData,
  isAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import {
  validateProFeeProgramConfig,
  proFeeProgramConfigHash,
  type ProFeeProgramConfig,
  type ProFeeProgram,
  validateProFeeProgramCycle,
} from "./vendor/xoox-sdk/pro-fee-programs";
import {
  assertProFeeProgramLaunch,
  proFeeProgramLaunchAbi,
  type ProFeeProgramLaunch,
} from "./vendor/xoox-sdk/pro-fee-program-launch";
import {
  assertProFeeProgramCycleReceipt,
  type ProFeeProgramCycleReceipt,
} from "./vendor/xoox-sdk/pro-fee-program-receipts";
import {
  allocateProHolderRewards,
  buildProHolderPopulation,
  drawProContestWinners,
  selectProBuyerContest,
  type ProAcceptedPopulation,
  type ProBalance,
  type ProSnapshotSource,
  type ProBuyerCoverage,
  type ProCanonicalBuy,
} from "./pro-program-snapshots";

/** Exact append-only Solidity action enum. Configurations are immutable; the worker
 * chooses a bounded cycle, and the Vault independently validates every action. */
export enum ProProgramActionKind {
  Keep,
  Direct,
  HolderRoot,
  SwapAndSend,
  BuyAndBurn,
  BuyAndHold,
  NftPurchase,
  ContestPayout,
  HolderCarry,
}
export type ProProgramAction = Readonly<{
  kind: ProProgramActionKind;
  amount: bigint;
  outputAsset: Address;
  minOut: bigint;
  root: Hex;
  beneficiaries: readonly Address[];
  nftId: bigint;
  data: Hex;
}>;
export type ProProgramCycle = Readonly<{
  id: bigint;
  observedAt: bigint;
  deadline: bigint;
  evidence: Hex;
  actions: readonly ProProgramAction[];
}>;
export type ProProgramQuote = Readonly<{
  adapter: Address;
  adapterCodeHash: Hex;
  inputAsset: Address;
  outputAsset: Address;
  amountIn: bigint;
  amountSpent: bigint;
  amountOut: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  deadline: bigint;
  data: Hex;
  evidence: Hex;
  evidenceJson?: string;
}>;
export type ProProgramListing = Readonly<{
  collection: Address;
  tokenId: bigint;
  price: bigint;
  expiresAt: bigint;
  orderHash: Hex;
  data: Hex;
}>;
export type ProProgramExecutionInput = Readonly<{
  configuration: ProFeeProgramConfig;
  configurationHash: Hex;
  programIndex: number;
  source: ProSnapshotSource;
  quoteAsset: Address;
  quoteDecimals: number;
  executor: Address;
  now: bigint;
  state: Readonly<{
    budget: bigint;
    holderCarryQuote: bigint;
    lastCycle: bigint;
    lastCycleAt: bigint;
    waitingSince: bigint;
    salaryAvailable: bigint;
  }>;
  balances: readonly ProBalance[];
  assetDecimals: readonly Readonly<{ asset: Address; decimals: number }>[];
  quote: (
    request: Readonly<{
      program: ProFeeProgram;
      inputAsset: Address;
      outputAsset: Address;
      amountIn: bigint;
      deadline: bigint;
      blockHash: Hex;
    }>,
  ) => Promise<ProProgramQuote>;
  slippageBps: number;
  lottery?: Readonly<{
    seed: Hex;
    seedEvidence: Hex;
    authority: Address;
    evidenceJson?: string;
  }>;
  trades?: Readonly<{
    buys: readonly ProCanonicalBuy[];
    coverage: readonly ProBuyerCoverage[];
    windowFrom: bigint;
    requiredSources: readonly ("curve" | "pool")[];
    consumedLastBuyerIds: readonly string[];
  }>;
  listings?: Readonly<{
    collection: Address;
    blockHash: Hex;
    complete: boolean;
    evidence: Hex;
    items: readonly ProProgramListing[];
    evidenceJson?: string;
  }>;
}>;
export type ProProgramRewardIntent = Readonly<{
  population: ProAcceptedPopulation;
  asset: Address;
  assetDecimals: number;
  expectedAmount: bigint;
  publicationRequired: boolean;
  allocation?: ReturnType<typeof allocateProHolderRewards>;
}>;
export type ProProgramPlan = Readonly<{
  status: "ready" | "retained" | "not-due" | "empty-budget";
  reason: string;
  moduleId: number;
  programIndex: number;
  identity: Readonly<{
    chainId: number;
    factory: Address;
    token: Address;
    vault: Address;
    executor: Address;
    configurationHash: Hex;
    snapshotBlock: bigint;
    snapshotHash: Hex;
    snapshotTimestamp: bigint;
  }>;
  cycle?: ProProgramCycle;
  /** Exact UTF-8 preimage of cycle.evidence. Contains public observations, never credentials. */
  evidenceJson?: string;
  rewards: readonly ProProgramRewardIntent[];
  winnerEventId?: string;
}>;

const verifiedPlans = new WeakSet<object>();
export function assertVerifiedProProgramPlan(plan: ProProgramPlan): void {
  need(
    verifiedPlans.has(plan),
    "plan was not issued from an accepted canonical launch",
  );
}

export function proProgramEvidenceJson(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function need(value: unknown, reason: string): asserts value {
  if (!value) throw new Error("Pro program execution: " + reason + ".");
}
function uint(value: bigint) {
  need(
    typeof value === "bigint" && value >= 0n && value < 1n << 256n,
    "invalid unsigned amount",
  );
}
function addr(value: string): Address {
  need(isAddress(value), "invalid address");
  return value.toLowerCase() as Address;
}
function hash(value: string): Hex {
  need(
    /^0x[0-9a-fA-F]{64}$/.test(value) && value.toLowerCase() !== zeroHash,
    "missing evidence hash",
  );
  return value.toLowerCase() as Hex;
}
function optionalPreimage(value: string | undefined, evidence: Hex) {
  if (value === undefined) return;
  need(
    typeof value === "string" &&
      new TextEncoder().encode(value).length <= 16_777_216 &&
      keccak256(stringToHex(value)) === evidence,
    "public provider evidence does not match its digest",
  );
}
function digest(value: unknown): Hex {
  return keccak256(stringToHex(proProgramEvidenceJson(value)));
}
const bps = (amount: bigint, share: number) =>
  (amount * BigInt(share)) / 10_000n;
function action(
  kind: ProProgramActionKind,
  amount = 0n,
  outputAsset: Address = zeroAddress,
  change: Partial<ProProgramAction> = {},
): ProProgramAction {
  return Object.freeze({
    kind,
    amount,
    outputAsset,
    minOut: 0n,
    root: zeroHash,
    beneficiaries: Object.freeze([]) as readonly Address[],
    nftId: 0n,
    data: "0x" as Hex,
    ...change,
  });
}

/** Pure derivation from authority supplied canonical observations. It grants no
 * network/source admission. Production callers use planVerifiedProProgramCycle,
 * persist the evidence, simulate, and reconcile canonical receipts before retry. */
export async function deriveProProgramCycle(
  input: ProProgramExecutionInput,
): Promise<ProProgramPlan> {
  const config = validateProFeeProgramConfig(input.configuration, {
    creator: addr(input.source.creator),
    quoteAsset: addr(input.quoteAsset),
    quoteDecimals: input.quoteDecimals,
  });
  need(
    proFeeProgramConfigHash(config) === input.configurationHash,
    "immutable program configuration differs",
  );
  need(
    Number.isInteger(input.programIndex) &&
      input.programIndex >= 0 &&
      input.programIndex < config.programs.length,
    "unknown program index",
  );
  const p = config.programs[input.programIndex]!,
    id = p.moduleId;
  Object.values(input.state).forEach(uint);
  uint(input.now);
  need(
    input.state.lastCycle < (1n << 64n) - 1n &&
      input.source.timestamp <= input.now &&
      input.now - input.source.timestamp <= BigInt(config.snapshotMaxAge),
    "expired snapshot or cycle counter",
  );
  need(
    addr(p.authority) === zeroAddress ||
      addr(p.authority) === addr(input.executor),
    "executor differs from immutable authority",
  );
  need(
    Number.isInteger(input.slippageBps) &&
      input.slippageBps >= 0 &&
      input.slippageBps <= 500,
    "slippage must be at most 500 basis points",
  );
  const budget = input.state.budget,
    carry = id === 18 ? input.state.holderCarryQuote : 0n;
  const identity = Object.freeze({
    chainId: input.source.chainId,
    factory: addr(input.source.factory),
    token: addr(input.source.token),
    vault: addr(input.source.vault),
    executor: addr(input.executor),
    configurationHash: input.configurationHash,
    snapshotBlock: input.source.blockNumber,
    snapshotHash: hash(input.source.blockHash),
    snapshotTimestamp: input.source.timestamp,
  });
  const initial = (
    status: ProProgramPlan["status"],
    reason: string,
  ): ProProgramPlan =>
    Object.freeze({
      status,
      reason,
      moduleId: id,
      programIndex: input.programIndex,
      identity,
      rewards: Object.freeze([]),
    });
  if (budget === 0n && carry === 0n)
    return initial("empty-budget", "No accounted program revenue is available");
  const previous = input.state.lastCycleAt || input.state.waitingSince;
  if (input.now < previous + BigInt(p.intervalSeconds))
    return initial("not-due", "The configured interval is not complete");
  const cycleId = input.state.lastCycle + 1n;
  const deadline = input.now + BigInt(Math.min(config.snapshotMaxAge, 300));
  const actions: ProProgramAction[] = [],
    rewards: ProProgramRewardIntent[] = [],
    dependencies: unknown[] = [];
  let retainedReason = "The program retains its assigned revenue",
    winnerEventId: string | undefined;
  const keep = (reason: string) => {
    retainedReason = reason;
    actions.push(action(ProProgramActionKind.Keep));
  };
  const decimals = (asset: Address): number => {
    if (addr(asset) === addr(input.quoteAsset)) return input.quoteDecimals;
    const item = input.assetDecimals.find(
      (row) => addr(row.asset) === addr(asset),
    );
    need(
      item &&
        Number.isInteger(item.decimals) &&
        item.decimals >= 0 &&
        item.decimals <= 36,
      "verified reward asset precision is missing",
    );
    return item.decimals;
  };
  const population = () =>
    buildProHolderPopulation(input.source, input.balances, {
      kind:
        id === 15
          ? "top-n"
          : id === 20
            ? "shrimp-band"
            : id === 19
              ? "equal"
              : "pro-rata",
      ...(id === 15 || id === 19 ? { moduleId: id } : {}),
      minHolding: p.minHolding,
      ...(id === 15 ? { topN: p.count, weighting: "balance" as const } : {}),
      ...(id === 20
        ? { maxHolding: p.maxHolding, weighting: "equal" as const }
        : {}),
    });
  const priced = async (
    kind: ProProgramActionKind,
    amount: bigint,
    outputAsset: Address,
    extra: Partial<ProProgramAction> = {},
  ) => {
    need(amount > 0n, "zero action cannot be priced");
    if (addr(outputAsset) === addr(input.quoteAsset))
      return {
        action: action(kind, amount, outputAsset, extra),
        expected: amount,
        spent: amount,
      };
    const quote = await input.quote({
      program: p,
      inputAsset: input.quoteAsset,
      outputAsset,
      amountIn: amount,
      deadline,
      blockHash: hash(input.source.blockHash),
    });
    [
      quote.amountIn,
      quote.amountSpent,
      quote.amountOut,
      quote.blockNumber,
      quote.deadline,
    ].forEach(uint);
    need(
      addr(quote.adapter) === addr(p.adapter) &&
        quote.adapterCodeHash === p.adapterCodeHash &&
        addr(quote.inputAsset) === addr(input.quoteAsset) &&
        addr(quote.outputAsset) === addr(outputAsset) &&
        quote.amountIn === amount &&
        quote.amountSpent > 0n &&
        quote.amountSpent <= amount &&
        quote.amountOut > 0n &&
        quote.blockNumber === input.source.blockNumber &&
        quote.blockHash === input.source.blockHash &&
        quote.deadline >= deadline &&
        /^0x(?:[0-9a-fA-F]{2})*$/.test(quote.data),
      "quote does not match the pinned route, block and budget",
    );
    hash(quote.evidence);
    optionalPreimage(quote.evidenceJson, quote.evidence);
    dependencies.push(quote);
    const floor = bps(quote.amountOut, 10_000 - input.slippageBps);
    return {
      action: action(kind, amount, outputAsset, {
        ...extra,
        minOut: floor || 1n,
        data: quote.data,
      }),
      expected: quote.amountOut,
      spent: quote.amountSpent,
    };
  };
  const addBuy = async (
    kind: ProProgramActionKind,
    amount: bigint,
    asset: Address,
  ) => {
    if (amount > 0n) actions.push((await priced(kind, amount, asset)).action);
  };
  const direct = (amount: bigint) => {
    if (amount > 0n)
      actions.push(
        action(ProProgramActionKind.Direct, amount, input.quoteAsset),
      );
  };
  const holder = async (
    amount: bigint,
    asset: Address,
    pop = population(),
    forcePending = false,
  ) => {
    if (amount === 0n) return;
    need(
      pop.members.length > 0,
      "holder allocation has no eligible recipients",
    );
    const pricedAction = await priced(
      ProProgramActionKind.HolderRoot,
      amount,
      asset,
    );
    // Composite fixed shares can resize on a partial Curve fill. Publish using
    // actual funded output; a precommitted tree would strand or overspend credits.
    const pending = forcePending || addr(asset) !== addr(input.quoteAsset);
    const allocation = pending
      ? undefined
      : allocateProHolderRewards(pop, {
          program: BigInt(input.programIndex),
          cycle: cycleId,
          asset,
          assetDecimals: decimals(asset),
          amount,
        });
    actions.push(
      allocation
        ? action(ProProgramActionKind.HolderRoot, amount, asset, {
            root: allocation.root,
          })
        : pricedAction.action,
    );
    rewards.push(
      Object.freeze({
        population: pop,
        asset,
        assetDecimals: decimals(asset),
        expectedAmount: pricedAction.expected,
        publicationRequired: pending,
        ...(allocation ? { allocation } : {}),
      }),
    );
    dependencies.push({
      populationHash: pop.populationHash,
      asset,
      allocationEvidence: allocation?.evidence ?? null,
    });
  };
  const holders = new Set<number>([1, 2, 3, 4, 11, 12, 13, 14, 15, 19, 20]);
  if (holders.has(id)) {
    const pop = population();
    if (pop.members.length === 0)
      keep("No wallet meets the immutable holder rules");
    else await holder(budget, p.asset, pop);
  } else
    switch (id) {
      case 5:
        await addBuy(
          ProProgramActionKind.BuyAndBurn,
          bps(budget, p.burnBps),
          addr(input.source.token),
        );
        direct(budget - bps(budget, p.burnBps));
        break;
      case 6: {
        const book = input.listings;
        need(
          book &&
            book.complete &&
            addr(book.collection) === addr(p.nftCollection) &&
            book.blockHash === input.source.blockHash,
          "complete canonical NFT listings are unavailable",
        );
        hash(book.evidence);
        optionalPreimage(book.evidenceJson, book.evidence);
        const seen = new Set<string>();
        for (const listing of book.items) {
          uint(listing.price);
          uint(listing.tokenId);
          uint(listing.expiresAt);
          hash(listing.orderHash);
          need(
            addr(listing.collection) === addr(p.nftCollection) &&
              !seen.has(listing.orderHash),
            "NFT listing set has mixed collection or duplicate orders",
          );
          seen.add(listing.orderHash);
        }
        const cheapest = [...book.items]
          .filter((row) => row.price > 0n && row.expiresAt >= deadline)
          .sort((a, b) =>
            a.price === b.price
              ? a.orderHash.localeCompare(b.orderHash)
              : a.price < b.price
                ? -1
                : 1,
          )[0];
        dependencies.push({
          listingEvidence: book.evidence,
          cheapest: cheapest?.orderHash ?? null,
        });
        if (!cheapest || cheapest.price > budget)
          keep(
            "The cheapest valid collection listing exceeds the available pot",
          );
        else
          actions.push(
            action(ProProgramActionKind.NftPurchase, budget, p.nftCollection, {
              nftId: cheapest.tokenId,
              data: cheapest.data,
            }),
          );
        break;
      }
      case 7:
      case 17:
        await addBuy(
          addr(p.asset) === addr(input.quoteAsset)
            ? ProProgramActionKind.Direct
            : ProProgramActionKind.SwapAndSend,
          budget,
          p.asset,
        );
        break;
      case 9:
        direct(budget);
        break;
      case 10: {
        // Reduce a common quote allocation until both routes can fill it exactly.
        // Every changed input is independently requoted at the original checkpoint.
        let committed = budget,
          prepared: ProProgramAction[] | undefined;
        for (let attempt = 0; attempt < 8 && committed > 0n; attempt++) {
          const stableAmount = bps(committed, p.holderBps),
            nativeAmount = committed - stableAmount;
          const stable = stableAmount
            ? await priced(
                addr(p.asset) === addr(input.quoteAsset)
                  ? ProProgramActionKind.Direct
                  : ProProgramActionKind.SwapAndSend,
                stableAmount,
                p.asset,
              )
            : undefined;
          const native = nativeAmount
            ? await priced(
                addr(input.quoteAsset) === zeroAddress
                  ? ProProgramActionKind.Direct
                  : ProProgramActionKind.SwapAndSend,
                nativeAmount,
                zeroAddress,
              )
            : undefined;
          if (
            (!stable || stable.spent === stableAmount) &&
            (!native || native.spent === nativeAmount)
          ) {
            prepared = [stable?.action, native?.action].filter(
              (row): row is ProProgramAction => row !== undefined,
            );
            break;
          }
          let smaller = committed;
          if (stable && stable.spent < stableAmount)
            smaller =
              (stable.spent * 10000n + BigInt(p.holderBps) - 1n) /
              BigInt(p.holderBps);
          if (native && native.spent < nativeAmount) {
            const nativeBound =
              (native.spent * 10000n) / BigInt(10000 - p.holderBps);
            if (nativeBound < smaller) smaller = nativeBound;
          }
          need(
            smaller < committed,
            "Treasury partial route did not reduce its common allocation",
          );
          committed = smaller;
        }
        if (prepared) actions.push(...prepared);
        else
          keep(
            "Treasury routes cannot fill the same fixed allocation; fee budget remains reserved",
          );
        break;
      }
      case 18: {
        const burn = bps(budget, p.burnBps),
          share = bps(budget, p.holderBps),
          pop = population();
        await addBuy(
          ProProgramActionKind.BuyAndBurn,
          burn,
          addr(input.source.token),
        );
        if (pop.members.length > 0 && share + carry > 0n)
          await holder(share + carry, zeroAddress, pop, true);
        else if (share > 0n) {
          actions.push(
            action(ProProgramActionKind.HolderCarry, share, input.quoteAsset),
          );
          dependencies.push({ retainedHolderShare: share, priorCarry: carry });
        }
        direct(budget - burn - share);
        break;
      }
      case 8:
      case 16: {
        const pop = population(),
          count = id === 8 ? 1 : p.count;
        const eligible = pop.members.filter(
          (row) => addr(row.account) !== addr(input.source.creator),
        );
        if (eligible.length < count) {
          keep("The funded draw awaits enough distinct eligible wallets");
          break;
        }
        need(
          input.lottery && addr(input.lottery.authority) === addr(p.authority),
          "attested draw seed is unavailable",
        );
        optionalPreimage(
          input.lottery.evidenceJson,
          input.lottery.seedEvidence,
        );
        const draw = drawProContestWinners(pop, {
          ...input.lottery,
          count,
          weighting: "balance",
        });
        dependencies.push({ population: pop, draw });
        actions.push(
          (
            await priced(ProProgramActionKind.ContestPayout, budget, p.asset, {
              beneficiaries: draw.winners,
            })
          ).action,
        );
        break;
      }
      case 21:
      case 22: {
        const trades = input.trades;
        need(trades, "canonical purchase-window observations are unavailable");
        const pop = population();
        const selected = selectProBuyerContest(
          pop,
          trades.buys,
          trades.coverage,
          {
            kind: id === 22 ? "last-buyer" : "biggest-buyer",
            fromTimestamp: trades.windowFrom,
            throughTimestamp: input.source.timestamp,
            requiredSources: trades.requiredSources,
            ...(id === 22 ? { quietSeconds: BigInt(p.intervalSeconds) } : {}),
          },
        );
        dependencies.push({
          buyerEvidence: selected.evidence,
          population: pop,
          trades,
        });
        const winner = selected.winner;
        if (id === 22) {
          const last = [...trades.buys]
            .filter(
              (row) =>
                addr(row.buyer) === winner &&
                row.timestamp >= trades.windowFrom &&
                row.timestamp <= input.source.timestamp,
            )
            .sort((a, b) =>
              a.blockNumber === b.blockNumber
                ? a.logIndex - b.logIndex
                : a.blockNumber < b.blockNumber
                  ? -1
                  : 1,
            )
            .at(-1)!;
          need(
            !trades.consumedLastBuyerIds.includes(last.id),
            "last winning purchase was already paid",
          );
          winnerEventId = last.id;
        }
        actions.push(
          (
            await priced(ProProgramActionKind.ContestPayout, budget, p.asset, {
              beneficiaries: Object.freeze([winner]),
            })
          ).action,
        );
        break;
      }
      case 23:
        await addBuy(
          ProProgramActionKind.BuyAndHold,
          budget,
          addr(input.source.token),
        );
        break;
      case 24:
        await addBuy(ProProgramActionKind.BuyAndBurn, budget, p.asset);
        break;
      case 25: {
        if (budget < 4n) {
          keep("Four positive equal portfolio legs require more revenue");
          break;
        }
        const quoteLegs = async (total: bigint) =>
          Promise.all(
            p.allowedAssets.map((asset, index) =>
              priced(
                addr(asset) === addr(input.quoteAsset)
                  ? ProProgramActionKind.Direct
                  : ProProgramActionKind.SwapAndSend,
                index === 3 ? total - 3n * (total / 4n) : total / 4n,
                asset,
              ),
            ),
          );
        let legs = await quoteLegs(budget);
        if (legs.some((row) => row.spent !== row.action.amount)) {
          const common = legs.reduce(
            (minimum, row) => (row.spent < minimum ? row.spent : minimum),
            budget,
          );
          if (common === 0n) {
            keep(
              "The four approved routes lack a common executable investment",
            );
            break;
          }
          legs = await quoteLegs(common * 4n);
          need(
            legs.every((row) => row.spent === row.action.amount),
            "portfolio routes cannot fill equal quote costs",
          );
        }
        actions.push(...legs.map((row) => row.action));
        break;
      }
      case 26: {
        const salary =
          budget < input.state.salaryAvailable
            ? budget
            : input.state.salaryAvailable;
        need(
          input.state.salaryAvailable <= p.dailySalary,
          "salary observation exceeds immutable daily cap",
        );
        direct(salary);
        await addBuy(
          ProProgramActionKind.BuyAndBurn,
          budget - salary,
          addr(input.source.token),
        );
        break;
      }
      default:
        throw new Error(
          "Pro program execution: catalogue module has no implementation.",
        );
    }
  if (actions.length === 0)
    keep(
      "No positive executable allocation is available; revenue stays reserved",
    );
  need(actions.length <= 8, "action count exceeds Vault bound");
  const evidenceJson = proProgramEvidenceJson({
    domain: "xoox-pro-program-cycle-v4",
    ...identity,
    configuration: config,
    source: input.source,
    balances: [...input.balances].sort((a, b) =>
      addr(a.account).localeCompare(addr(b.account)),
    ),
    quoteAsset: addr(input.quoteAsset),
    quoteDecimals: input.quoteDecimals,
    assetDecimals: input.assetDecimals,
    slippageBps: input.slippageBps,
    plannedAt: input.now,
    programIndex: input.programIndex,
    cycleId,
    state: input.state,
    actions,
    dependencies,
    lottery: input.lottery ?? null,
    listings: input.listings ?? null,
    // Keep this null field so saved ordinary-cycle evidence retains its exact commitment.
    ai: null,
    winnerEventId: winnerEventId ?? null,
  });
  const evidence = keccak256(stringToHex(evidenceJson));
  const cycle = Object.freeze({
    id: cycleId,
    observedAt: input.source.timestamp,
    deadline,
    evidence,
    actions: Object.freeze(actions),
  });
  return Object.freeze({
    status: actions.every((row) => row.kind === ProProgramActionKind.Keep)
      ? "retained"
      : "ready",
    reason: actions.every((row) => row.kind === ProProgramActionKind.Keep)
      ? retainedReason
      : "Immutable program actions are prepared",
    moduleId: id,
    programIndex: input.programIndex,
    identity,
    cycle,
    evidenceJson,
    rewards: Object.freeze(rewards),
    ...(winnerEventId ? { winnerEventId } : {}),
  });
}

/** Only reader-issued source4 launches may enter the production cycle derivation. */
export async function planVerifiedProProgramCycle(
  launch: ProFeeProgramLaunch,
  input: ProProgramExecutionInput,
) {
  assertProFeeProgramLaunch(launch);
  need(
    launch.blockNumber === input.source.blockNumber &&
      launch.blockHash === input.source.blockHash &&
      launch.blockTimestamp === input.source.timestamp &&
      Number(launch.chainId) === input.source.chainId &&
      addr(launch.vault) === addr(input.source.vault) &&
      addr(launch.factory) === addr(input.source.factory) &&
      addr(launch.curve) === addr(input.source.curve) &&
      addr(launch.token) === addr(input.source.token) &&
      addr(launch.creator) === addr(input.source.creator) &&
      addr(launch.quoteAsset) === addr(input.quoteAsset) &&
      launch.configurationHash === input.configurationHash &&
      launch.configurationHash === input.source.configurationHash &&
      launch.registeredToken.programSource?.genesisSupply ===
        input.source.genesisSupply &&
      launch.registeredToken.programSource?.actualSupply ===
        input.source.currentSupply &&
      launch.registeredToken.programSource?.cumulativeBurned ===
        input.source.cumulativeBurned &&
      input.source.tokenDecimals === 18,
    "execution observations differ from the issued canonical launch",
  );
  const observed = launch.activity[input.programIndex];
  need(
    observed &&
      observed.budget === input.state.budget &&
      observed.lastCycle === input.state.lastCycle &&
      observed.lastCycleAt === input.state.lastCycleAt &&
      observed.waitingSince === input.state.waitingSince &&
      observed.holderCarryQuote === input.state.holderCarryQuote &&
      observed.salaryAvailable === input.state.salaryAvailable,
    "budget or cycle state differs from canonical Vault reads",
  );
  const plan = await deriveProProgramCycle({
    ...input,
    configuration: launch.configuration,
  });
  verifiedPlans.add(plan);
  return plan;
}

/** Publish after conversion using the actual canonical receipt, preserving the
 * funded original holder census. Old funded rights do not expire on an outage. */
export function finalizeProProgramReward(
  plan: ProProgramPlan,
  rewardIndex: number,
  input: Readonly<{
    vault: Address;
    programIndex: number;
    cycleId: bigint;
    asset: Address;
    reserved: bigint;
    observedAt: bigint;
    transactionHash: Hex;
    receiptBlockHash: Hex;
    receiptCanonical: boolean;
    root: Hex;
    claimed: bigint;
    now: bigint;
    snapshotMaxAge: number;
  }>,
) {
  const reward = plan.rewards[rewardIndex];
  need(
    plan.cycle && reward && reward.publicationRequired,
    "no pending holder funding belongs to this plan",
  );
  need(
    input.receiptCanonical &&
      input.programIndex === plan.programIndex &&
      addr(input.vault) === addr(reward.population.source.vault) &&
      input.cycleId === plan.cycle.id &&
      input.observedAt === plan.cycle.observedAt &&
      addr(input.asset) === addr(reward.asset) &&
      input.reserved > 0n &&
      input.root === zeroHash &&
      input.claimed === 0n,
    "funding receipt does not match the pending reserved rights",
  );
  hash(input.transactionHash);
  hash(input.receiptBlockHash);
  uint(input.now);
  uint(input.reserved);
  need(
    Number.isInteger(input.snapshotMaxAge) &&
      input.snapshotMaxAge > 0 &&
      input.snapshotMaxAge <= 86_400,
    "publication freshness bound is invalid",
  );
  const allocation = allocateProHolderRewards(reward.population, {
    program: BigInt(input.programIndex),
    cycle: input.cycleId,
    asset: input.asset,
    assetDecimals: reward.assetDecimals,
    amount: input.reserved,
  });
  const evidenceJson = proProgramEvidenceJson({
    domain: "xoox-pro-program-funded-holder-v4",
    cycleEvidence: plan.cycle.evidence,
    allocationEvidence: allocation.evidence,
    transactionHash: input.transactionHash,
    receiptBlockHash: input.receiptBlockHash,
    reserved: input.reserved,
  });
  const evidence = keccak256(stringToHex(evidenceJson));
  return Object.freeze({
    allocation,
    root: allocation.root,
    observedAt: input.observedAt,
    deadline: input.now + BigInt(Math.min(input.snapshotMaxAge, 300)),
    evidence,
    evidenceJson,
  });
}

const verifiedFundedRewards = new WeakSet<object>();
export type ProVerifiedFundedReward = ReturnType<
  typeof finalizeProProgramReward
> &
  Readonly<{
    publicationCheckpoint: Readonly<{
      blockNumber: bigint;
      blockHash: Hex;
      blockTimestamp: bigint;
    }>;
  }>;
export function assertVerifiedProFundedReward(
  value: ProVerifiedFundedReward,
): void {
  need(
    verifiedFundedRewards.has(value),
    "funded reward was not issued from a canonical execution receipt",
  );
}

/** Production publication admission. Plain JSON and a claimed canonicality flag
 * cannot authorize a holder tree. The current accepted launch supplies deadline time;
 * the actual funded receipt supplies the amount and the original census stays fixed. */
export function finalizeVerifiedProProgramReward(
  plan: ProProgramPlan,
  rewardIndex: number,
  receipt: ProFeeProgramCycleReceipt,
  currentLaunch: ProFeeProgramLaunch,
): ProVerifiedFundedReward {
  assertVerifiedProProgramPlan(plan);
  assertProFeeProgramCycleReceipt(receipt);
  assertProFeeProgramLaunch(currentLaunch);
  const identity = plan.identity;
  need(
    plan.cycle &&
      Number(receipt.chainId) === identity.chainId &&
      addr(receipt.vault) === identity.vault &&
      receipt.configurationHash === identity.configurationHash &&
      receipt.programIndex === plan.programIndex &&
      addr(receipt.sender) === identity.executor &&
      encodeFunctionData({
        abi: proFeeProgramLaunchAbi,
        functionName: "execute",
        args: [
          BigInt(plan.programIndex),
          validateProFeeProgramCycle(receipt.cycle),
        ],
      }) ===
        encodeFunctionData({
          abi: proFeeProgramLaunchAbi,
          functionName: "execute",
          args: [
            BigInt(plan.programIndex),
            validateProFeeProgramCycle(plan.cycle!),
          ],
        }) &&
      currentLaunch.chainId === receipt.chainId &&
      addr(currentLaunch.vault) === identity.vault &&
      currentLaunch.configurationHash === identity.configurationHash &&
      currentLaunch.blockNumber >= receipt.blockNumber &&
      currentLaunch.blockTimestamp >= receipt.blockTimestamp,
    "accepted funding and current source differ from the issued plan",
  );
  const reward = plan.rewards[rewardIndex];
  const root = receipt.fundedRoots.find(
    (row) => addr(row.asset) === addr(reward?.asset ?? zeroAddress),
  );
  need(
    root && root.requiresPublication,
    "actual holder reservation has no pending publication",
  );
  const finalized = finalizeProProgramReward(plan, rewardIndex, {
    vault: receipt.vault,
    programIndex: receipt.programIndex,
    cycleId: root.cycleId,
    asset: root.asset,
    reserved: root.reserved,
    observedAt: root.observedAt,
    transactionHash: receipt.transactionHash,
    receiptBlockHash: receipt.blockHash,
    receiptCanonical: true,
    root: root.currentRoot,
    claimed: root.claimed,
    now: currentLaunch.blockTimestamp,
    snapshotMaxAge: currentLaunch.configuration.snapshotMaxAge,
  });
  const issued = Object.freeze({
    ...finalized,
    publicationCheckpoint: Object.freeze({
      blockNumber: currentLaunch.blockNumber,
      blockHash: currentLaunch.blockHash,
      blockTimestamp: currentLaunch.blockTimestamp,
    }),
  });
  verifiedFundedRewards.add(issued);
  return issued;
}
