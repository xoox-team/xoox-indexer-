import type { Address, Hex } from "viem";
import type { ProFeeProgramCycleReceipt } from "./vendor/xoox-sdk/pro-fee-program-receipts";
import type {
  ProProgramPlan,
  ProVerifiedFundedReward,
} from "./pro-program-execution";

/**
 * The journal record types that pro-program-history.ts reports on. They are the declarations of ProProgramJobStatus,
 * ProProgramTransactionTemplate, ProProgramAcceptance and ProProgramJob from scripts/pro/fee-program-journal.ts of the
 * XOOX application repository, copied verbatim (that journal, a SQLite writer, is not part of this repository). They are
 * types only: nothing here exists at runtime.
 */
export type ProProgramJobStatus =
  | "prepared"
  | "signing"
  | "signed"
  | "submitted"
  | "uncertain"
  | "accepted"
  | "rejected"
  | "reorged";
export type ProProgramTransactionTemplate = Readonly<{
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}>;
export type ProProgramAcceptance = Readonly<{
  transactionHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  spent?: bigint;
  remainingBudget?: bigint;
  actions?: ProFeeProgramCycleReceipt["actions"];
  fundedRoots?: ProFeeProgramCycleReceipt["fundedRoots"];
  root?: Hex;
  asset?: Address;
  reserved?: bigint;
  claimed?: bigint;
  observedAt?: bigint;
}>;
export type ProProgramJob = Readonly<{
  id: Hex;
  serviceHash: Hex;
  chainId: number;
  executor: Address;
  phase: "execute" | "holder-root";
  status: ProProgramJobStatus;
  parentId: Hex | null;
  plan: ProProgramPlan;
  publication: ProVerifiedFundedReward | null;
  transaction: ProProgramTransactionTemplate | null;
  signed: Readonly<{ raw: Hex; hash: Hex }> | null;
  acceptance: ProProgramAcceptance | null;
  createdAt: bigint;
  updatedAt: bigint;
  reason: string | null;
}>;
