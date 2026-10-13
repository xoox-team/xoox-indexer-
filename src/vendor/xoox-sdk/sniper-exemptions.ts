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
  type Hash,
  type PublicClient,
} from "viem";
import { missingCapability } from "./holder-fees";

export const MAX_SNIPER_EXEMPTIONS = 32;
const reservedExemptionAddresses = [
  "0x0000000000000000000000000000000000000001",
  "0x000000000000000000000000000000000000dead",
];

// Probe separately from generated ABIs to keep legacy deployments readable.
export const launchSniperExemptionsAbi = parseAbi([
  "function supportsLaunchSniperExemptions() pure returns (bool)",
  "event LaunchSniperExemptionsConfigured(address indexed token,address indexed curve,address indexed creator,address[] exemptions)",
]);

/** Additional recipient wallets; the creator is already automatically exempt.
 * Pass known launch contracts and quote tokens as excludedAddresses. */
export function validateSniperExemptions(
  addresses: readonly string[],
  creator?: Address,
  excludedAddresses: readonly Address[] = [],
): Address[] {
  if (addresses.length > MAX_SNIPER_EXEMPTIONS)
    throw new Error(
      `Add at most ${MAX_SNIPER_EXEMPTIONS} sniper exemption wallets.`,
    );
  const excluded = new Set([
    ...reservedExemptionAddresses,
    ...excludedAddresses.map((address) => address.toLowerCase()),
  ]);
  const recipients = addresses.map((address) => {
    if (!isAddress(address, { strict: true }))
      throw new Error(
        "Enter a valid sniper exemption wallet address. Check its spelling and capitalization.",
      );
    if (address.toLowerCase() === zeroAddress)
      throw new Error("A sniper exemption wallet cannot be the zero address.");
    if (creator && address.toLowerCase() === creator.toLowerCase())
      throw new Error("The creator wallet is already exempt from sniper tax.");
    if (excluded.has(address.toLowerCase()))
      throw new Error(
        "This reserved address cannot be a sniper exemption wallet.",
      );
    return getAddress(address);
  });
  if (
    new Set(recipients.map((address) => address.toLowerCase())).size !==
    recipients.length
  )
    throw new Error("Each sniper exemption wallet must be different.");
  return recipients;
}

/** Match the factory commitment without changing any legacy empty-list hash. */
export function hashLaunchSniperEconomics(
  economics: Hash,
  exemptions: readonly Address[],
): Hash {
  if (exemptions.length === 0) return economics;
  return keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32,address[]"), [
      economics,
      exemptions,
    ]),
  );
}

/** Use for the factory and, for routed launches, its launch router as well.
 * Missing selectors mean unsupported; RPC failures never enable the feature. */
export async function readLaunchSniperExemptionsCapability(
  client: PublicClient,
  factoryOrRouter: Address,
  blockNumber?: bigint,
): Promise<boolean> {
  let supported;
  try {
    supported = await client.readContract({
      address: factoryOrRouter,
      abi: launchSniperExemptionsAbi,
      functionName: "supportsLaunchSniperExemptions",
      blockNumber,
    });
  } catch (error) {
    if (missingCapability(error)) return false;
    throw error;
  }
  if (typeof supported !== "boolean")
    throw new Error("Invalid launch sniper exemption capability.");
  return supported;
}
