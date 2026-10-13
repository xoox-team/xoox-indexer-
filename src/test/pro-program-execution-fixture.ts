import {
  encodeFunctionData,
  keccak256,
  stringToHex,
  zeroAddress,
  type Address,
} from "viem";
import { feeProgramReceiptFixture } from "../vendor/xoox-sdk/test/pro-fee-program-receipt-fixture";
import { proFeeProgramLaunchAbi } from "../vendor/xoox-sdk/pro-fee-program-launch";
import { validateProFeeProgramCycle } from "../vendor/xoox-sdk/pro-fee-programs";
import { verifyProFeeProgramCycleReceipt } from "../vendor/xoox-sdk/pro-fee-program-receipts";
import {
  planVerifiedProProgramCycle,
  type ProProgramExecutionInput,
} from "../pro-program-execution";

/** A real reader-issued source/plan/receipt through a synthetic canonical RPC.
 * Runtime hashes are fixture attestations, never deployment approvals. */
export async function verifiedProgramExecutionFixture({
  creator,
  observations = {},
  quoteEvidenceJson,
}: {
  creator?: Address;
  observations?: Pick<
    ProProgramExecutionInput,
    "lottery" | "listings" | "trades"
  >;
  quoteEvidenceJson?: string;
} = {}) {
  const f = await feeProgramReceiptFixture(1, creator);
  const holder = "0x9700000000000000000000000000000000000000" as const;
  const input: ProProgramExecutionInput = {
    configuration: f.launch.configuration,
    configurationHash: f.launch.configurationHash,
    programIndex: 0,
    source: {
      chainId: Number(f.launch.chainId),
      token: f.token,
      factory: f.launch.factory,
      curve: f.curve,
      vault: f.vault,
      creator: f.creator,
      configurationHash: f.launch.configurationHash,
      tokenCodeHash: keccak256("0x60006000"),
      createdBlock: 120n,
      blockNumber: f.launch.blockNumber,
      blockHash: f.launch.blockHash,
      timestamp: f.launch.blockTimestamp,
      tokenDecimals: 18,
      genesisSupply: 1000n,
      cumulativeBurned: 0n,
      currentSupply: 1000n,
      balancesComplete: true,
      balancesFromBlock: 120n,
      balancesThroughBlock: f.launch.blockNumber,
      infrastructure: Object.values(
        f.launch.bootstrapInfrastructure.components,
      ).map((row) => row.address),
    },
    quoteAsset: f.quote,
    quoteDecimals: 18,
    executor: f.creator,
    now: f.launch.blockTimestamp,
    state: { ...f.launch.activity[0] },
    balances: [
      { account: f.curve, balance: 900n },
      { account: holder, balance: 100n },
    ],
    assetDecimals: [{ asset: zeroAddress, decimals: 18 }],
    slippageBps: 300,
    quote: async (request) => ({
      adapter: request.program.adapter,
      adapterCodeHash: request.program.adapterCodeHash,
      inputAsset: request.inputAsset,
      outputAsset: request.outputAsset,
      amountIn: request.amountIn,
      amountSpent: 90n,
      amountOut: 83n,
      blockNumber: f.launch.blockNumber,
      blockHash: f.launch.blockHash,
      deadline: request.deadline,
      data: "0x0102",
      evidence:
        quoteEvidenceJson === undefined
          ? keccak256("0x7788")
          : keccak256(stringToHex(quoteEvidenceJson)),
      ...(quoteEvidenceJson === undefined
        ? {}
        : { evidenceJson: quoteEvidenceJson }),
    }),
    ...observations,
  };
  const plan = await planVerifiedProProgramCycle(f.launch, input);
  if (!plan.cycle || !plan.evidenceJson)
    throw new Error("Fixture plan must have a cycle and public evidence");
  const cycle = validateProFeeProgramCycle(plan.cycle);
  f.transactions.get(f.receiptHash)!.input = encodeFunctionData({
    abi: proFeeProgramLaunchAbi,
    functionName: "execute",
    args: [0n, cycle],
  });
  f.receipt.logs[2] = f.event(
    f.receiptHash,
    124n,
    "CycleExecuted",
    {
      program: 0n,
      cycle: cycle.id,
      evidence: cycle.evidence,
      spent: 90n,
      remaining: 10n,
    },
    2,
  );
  const receipt = await verifyProFeeProgramCycleReceipt(
    f.client,
    f.launch,
    f.receiptHash,
    { programIndex: 0, cycle, sender: f.creator },
  );
  return {
    ...f,
    f,
    input,
    plan,
    receipt,
    currentLaunch: receipt.launch,
    holder,
  };
}
