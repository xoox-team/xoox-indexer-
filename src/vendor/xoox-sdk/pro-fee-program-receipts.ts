// Vendored from the XOOX SDK; only what the indexer uses.
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  isAddress,
  zeroAddress,
  zeroHash,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { proBootstrapManifestFromProof } from "./pro-bootstrap";
import {
  proFeeProgramGraduationManifestFromProof,
  readProFeeProgramGraduationInfrastructure,
} from "./pro-fee-program-graduation";
import {
  assertProFeeProgramLaunch,
  proFeeProgramLaunchAbi,
  readProFeeProgramLaunch,
  readProFeeProgramSource,
  type ProFeeProgramLaunch,
} from "./pro-fee-program-launch";
import {
  ProFeeProgramActionKind as Kind,
  validateProFeeProgramCycle,
  type ProFeeProgramConfig,
  type ProFeeProgramCycle,
} from "./pro-fee-programs";

export type ProFeeProgramCycleReceiptExpected = Readonly<{
  programIndex: number;
  cycle: ProFeeProgramCycle;
  sender: Address;
}>;
export type ProFeeProgramHolderRootReceiptExpected = Readonly<{
  programIndex: number;
  cycleId: bigint;
  sender: Address;
  root: Hex;
  observedAt: bigint;
  deadline: bigint;
  evidence: Hex;
}>;
export type ProFeeProgramActionReceipt = Readonly<{
  actionIndex: number;
  kind: Kind;
  asset: Address;
  status: "executed" | "kept" | "skipped" | "carried";
  requestedAmount: bigint;
  approvedAmount: bigint;
  allocationReduction: bigint;
  spent: bigint;
  received: bigint;
  refund: bigint;
}>;
export type ProFeeProgramFundedRootReceipt = Readonly<{
  programIndex: number;
  cycleId: bigint;
  asset: Address;
  /** Root when this execute call reserved funds; zero means two-phase funding. */
  root: Hex;
  /** State at the receipt block, which may include a later publication or claim. */
  currentRoot: Hex;
  reserved: bigint;
  claimed: bigint;
  observedAt: bigint;
  publicationEvidence: Hex;
  requiresPublication: boolean;
}>;
type ReceiptIdentity = Readonly<{
  programSource: 4;
  policyVersion: 1;
  chainId: bigint;
  vault: Address;
  configurationHash: Hex;
  configuration: ProFeeProgramConfig;
  programIndex: number;
  sender: Address;
  transactionHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  launch: ProFeeProgramLaunch;
}>;
export type ProFeeProgramCycleReceipt = ReceiptIdentity &
  Readonly<{
    schema: "xoox.pro-token.fee-program-cycle-receipt";
    cycle: ProFeeProgramCycle;
    /** Includes prior segregated holder quote when it was converted in this cycle. */
    spent: bigint;
    budgetAtExecution: bigint;
    budgetDebited: bigint;
    remainingBudget: bigint;
    maximumApprovedInput: bigint;
    unspentApprovedInput: bigint;
    actions: readonly ProFeeProgramActionReceipt[];
    fundedRoots: readonly ProFeeProgramFundedRootReceipt[];
    carry: Readonly<{
      before: bigint;
      added: bigint;
      consumed: bigint;
      after: bigint;
    }>;
  }>;
export type ProFeeProgramHolderRootReceipt = ReceiptIdentity &
  Readonly<{
    schema: "xoox.pro-token.fee-program-holder-root-receipt";
    cycleId: bigint;
    root: Hex;
    asset: Address;
    reserved: bigint;
    claimed: bigint;
    observedAt: bigint;
    deadline: bigint;
    evidence: Hex;
  }>;
const cycleProofs = new WeakSet<object>(),
  rootProofs = new WeakSet<object>();
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("Pro fee program receipt: " + message + ".");
}
const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
function eq(actual: unknown, expected: unknown, label: string) {
  ensure(same(actual, expected), label + " mismatch");
}
function address(value: unknown, label: string): Address {
  ensure(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      !same(value, zeroAddress),
    label + " must be a nonzero address",
  );
  return getAddress(value);
}
function hash(value: unknown, label: string, nonzero = false): Hex {
  ensure(
    typeof value === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(value) &&
      (!nonzero || !same(value, zeroHash)),
    label + " must be bytes32",
  );
  return value.toLowerCase() as Hex;
}
function uint(value: unknown, label: string, bits = 256): bigint {
  ensure(
    typeof value === "bigint" && value >= 0n && value < 1n << BigInt(bits),
    label + " must be uint" + bits,
  );
  return value;
}
function index(value: unknown, launch: ProFeeProgramLaunch): number {
  ensure(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value < launch.configuration.programs.length,
    "unknown program index",
  );
  return value;
}
export function assertProFeeProgramCycleReceipt(
  value: unknown,
): asserts value is ProFeeProgramCycleReceipt {
  ensure(
    !!value && typeof value === "object" && cycleProofs.has(value),
    "execution proof must come from the canonical cycle receipt verifier",
  );
}
export function assertProFeeProgramHolderRootReceipt(
  value: unknown,
): asserts value is ProFeeProgramHolderRootReceipt {
  ensure(
    !!value && typeof value === "object" && rootProofs.has(value),
    "publication proof must come from the canonical holder root receipt verifier",
  );
}
const eventNames = [
  "CycleExecuted",
  "ActionExecuted",
  "HolderFundsReserved",
  "RewardRootPublished",
  "HolderRootEvidence",
  "HolderShareCarried",
] as const;
type EventName = (typeof eventNames)[number];
type EventRecord = Readonly<{ name: EventName; args: Record<string, unknown> }>;
function events(receipt: TransactionReceipt, vault: Address): EventRecord[] {
  const byTopic = new Map(
    eventNames.map((name) => [
      encodeEventTopics({
        abi: proFeeProgramLaunchAbi,
        eventName: name,
      })[0]!.toLowerCase(),
      name,
    ]),
  );
  let previous = -1;
  const result: EventRecord[] = [];
  for (const log of receipt.logs) {
    ensure(!log.removed, "receipt log was removed");
    eq(log.transactionHash, receipt.transactionHash, "log transaction");
    eq(log.blockHash, receipt.blockHash, "log block");
    eq(log.blockNumber, receipt.blockNumber, "log height");
    eq(log.transactionIndex, receipt.transactionIndex, "log transaction index");
    ensure(
      typeof log.logIndex === "number" &&
        Number.isSafeInteger(log.logIndex) &&
        log.logIndex > previous,
      "receipt logs must have unique increasing indices",
    );
    previous = log.logIndex;
    const name = byTopic.get(log.topics[0]?.toLowerCase() ?? "");
    if (!name) continue;
    eq(log.address, vault, "genuine immutable Vault event emitter");
    const item = getAbiItem({ abi: proFeeProgramLaunchAbi, name }) as AbiEvent;
    const decoded = decodeEventLog({
      abi: [item],
      data: log.data,
      topics: log.topics,
      strict: true,
    }) as { eventName: string; args: Record<string, unknown> };
    eq(decoded.eventName, name, "decoded event name");
    const topics = encodeEventTopics({
      abi: [item],
      eventName: name,
      args: decoded.args,
    } as never);
    ensure(
      log.topics.length === topics.length,
      "noncanonical event topic count",
    );
    topics.forEach((topic, i) =>
      eq(log.topics[i], topic, "canonical event topic"),
    );
    const fields = item.inputs.filter((field) => !field.indexed);
    eq(
      log.data,
      encodeAbiParameters(
        fields,
        fields.map((field) => decoded.args[field.name!]) as never,
      ),
      "canonical event data",
    );
    result.push({ name, args: decoded.args });
  }
  return result;
}
function exactly(
  rows: readonly EventRecord[],
  name: EventName,
  count = 1,
): EventRecord[] {
  const found = rows.filter((row) => row.name === name);
  ensure(
    found.length === count,
    "expected exactly " + count + " " + name + " events",
  );
  return found;
}
async function mined(
  client: PublicClient,
  launch: ProFeeProgramLaunch,
  transactionHash: Hex,
  sender: Address,
  calldata: Hex,
) {
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: transactionHash }),
    client.getTransaction({ hash: transactionHash }),
  ]);
  eq(receipt.status, "success", "successful execution receipt");
  eq(receipt.transactionHash, transactionHash, "receipt transaction");
  eq(transaction.hash, transactionHash, "mined transaction");
  eq(transaction.blockNumber, receipt.blockNumber, "mined transaction height");
  eq(transaction.blockHash, receipt.blockHash, "mined transaction block");
  eq(
    transaction.transactionIndex,
    receipt.transactionIndex,
    "transaction index",
  );
  eq(transaction.from, sender, "expected sender");
  eq(receipt.from, sender, "receipt sender");
  eq(transaction.to, launch.vault, "immutable Vault destination");
  eq(receipt.to, launch.vault, "receipt Vault destination");
  eq(transaction.value, 0n, "nonpayable transaction value");
  eq(transaction.input, calldata, "exact canonical Vault calldata");
  if (transaction.chainId !== undefined)
    eq(BigInt(transaction.chainId), launch.chainId, "transaction chain");
  uint(receipt.blockNumber, "receipt block number");
  hash(receipt.blockHash, "receipt block hash", true);
  const source = await readProFeeProgramSource(
    client,
    launch.factory,
    proBootstrapManifestFromProof(launch.bootstrapInfrastructure),
    {
      chainId: launch.chainId,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    },
  );
  const graduation = launch.graduationInfrastructure
    ? await readProFeeProgramGraduationInfrastructure(
        client,
        source,
        proFeeProgramGraduationManifestFromProof(
          launch.graduationInfrastructure,
        ),
      )
    : undefined;
  const current = await readProFeeProgramLaunch(
    client,
    source,
    launch.token,
    graduation,
  );
  for (const key of [
    "chainId",
    "vault",
    "configurationHash",
    "launchConfigurationHash",
    "factory",
    "router",
    "token",
    "curve",
    "policy",
    "creator",
    "quoteAsset",
  ] as const)
    eq(current[key], launch[key], "immutable launch " + key);
  return { receipt, launch: current, rows: events(receipt, launch.vault) };
}
function identity(
  launch: ProFeeProgramLaunch,
  programIndex: number,
  sender: Address,
  transactionHash: Hex,
): ReceiptIdentity {
  return {
    programSource: 4,
    policyVersion: 1,
    chainId: launch.chainId,
    vault: launch.vault,
    configurationHash: launch.configurationHash,
    configuration: launch.configuration,
    programIndex,
    sender,
    transactionHash,
    blockNumber: launch.blockNumber,
    blockHash: launch.blockHash,
    blockTimestamp: launch.blockTimestamp,
    launch,
  };
}
async function read(
  client: PublicClient,
  launch: ProFeeProgramLaunch,
  name: "rewardRoots" | "holderPublicationEvidence",
  args: readonly unknown[],
) {
  const data = encodeFunctionData({
    abi: proFeeProgramLaunchAbi,
    functionName: name,
    args,
  } as never);
  const raw = (await client.request({
    method: "eth_call",
    params: [
      { to: launch.vault, data },
      { blockHash: launch.blockHash, requireCanonical: true },
    ],
  } as never)) as Hex;
  const result = decodeFunctionResult({
    abi: proFeeProgramLaunchAbi as Abi,
    functionName: name,
    data: raw,
  });
  eq(
    raw,
    encodeFunctionResult({
      abi: proFeeProgramLaunchAbi,
      functionName: name,
      result,
    } as never),
    "canonical " + name + " state",
  );
  return result;
}
async function fundedRoot(
  client: PublicClient,
  launch: ProFeeProgramLaunch,
  programIndex: number,
  cycleId: bigint,
  event: EventRecord,
  root: Hex,
) {
  const [value, evidence] = await Promise.all([
    read(client, launch, "rewardRoots", [BigInt(programIndex), cycleId]),
    read(client, launch, "holderPublicationEvidence", [
      BigInt(programIndex),
      cycleId,
    ]),
  ]);
  ensure(
    Array.isArray(value) && value.length === 5,
    "malformed reward root state",
  );
  const currentRoot = hash(value[0], "current reward root"),
    asset = value[1] as Address,
    reserved = uint(value[2], "actual funded rewards"),
    claimed = uint(value[3], "claimed rewards"),
    observedAt = uint(value[4], "original observation", 64);
  ensure(
    typeof asset === "string" &&
      isAddress(asset, { strict: true }) &&
      reserved > 0n &&
      claimed <= reserved,
    "invalid actual reward reservation",
  );
  eq(asset, event.args.asset, "funded asset");
  eq(reserved, event.args.reserved, "funded amount");
  eq(observedAt, event.args.observedAt, "funded observation");
  if (root !== zeroHash) eq(currentRoot, root, "published state root");
  const publicationEvidence = hash(evidence, "publication evidence");
  ensure(
    currentRoot === zeroHash
      ? publicationEvidence === zeroHash
      : publicationEvidence !== zeroHash,
    "reward publication evidence is inconsistent",
  );
  return Object.freeze({
    programIndex,
    cycleId,
    asset: getAddress(asset),
    root,
    currentRoot,
    reserved,
    claimed,
    observedAt,
    publicationEvidence,
    requiresPublication: currentRoot === zeroHash,
  });
}
async function finish(client: PublicClient, launch: ProFeeProgramLaunch) {
  await readProFeeProgramSource(
    client,
    launch.factory,
    proBootstrapManifestFromProof(launch.bootstrapInfrastructure),
    launch,
  );
}

/** Exact mined Vault execution. The returned amounts are authenticated actual
 * receipts, not the adapter's quote or a service-supplied canonicality boolean. */
export async function verifyProFeeProgramCycleReceipt(
  client: PublicClient,
  launch: ProFeeProgramLaunch,
  transactionHash: Hex,
  expected: ProFeeProgramCycleReceiptExpected,
): Promise<ProFeeProgramCycleReceipt> {
  assertProFeeProgramLaunch(launch);
  const programIndex = index(expected.programIndex, launch),
    cycle = validateProFeeProgramCycle(expected.cycle),
    sender = address(expected.sender, "expected sender"),
    txHash = hash(transactionHash, "transaction hash", true),
    program = launch.configuration.programs[programIndex],
    before = launch.activity[programIndex];
  ensure(
    cycle.id === before.lastCycle + 1n,
    "cycle must follow the issued planning snapshot",
  );
  hash(cycle.evidence, "cycle evidence", true);
  for (const action of cycle.actions) {
    if (action.kind === Kind.Keep) {
      ensure(
        action.amount === 0n &&
          action.outputAsset === zeroAddress &&
          action.minOut === 0n &&
          action.root === zeroHash &&
          action.beneficiaries.length === 0 &&
          action.nftId === 0n &&
          action.data === "0x",
        "Keep must contain only empty action fields",
      );
    } else
      ensure(
        action.amount > 0n,
        "an executed action must approve positive input",
      );
  }
  if (program.authority !== zeroAddress)
    eq(sender, program.authority, "immutable program authority");
  const calldata = encodeFunctionData({
    abi: proFeeProgramLaunchAbi,
    functionName: "execute",
    args: [BigInt(programIndex), cycle],
  });
  const current = await mined(client, launch, txHash, sender, calldata),
    after = current.launch.activity[programIndex];
  ensure(
    cycle.observedAt <= current.launch.blockTimestamp &&
      current.launch.blockTimestamp - cycle.observedAt <=
        BigInt(current.launch.configuration.snapshotMaxAge) &&
      cycle.deadline >= current.launch.blockTimestamp &&
      cycle.deadline <=
        current.launch.blockTimestamp +
          BigInt(current.launch.configuration.snapshotMaxAge),
    "cycle observation or deadline is outside the immutable window",
  );
  eq(after.lastCycle, cycle.id, "canonical executed cycle");
  eq(
    after.lastCycleAt,
    current.launch.blockTimestamp,
    "canonical execution time",
  );
  for (const row of current.rows) {
    eq(row.args.program, BigInt(programIndex), "event program index");
    eq(row.args.cycle, cycle.id, "event cycle");
  }
  const executed = exactly(current.rows, "CycleExecuted")[0];
  eq(executed.args.evidence, cycle.evidence, "cycle evidence");
  ensure(
    current.rows.at(-1) === executed,
    "CycleExecuted must follow all action and funding events",
  );
  const spent = uint(executed.args.spent, "cycle actual input spent"),
    remainingBudget = uint(executed.args.remaining, "cycle remaining budget");
  const holderAction = cycle.actions.find(
      (action) => action.kind === Kind.HolderRoot,
    ),
    priorCarryConsumed =
      holderAction && program.moduleId === 18 ? before.holderCarryQuote : 0n;
  ensure(spent >= priorCarryConsumed, "cycle spend is below consumed carry");
  const budgetDebited = spent - priorCarryConsumed,
    budgetAtExecution = budgetDebited + remainingBudget;
  ensure(
    budgetAtExecution >= before.budget && after.budget >= remainingBudget,
    "canonical budget is inconsistent with retained input",
  );
  const actionEvents = current.rows.filter(
    (row) => row.name === "ActionExecuted" || row.name === "HolderShareCarried",
  );
  const fixed =
    program.moduleId === 5 ||
    program.moduleId === 10 ||
    program.moduleId === 18;
  const treasury = program.moduleId === 10;
  const committed = treasury
    ? cycle.actions.reduce((total, action) => total + action.amount, 0n)
    : budgetAtExecution;
  let treasuryAnchor: (typeof cycle.actions)[number] | undefined;
  if (treasury) {
    ensure(
      committed <= budgetAtExecution,
      "Treasury committed allocation exceeds execution budget",
    );
    const active = cycle.actions.filter((action) => action.kind !== Kind.Keep);
    const stableAmount = (committed * BigInt(program.holderBps)) / 10000n;
    for (const [asset, expectedAmount] of [
      [program.asset, stableAmount],
      [zeroAddress, committed - stableAmount],
    ] as const) {
      const legs = active.filter((action) => same(action.outputAsset, asset));
      ensure(
        legs.length === (expectedAmount > 0n ? 1 : 0),
        "Treasury has a missing or duplicate output leg",
      );
      if (expectedAmount > 0n) {
        eq(legs[0]!.amount, expectedAmount, "Treasury committed output share");
        eq(
          legs[0]!.kind,
          same(asset, launch.quoteAsset) ? Kind.Direct : Kind.SwapAndSend,
          "Treasury output route kind",
        );
      }
    }
    ensure(
      active.length <= 2 &&
        active.every(
          (action) =>
            same(action.outputAsset, program.asset) ||
            action.outputAsset === zeroAddress,
        ),
      "Treasury has a foreign output action",
    );
    treasuryAnchor =
      active.find(
        (action) =>
          action.kind === Kind.SwapAndSend &&
          same(action.outputAsset, program.asset),
      ) ?? active.find((action) => action.kind === Kind.SwapAndSend);
  }
  const anchor = program.moduleId === 10 ? Kind.SwapAndSend : Kind.BuyAndBurn,
    anchorBps = treasury
      ? treasuryAnchor && same(treasuryAnchor.outputAsset, program.asset)
        ? program.holderBps
        : 10000 - program.holderBps
      : program.burnBps;
  const isAnchor = (action: (typeof cycle.actions)[number]) =>
    treasury ? action === treasuryAnchor : action.kind === anchor;
  const order = cycle.actions.map((action, actionIndex) => ({
    action,
    actionIndex,
  }));
  const executionOrder = fixed
    ? [
        ...order.filter(({ action }) => isAnchor(action)),
        ...order.filter(({ action }) => !isAnchor(action)),
      ]
    : order;
  let effective = committed,
    cursor = 0,
    totalSpent = 0n,
    added = 0n,
    consumed = 0n;
  const actions: ProFeeProgramActionReceipt[] = [],
    fundedRoots: ProFeeProgramFundedRootReceipt[] = [];
  for (const { action, actionIndex } of executionOrder) {
    let approvedAmount = action.amount,
      minOut = action.minOut;
    if (
      fixed &&
      !isAnchor(action) &&
      action.kind !== Kind.Keep &&
      effective !== committed
    ) {
      if (treasury) {
        const stable = (effective * BigInt(program.holderBps)) / 10000n;
        approvedAmount = same(action.outputAsset, program.asset)
          ? stable
          : effective - stable;
      } else if (
        action.kind === Kind.HolderRoot ||
        action.kind === Kind.HolderCarry
      ) {
        eq(action.root, zeroHash, "resized holder root must be unpublished");
        approvedAmount = (effective * BigInt(program.holderBps)) / 10000n;
        if (action.kind === Kind.HolderRoot)
          approvedAmount += before.holderCarryQuote;
      } else {
        approvedAmount = effective - (effective * BigInt(anchorBps)) / 10000n;
        if (program.moduleId === 18)
          approvedAmount -= (effective * BigInt(program.holderBps)) / 10000n;
      }
      minOut =
        action.amount === 0n
          ? 0n
          : (action.minOut * approvedAmount + action.amount - 1n) /
            action.amount;
    }
    ensure(
      approvedAmount <= action.amount,
      "effective allocation exceeds the original approval",
    );
    if (action.kind === Kind.Keep || approvedAmount === 0n) {
      actions.push(
        Object.freeze({
          actionIndex,
          kind: action.kind,
          asset: action.outputAsset,
          status: action.kind === Kind.Keep ? "kept" : "skipped",
          requestedAmount: action.amount,
          approvedAmount,
          allocationReduction: action.amount - approvedAmount,
          spent: 0n,
          received: 0n,
          refund: approvedAmount,
        }),
      );
      continue;
    }
    const event = actionEvents[cursor++];
    ensure(event, "missing authenticated action event");
    let actual: bigint, received: bigint;
    if (action.kind === Kind.HolderCarry) {
      ensure(
        program.moduleId === 18 && event.name === "HolderShareCarried",
        "carry event is incompatible with the immutable program",
      );
      actual = uint(event.args.amount, "carried quote");
      eq(actual, approvedAmount, "approved carried share");
      eq(
        event.args.totalCarry,
        before.holderCarryQuote + actual,
        "segregated holder quote total",
      );
      added += actual;
      received = actual;
    } else {
      ensure(
        event.name === "ActionExecuted",
        "missing genuine ActionExecuted event",
      );
      eq(event.args.kind, action.kind, "action wire ID");
      eq(event.args.asset, action.outputAsset, "action output asset");
      ((actual = uint(event.args.spent, "actual action input")),
        (received = uint(event.args.received, "actual action output")));
      ensure(
        actual > 0n && actual <= approvedAmount && received >= minOut,
        "actual spend or output exceeds the committed action bounds",
      );
      if (fixed && !isAnchor(action))
        eq(actual, approvedAmount, "fixed secondary share");
      if (action.kind === Kind.Direct) {
        eq(actual, approvedAmount, "direct share input");
        eq(received, actual, "direct credited output");
        eq(action.outputAsset, launch.quoteAsset, "direct quote asset");
      }
      if (action.kind === Kind.NftPurchase)
        eq(received, 1n, "exact NFT purchase count");
      if (program.moduleId === 25)
        eq(actual, approvedAmount, "equal portfolio input");
      if (action.kind === Kind.HolderRoot) {
        const names =
          action.root === zeroHash
            ? "HolderFundsReserved"
            : "RewardRootPublished";
        const rootEvent = exactly(current.rows, names)[0];
        eq(rootEvent.args.asset, action.outputAsset, "reserved output asset");
        eq(
          rootEvent.args.reserved,
          received,
          "actual reservation matches action receipt",
        );
        ensure(
          current.rows.indexOf(rootEvent) < current.rows.indexOf(event),
          "funded reservation must precede its action receipt",
        );
        eq(
          rootEvent.args.observedAt,
          cycle.observedAt,
          "original funded observation",
        );
        if (action.root !== zeroHash) {
          eq(rootEvent.args.root, action.root, "atomic published root");
          const evidenceEvent = exactly(current.rows, "HolderRootEvidence")[0];
          eq(
            evidenceEvent.args.evidence,
            cycle.evidence,
            "atomic root evidence",
          );
          ensure(
            current.rows.indexOf(rootEvent) <
              current.rows.indexOf(evidenceEvent) &&
              current.rows.indexOf(evidenceEvent) < current.rows.indexOf(event),
            "atomic root evidence must follow publication and precede its action",
          );
        }
        const root = await fundedRoot(
          client,
          current.launch,
          programIndex,
          cycle.id,
          rootEvent,
          action.root,
        );
        fundedRoots.push(root);
        if (action.root !== zeroHash)
          eq(
            root.publicationEvidence,
            cycle.evidence,
            "atomic publication state evidence",
          );
        if (program.moduleId === 18) {
          consumed = before.holderCarryQuote;
          ensure(actual >= consumed, "old holder carry must be fully consumed");
        }
      }
      if (fixed && isAnchor(action) && actual !== approvedAmount) {
        ensure(anchorBps > 0, "partial anchor has no fixed share");
        effective =
          treasury && !same(action.outputAsset, program.asset)
            ? (actual * 10000n) / BigInt(anchorBps)
            : (actual * 10000n + BigInt(anchorBps) - 1n) / BigInt(anchorBps);
      }
    }
    totalSpent += actual;
    actions.push(
      Object.freeze({
        actionIndex,
        kind: action.kind,
        asset: action.outputAsset,
        status: action.kind === Kind.HolderCarry ? "carried" : "executed",
        requestedAmount: action.amount,
        approvedAmount,
        allocationReduction: action.amount - approvedAmount,
        spent: actual,
        received,
        refund: approvedAmount - actual,
      }),
    );
  }
  eq(cursor, actionEvents.length, "exact action event count");
  eq(totalSpent, spent, "sum of authenticated action spending");
  const expectedFunding = fundedRoots.length;
  exactly(
    current.rows,
    "HolderFundsReserved",
    holderAction?.root === zeroHash ? expectedFunding : 0,
  );
  exactly(
    current.rows,
    "RewardRootPublished",
    holderAction && holderAction.root !== zeroHash ? expectedFunding : 0,
  );
  exactly(
    current.rows,
    "HolderRootEvidence",
    holderAction && holderAction.root !== zeroHash ? expectedFunding : 0,
  );
  exactly(
    current.rows,
    "HolderShareCarried",
    cycle.actions.some((action) => action.kind === Kind.HolderCarry) &&
      added > 0n
      ? 1
      : 0,
  );
  eq(consumed, priorCarryConsumed, "exact old carry consumed");
  eq(
    after.holderCarryQuote,
    before.holderCarryQuote + added - consumed,
    "canonical segregated holder quote",
  );
  const maximumApprovedInput = cycle.actions.reduce(
    (sum, action) => sum + action.amount,
    0n,
  );
  const requestedBudget =
    maximumApprovedInput -
    (holderAction && program.moduleId === 18 ? before.holderCarryQuote : 0n);
  ensure(requestedBudget >= 0n, "submitted input omits prior carry");
  if (
    requestedBudget > 0n &&
    program.moduleId !== 10 &&
    program.moduleId !== 25
  )
    eq(budgetAtExecution, requestedBudget, "immutable full-budget allocation");
  ensure(
    spent <= maximumApprovedInput,
    "actual input exceeds submitted approval",
  );
  await finish(client, current.launch);
  const proof: ProFeeProgramCycleReceipt = Object.freeze({
    ...identity(current.launch, programIndex, sender, txHash),
    schema: "xoox.pro-token.fee-program-cycle-receipt",
    cycle,
    spent,
    budgetAtExecution,
    budgetDebited,
    remainingBudget,
    maximumApprovedInput,
    unspentApprovedInput: maximumApprovedInput - spent,
    actions: Object.freeze(
      actions.sort((a, b) => a.actionIndex - b.actionIndex),
    ),
    fundedRoots: Object.freeze(fundedRoots),
    carry: Object.freeze({
      before: before.holderCarryQuote,
      added,
      consumed,
      after: after.holderCarryQuote,
    }),
  });
  cycleProofs.add(proof);
  return proof;
}

/** Authenticates publication of an existing funded reservation. The original
 * observedAt is preserved without applying the snapshot age limit again. */
export async function verifyProFeeProgramHolderRootReceipt(
  client: PublicClient,
  launch: ProFeeProgramLaunch,
  transactionHash: Hex,
  expected: ProFeeProgramHolderRootReceiptExpected,
): Promise<ProFeeProgramHolderRootReceipt> {
  assertProFeeProgramLaunch(launch);
  const programIndex = index(expected.programIndex, launch),
    cycleId = uint(expected.cycleId, "cycle ID", 64),
    sender = address(expected.sender, "sender"),
    root = hash(expected.root, "published root", true),
    observedAt = uint(expected.observedAt, "original observation", 64),
    deadline = uint(expected.deadline, "publication deadline", 64),
    evidence = hash(expected.evidence, "publication evidence", true),
    txHash = hash(transactionHash, "transaction hash", true),
    program = launch.configuration.programs[programIndex];
  ensure(
    cycleId > 0n && program.authority !== zeroAddress,
    "publication requires a funded cycle and immutable authority",
  );
  eq(sender, program.authority, "immutable publication authority");
  const calldata = encodeFunctionData({
    abi: proFeeProgramLaunchAbi,
    functionName: "publishHolderRoot",
    args: [BigInt(programIndex), cycleId, root, observedAt, deadline, evidence],
  });
  const current = await mined(client, launch, txHash, sender, calldata);
  ensure(
    observedAt <= current.launch.blockTimestamp &&
      deadline >= current.launch.blockTimestamp &&
      deadline <=
        current.launch.blockTimestamp +
          BigInt(current.launch.configuration.snapshotMaxAge),
    "publication observation or fresh deadline is invalid",
  );
  ensure(
    current.rows.length === 2,
    "publication must emit only its root and evidence",
  );
  const published = exactly(current.rows, "RewardRootPublished")[0],
    commitment = exactly(current.rows, "HolderRootEvidence")[0];
  ensure(
    current.rows[0] === published && current.rows[1] === commitment,
    "publication evidence must follow its root event",
  );
  for (const row of current.rows) {
    eq(row.args.program, BigInt(programIndex), "publication program");
    eq(row.args.cycle, cycleId, "publication cycle");
  }
  eq(published.args.root, root, "published root");
  eq(published.args.observedAt, observedAt, "preserved funded observation");
  eq(commitment.args.evidence, evidence, "published evidence");
  const state = await fundedRoot(
    client,
    current.launch,
    programIndex,
    cycleId,
    published,
    root,
  );
  eq(state.publicationEvidence, evidence, "canonical publication evidence");
  await finish(client, current.launch);
  const proof: ProFeeProgramHolderRootReceipt = Object.freeze({
    ...identity(current.launch, programIndex, sender, txHash),
    schema: "xoox.pro-token.fee-program-holder-root-receipt",
    cycleId,
    root,
    asset: state.asset,
    reserved: state.reserved,
    claimed: state.claimed,
    observedAt,
    deadline,
    evidence,
  });
  rootProofs.add(proof);
  return proof;
}
