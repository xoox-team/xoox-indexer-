// Vendored from the XOOX SDK; only what the indexer uses.
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";

// Kept separate from generated launch ABIs so old factory manifests remain readable.
const holderCapabilityAbi = parseAbi([
  "function HOLDER_DIVIDEND_SHARE_BPS() view returns (uint16)",
  "function holderFeeSharingVersion() view returns (uint256)",
  "function holderFeeMode(address token) view returns (uint8)",
]);
export type HolderFeeCapability = {
  version: 1 | 2;
  baseShareBps: number;
  taxShareBps: number;
};
export type HolderFeeModel = {
  mode: 0 | 1 | 2 | 3 | 4;
  baseShareBps: number;
  taxShareBps: number;
};

export function missingCapability(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return !!error.walk((cause) => {
    if (cause instanceof ContractFunctionZeroDataError) return true;
    // Solidity factories without a fallback revert with no data for unknown selectors.
    // Callers must also verify the expected legacy interface before falling back.
    return (
      cause instanceof ContractFunctionRevertedError &&
      (!cause.raw || cause.raw === "0x") &&
      !cause.data &&
      !cause.signature &&
      (!cause.reason ||
        cause.reason === "execution reverted" ||
        /function selector was not recognized/i.test(cause.reason))
    );
  });
}

export async function readHolderFeeCapability(
  client: PublicClient,
  factory: Address,
  blockNumber?: bigint,
): Promise<HolderFeeCapability> {
  const baseShareBps = Number(
    await client.readContract({
      address: factory,
      abi: holderCapabilityAbi,
      functionName: "HOLDER_DIVIDEND_SHARE_BPS",
      blockNumber,
    }),
  );
  let version: number;
  try {
    version = Number(
      await client.readContract({
        address: factory,
        abi: holderCapabilityAbi,
        functionName: "holderFeeSharingVersion",
        blockNumber,
      }),
    );
  } catch (error) {
    if (baseShareBps === 2000 && missingCapability(error))
      return { version: 1, baseShareBps, taxShareBps: 0 };
    throw error;
  }
  if (version !== 2 || baseShareBps !== 10000)
    throw new Error(
      "Factory holder fee capability is unsupported or inconsistent.",
    );
  return { version: 2, baseShareBps, taxShareBps: 10000 };
}

export async function readTokenHolderFees(
  client: PublicClient,
  factory: Address,
  token: Address,
  policy: {
    dividendVault: Address;
    dividendShareBps: number;
    buybackEnabled?: boolean;
  },
  blockNumber?: bigint,
): Promise<HolderFeeModel> {
  const capability = await readHolderFeeCapability(
    client,
    factory,
    blockNumber,
  );
  const hasVault = policy.dividendVault.toLowerCase() !== zeroAddress;
  const mode =
    capability.version === 2
      ? Number(
          await client.readContract({
            address: factory,
            abi: holderCapabilityAbi,
            functionName: "holderFeeMode",
            args: [token],
            blockNumber,
          }),
        )
      : hasVault
        ? 1
        : 0;
  if (mode === 0 && !hasVault && policy.dividendShareBps === 0)
    return { mode: 0, baseShareBps: 0, taxShareBps: 0 };
  if (mode === 1 && hasVault && policy.dividendShareBps === 2000)
    return { mode: 1, baseShareBps: policy.dividendShareBps, taxShareBps: 0 };
  if (
    mode === 2 &&
    hasVault &&
    policy.dividendShareBps === 10000 &&
    policy.buybackEnabled === false
  )
    return { mode: 2, baseShareBps: 10000, taxShareBps: 10000 };
  throw new Error(
    "Token holder fee mode is unsupported or inconsistent with its policy.",
  );
}

export function holderFeeDescription(model?: HolderFeeModel): string {
  if (!model) return "Reward allocation unavailable";
  if (model.mode === 0) return "Off";
  if (model.mode === 4)
    return "100% OG holders, after protocol fees";
  if (model.mode === 2)
    return "All creator base fees and trading tax, after protocol fees";
  if (model.mode === 3)
    return `${model.baseShareBps / 100}% of fees after the protocol share`;
  return `${model.baseShareBps / 100}% of creator base fees`;
}
