import {
  isAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  assertProFeeProgramLaunch,
  readProFeeProgramHolderClaim,
  type ProFeeProgramLaunch,
} from "./vendor/xoox-sdk/pro-fee-program-launch";
import type {
  ProProgramJob,
  ProProgramAcceptance,
} from "./pro-program-journal-types";

export type ProProgramHistoryJob = Readonly<{
  id: Hex;
  chainId: number;
  token: Address;
  factory: Address;
  vault: Address;
  configurationHash: Hex;
  programIndex: number;
  cycleId: bigint;
  evidence: Hex;
  phase: ProProgramJob["phase"];
  status: ProProgramJob["status"];
  transactionHash: Hex | null;
  acceptance: ProProgramAcceptance | null;
}>;
export type ProProgramHistoryClaim = Readonly<{
  jobId: Hex;
  programIndex: number;
  cycleId: bigint;
  wallet: Address;
  amount: bigint;
  proof: readonly Hex[];
  asset: Address;
  root: Hex;
  reserved: bigint;
  observedAt: bigint;
}>;

export type ProProgramsHistoryResult = Readonly<{
  schema: "xoox.pro-token.fee-program-history";
  version: 4;
  chainId: string;
  token: Address;
  vault: Address;
  configurationHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  incomplete: boolean;
  nextCursor: string | null;
  claims: readonly Readonly<{
    programIndex: number;
    cycleId: string;
    wallet: Address;
    amount: string;
    proof: readonly Hex[];
    asset: Address;
    root: Hex;
    reserved: string;
    observedAt: string;
    receiptBlockHash: Hex;
    consumed: boolean;
    canClaim: boolean;
    paymentStatus: "unconsumed" | "credited" | "paid";
    creditSequence: string;
    payoutAfterClaim: boolean;
    /** Wallet-wide balance and sequence counters for this asset at the result checkpoint. */
    credit: Readonly<{
      balance: string;
      creditedThrough: string;
      paidThrough: string;
      minimumClaim: string;
      decimals: number;
      canPayout: boolean;
    }>;
  }>[];
  history: readonly Readonly<{
    transactionHash: Hex;
    blockNumber: string;
    eventName: string;
    programIndex: number;
    cycleId: string;
    asset?: Address;
    amount?: string;
    evidence: Hex;
  }>[];
  pending: readonly Readonly<{
    id: Hex;
    phase: ProProgramJob["phase"];
    status: ProProgramJob["status"];
    transactionHash?: Hex;
    programIndex: number;
    cycleId: string;
  }>[];
}>;
function ensure(value: unknown, reason: string): asserts value {
  if (!value) throw new Error("Pro program history: " + reason + ".");
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Storage has its own private service identity boundary. This reader additionally
 * rechecks receipt headers and actual funded leaves at the accepted finalized source.
 * A serialized journal row can never become an issued launch or transaction proof. */
export async function readProProgramHistory(
  input: Readonly<{
    client: PublicClient;
    launch: ProFeeProgramLaunch;
    wallet: Address;
    jobs: readonly ProProgramHistoryJob[];
    entitlements: readonly ProProgramHistoryClaim[];
    finalizedBlockNumber: bigint;
    truncated: boolean;
    nextCursor?: string | null;
  }>,
): Promise<ProProgramsHistoryResult> {
  const { launch, client, wallet } = input;
  assertProFeeProgramLaunch(launch);
  ensure(
    isAddress(wallet) &&
      input.jobs.length <= 100 &&
      input.finalizedBlockNumber >= launch.blockNumber,
    "invalid wallet, finalized checkpoint or history bound",
  );
  const initial = await client.getBlock({ blockNumber: launch.blockNumber });
  ensure(initial.hash === launch.blockHash, "current source was reorganized");
  const history: ProProgramsHistoryResult["history"][number][] = [];
  const claims: ProProgramsHistoryResult["claims"][number][] = [];
  const pending: ProProgramsHistoryResult["pending"][number][] = [];
  const claimedIdentities = new Set<string>();
  ensure(
    input.entitlements.length <= 100 &&
      input.entitlements.every(
        (row) =>
          same(row.wallet, wallet) &&
          input.jobs.some(
            (job) => job.id === row.jobId && job.status === "accepted",
          ),
      ),
    "entitlement has no matching accepted job or wallet",
  );
  let incomplete = input.truncated;
  for (const job of input.jobs) {
    ensure(
      job.chainId === Number(launch.chainId) &&
        same(job.token, launch.token) &&
        same(job.factory, launch.factory) &&
        same(job.vault, launch.vault) &&
        job.configurationHash === launch.configurationHash &&
        job.programIndex >= 0 &&
        job.programIndex < launch.configuration.programs.length &&
        /^0x[\da-f]{64}$/.test(job.evidence) &&
        job.evidence !== zeroHash,
      "stored job does not belong to the admitted launch",
    );
    if (job.status !== "accepted") {
      if (job.status !== "rejected")
        pending.push({
          id: job.id,
          phase: job.phase,
          status: job.status,
          ...(job.transactionHash
            ? { transactionHash: job.transactionHash }
            : {}),
          programIndex: job.programIndex,
          cycleId: job.cycleId.toString(),
        });
      continue;
    }
    const receipt = job.acceptance;
    ensure(
      receipt && receipt.transactionHash === job.transactionHash,
      "stored receipt is incomplete",
    );
    if (receipt.blockNumber > input.finalizedBlockNumber) {
      incomplete = true;
      continue;
    }
    const header = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (header.hash !== receipt.blockHash) {
      incomplete = true;
      continue;
    }
    ensure(
      header.timestamp === receipt.blockTimestamp,
      "stored receipt time differs from canonical header",
    );
    history.push({
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString(),
      eventName:
        job.phase === "execute" ? "CycleExecuted" : "RewardRootPublished",
      programIndex: job.programIndex,
      cycleId: job.cycleId.toString(),
      evidence: job.evidence,
      ...(receipt.asset ? { asset: receipt.asset } : {}),
      ...(receipt.reserved !== undefined
        ? { amount: receipt.reserved.toString() }
        : receipt.spent !== undefined
          ? { amount: receipt.spent.toString() }
          : {}),
    });
    for (const row of input.entitlements.filter(
      (row) => row.jobId === job.id,
    )) {
      ensure(
        row.root !== zeroHash &&
          row.reserved > 0n &&
          row.amount > 0n &&
          row.amount <= row.reserved &&
          row.programIndex === job.programIndex &&
          row.cycleId === job.cycleId &&
          same(row.wallet, wallet),
        "stored allocation belongs to another funded cycle or wallet",
      );
      const claimId = `${job.programIndex}:${job.cycleId}:${row.asset.toLowerCase()}`;
      ensure(
        !claimedIdentities.has(claimId),
        "duplicate funded holder entitlement",
      );
      claimedIdentities.add(claimId);
      const actual = await readProFeeProgramHolderClaim(client, launch, {
        programIndex: job.programIndex,
        cycleId: job.cycleId,
        wallet,
        amount: row.amount,
        proof: row.proof,
      });
      ensure(
        actual.root === row.root &&
          actual.reserved === row.reserved &&
          same(actual.asset, row.asset) &&
          actual.observedAt === row.observedAt,
        "published funding differs from the stored allocation",
      );
      // Published proofs remain history after consumption. Only a verified leaf
      // can establish its credit/payment status; canClaim is a separate action gate.
      if (!actual.proofValid || actual.paymentStatus === "unverified") continue;
      claims.push({
        programIndex: job.programIndex,
        cycleId: job.cycleId.toString(),
        wallet,
        amount: row.amount.toString(),
        proof: Object.freeze([...row.proof]),
        asset: actual.asset,
        root: actual.root,
        reserved: actual.reserved.toString(),
        observedAt: actual.observedAt.toString(),
        receiptBlockHash: receipt.blockHash,
        consumed: actual.alreadyClaimed,
        canClaim: actual.canClaim,
        paymentStatus: actual.paymentStatus,
        creditSequence: actual.creditSequence.toString(),
        payoutAfterClaim: actual.payoutAfterClaim,
        credit: Object.freeze({
          balance: actual.credit.balance.toString(),
          creditedThrough: actual.credit.creditedThrough.toString(),
          paidThrough: actual.credit.paidThrough.toString(),
          minimumClaim: actual.credit.minimumClaim.toString(),
          decimals: actual.credit.decimals,
          canPayout: actual.credit.canPayout,
        }),
      });
    }
  }
  const end = await client.getBlock({ blockNumber: launch.blockNumber });
  ensure(
    end.hash === launch.blockHash,
    "finalized source changed during history read",
  );
  return Object.freeze({
    schema: "xoox.pro-token.fee-program-history",
    version: 4,
    chainId: launch.chainId.toString(),
    token: launch.token,
    vault: launch.vault,
    configurationHash: launch.configurationHash,
    blockNumber: launch.blockNumber.toString(),
    blockHash: launch.blockHash,
    incomplete,
    nextCursor: input.nextCursor ?? null,
    claims: Object.freeze(claims.map((row) => Object.freeze(row))),
    history: Object.freeze(history.map((row) => Object.freeze(row))),
    pending: Object.freeze(pending.map((row) => Object.freeze(row))),
  });
}
