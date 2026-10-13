// Vendored from the XOOX SDK; only what the indexer uses.
import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { missingCapability } from "./holder-fees";

export type LaunchOptions = {
  buyTaxBps: number;
  sellTaxBps: number;
  minimumHolderBalance: bigint;
  recipients: Address[];
  shares: number[];
};
export const launchOptionsAbi = parseAbi([
  "function launchOptionsVersion() view returns (uint256)",
  "function factory() view returns (address)",
  "function launchRouter() view returns (address)",
  "function royaltySplitter(address token) view returns (address)",
  "function launchOptionsHash(address token) view returns (bytes32)",
  "function tradingTaxBps(bool isBuy) view returns (uint16)",
  "function minimumHolderBalance() view returns (uint256)",
]);
export function validateLaunchOptions(
  options: LaunchOptions,
  context: {
    supply: bigint;
    creatorBps: number;
    holderBps: number;
    ogHolders: boolean;
  },
): LaunchOptions {
  if (
    [options.buyTaxBps, options.sellTaxBps].some(
      (value) => !Number.isInteger(value) || value < 0 || value > 1000,
    )
  )
    throw new Error("Buy and sell tax must each be between 0% and 10%.");
  if (
    context.supply <= 0n ||
    options.minimumHolderBalance < 0n ||
    options.minimumHolderBalance > context.supply / 100n
  )
    throw new Error(
      "Minimum holder balance must be between 0 and 1% of supply.",
    );
  if (
    options.minimumHolderBalance > 0n &&
    (context.ogHolders || context.holderBps === 0)
  )
    throw new Error("A minimum balance requires standard holder rewards.");
  const { recipients, shares } = options;
  if (
    recipients.length !== shares.length ||
    (recipients.length > 0 &&
      (recipients.length < 2 ||
        recipients.length > 8 ||
        context.creatorBps === 0 ||
        context.ogHolders))
  )
    throw new Error(
      "Split creator income between 2–8 wallets with a creator allocation.",
    );
  const addresses = recipients.map((address) => {
    if (
      !isAddress(address, { strict: true }) ||
      address.toLowerCase() === zeroAddress
    )
      throw new Error("Enter a valid recipient wallet.");
    return getAddress(address);
  });
  if (new Set(addresses.map((a) => a.toLowerCase())).size !== addresses.length)
    throw new Error("Each recipient wallet must be different.");
  if (
    shares.some((s) => !Number.isInteger(s) || s <= 0 || s > 10000) ||
    (shares.length > 0 && shares.reduce((a, b) => a + b, 0) !== 10000)
  )
    throw new Error(
      "Recipient shares must total 100% with a positive share for every wallet.",
    );
  return { ...options, recipients: addresses, shares: [...shares] };
}

export function hashLaunchOptions(options: LaunchOptions) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "(uint16 buyTaxBps, uint16 sellTaxBps, uint256 minimumHolderBalance, address[] recipients, uint16[] shares)",
      ),
      [options],
    ),
  );
}

/** Missing selector is a legacy deployment; RPC failures and mismatched immutable wiring are errors. */
export async function readLaunchOptionsCapability(
  client: PublicClient,
  factory: Address,
  router?: Address,
  blockNumber?: bigint,
): Promise<boolean> {
  if (!router || router === zeroAddress) return false;
  let version;
  try {
    version = await client.readContract({
      address: router,
      abi: launchOptionsAbi,
      functionName: "launchOptionsVersion",
      blockNumber,
    });
  } catch (error) {
    if (missingCapability(error)) return false;
    throw error;
  }
  if (version !== 1n) throw new Error("Unsupported launch options version.");
  const [boundFactory, boundRouter] = await Promise.all([
    client.readContract({
      address: router,
      abi: launchOptionsAbi,
      functionName: "factory",
      blockNumber,
    }),
    client.readContract({
      address: factory,
      abi: launchOptionsAbi,
      functionName: "launchRouter",
      blockNumber,
    }),
  ]);
  if (
    boundFactory.toLowerCase() !== factory.toLowerCase() ||
    boundRouter.toLowerCase() !== router.toLowerCase()
  )
    throw new Error("Launch options router does not match this factory.");
  return true;
}

export async function readDirectionalTaxes(
  client: PublicClient,
  curve: Address,
  legacyTaxBps: number,
  blockNumber?: bigint,
) {
  try {
    const [buy, sell] = await Promise.all(
      [true, false].map((isBuy) =>
        client.readContract({
          address: curve,
          abi: launchOptionsAbi,
          functionName: "tradingTaxBps",
          args: [isBuy],
          blockNumber,
        }),
      ),
    );
    if (
      !Number.isInteger(buy) ||
      !Number.isInteger(sell) ||
      buy < 0 ||
      sell < 0 ||
      buy > legacyTaxBps ||
      sell > legacyTaxBps
    )
      throw new Error("Invalid directional trading fees.");
    return { buyTaxBps: buy, sellTaxBps: sell };
  } catch (error) {
    if (missingCapability(error))
      return { buyTaxBps: legacyTaxBps, sellTaxBps: legacyTaxBps };
    throw error;
  }
}
