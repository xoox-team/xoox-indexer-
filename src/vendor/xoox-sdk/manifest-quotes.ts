// Vendored from the XOOX SDK; only what the indexer uses.
import { parseAbi, zeroAddress, type PublicClient } from "viem";
import type { Deployment, QuoteAsset } from "./config";
import { loadLaunchEvents } from "./events";

const terms = parseAbi([
  "function approvedPairTokens(address) view returns (bool)",
  "function pairTokenEconomics(address) view returns (uint256,uint256,uint8)",
]);
const erc20Metadata = parseAbi(["function decimals() view returns (uint8)"]);

export type ManifestQuoteEvidence = QuoteAsset & {
  approved: boolean;
  onchainDecimals: number;
  phantomQuote?: string;
  graduationThreshold?: string;
};

/** Validate and record quote entries against one fixed chain state. */
export async function readManifestQuotes(
  client: PublicClient,
  manifest: Deployment,
  blockNumber: bigint,
): Promise<ManifestQuoteEvidence[]> {
  let historicalQuotes: Set<string> | undefined;
  const evidence: ManifestQuoteEvidence[] = [];
  for (const quote of manifest.quoteAssets) {
    const approved = await client.readContract({
      address: manifest.factory,
      abi: terms,
      functionName: "approvedPairTokens",
      args: [quote.address],
      blockNumber,
    });
    if (!approved) {
      // A revoked quote remains meaningful for existing launches. Only canonical
      // factory events up to the same validation block may establish that history.
      if (!historicalQuotes) {
        const launches = await loadLaunchEvents(client, manifest, {
          toBlock: blockNumber,
          chunkSize: 2_000n,
        });
        historicalQuotes = new Set(
          launches.map((launch) => launch.quoteAsset.toLowerCase()),
        );
      }
      if (!historicalQuotes.has(quote.address.toLowerCase()))
        throw new Error(`Unapproved quote asset: ${quote.symbol}`);
    }
    if (quote.address !== zeroAddress) {
      const [[phantom, threshold, registryDecimals], tokenDecimals] =
        await Promise.all([
          client.readContract({
            address: manifest.factory,
            abi: terms,
            functionName: "pairTokenEconomics",
            args: [quote.address],
            blockNumber,
          }),
          client.readContract({
            address: quote.address,
            abi: erc20Metadata,
            functionName: "decimals",
            blockNumber,
          }),
        ]);
      if (
        registryDecimals !== quote.decimals ||
        tokenDecimals !== quote.decimals
      )
        throw new Error(`Quote decimals mismatch: ${quote.symbol}`);
      if (approved && (phantom === 0n || threshold === 0n))
        throw new Error(`Quote economics mismatch: ${quote.symbol}`);
      evidence.push({
        ...quote,
        approved,
        onchainDecimals: tokenDecimals,
        phantomQuote: phantom.toString(),
        graduationThreshold: threshold.toString(),
      });
    } else if (quote.decimals !== manifest.nativeCurrency.decimals) {
      throw new Error(`Quote decimals mismatch: ${quote.symbol}`);
    } else
      evidence.push({
        ...quote,
        approved,
        onchainDecimals: manifest.nativeCurrency.decimals,
      });
  }
  return evidence;
}

/** Preserve the publisher's validation-only API for callers that do not need evidence. */
export async function validateManifestQuotes(
  client: PublicClient,
  manifest: Deployment,
  blockNumber: bigint,
): Promise<void> {
  await readManifestQuotes(client, manifest, blockNumber);
}
