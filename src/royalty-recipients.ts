import {
  createPublicClient,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { factoryAbi, royaltySplitterAbi } from "./vendor/xoox-sdk/abi";
import {
  hashLaunchOptions,
  launchOptionsAbi,
  readLaunchOptionsCapability,
} from "./vendor/xoox-sdk/launch-options";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type RoyaltyInput = {
  factory: string;
  router: string;
  token: string;
  quote: string;
  splitter: string;
  blockNumber: bigint;
  blockHash: string;
  buyTaxBps: number;
  sellTaxBps: number;
  minimumHolderBalance: bigint;
  optionsHash: string;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const address = (value: string): Address => {
  if (!isAddress(value, { strict: false }))
    throw new Error("Invalid indexed royalty address.");
  return value as Address;
};

/** Discovery is immutable, but every dependency and read is tied to the event's canonical block. */
export async function readRoyaltyRecipients(
  client: PublicClient,
  input: RoyaltyInput,
) {
  const { blockNumber } = input;
  const canonical = async () => {
    if (!same((await client.getBlock({ blockNumber })).hash, input.blockHash))
      throw new Error("Royalty event block is no longer canonical.");
  };
  await canonical();
  const factory = address(input.factory),
    router = address(input.router),
    token = address(input.token),
    splitter = address(input.splitter);
  if (
    splitter === zeroAddress ||
    !(await readLaunchOptionsCapability(client, factory, router, blockNumber))
  )
    throw new Error("Royalty router is not supported.");
  const [
    registered,
    storedHash,
    policy,
    factoryVault,
    boundToken,
    quote,
    vault,
    version,
    count,
  ] = await Promise.all([
    client.readContract({
      address: router,
      abi: launchOptionsAbi,
      functionName: "royaltySplitter",
      args: [token],
      blockNumber,
    }),
    client.readContract({
      address: router,
      abi: launchOptionsAbi,
      functionName: "launchOptionsHash",
      args: [token],
      blockNumber,
    }),
    client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "feePolicy",
      args: [token],
      blockNumber,
    }),
    client.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "feeVault",
      blockNumber,
    }),
    client.readContract({
      address: splitter,
      abi: royaltySplitterAbi,
      functionName: "token",
      blockNumber,
    }),
    client.readContract({
      address: splitter,
      abi: royaltySplitterAbi,
      functionName: "quoteAsset",
      blockNumber,
    }),
    client.readContract({
      address: splitter,
      abi: royaltySplitterAbi,
      functionName: "feeVault",
      blockNumber,
    }),
    client.readContract({
      address: splitter,
      abi: royaltySplitterAbi,
      functionName: "royaltyVersion",
      blockNumber,
    }),
    client.readContract({
      address: splitter,
      abi: royaltySplitterAbi,
      functionName: "recipientCount",
      blockNumber,
    }),
  ]);
  if (
    !same(registered, splitter) ||
    !same(storedHash, input.optionsHash) ||
    !same(policy.creatorFeeRecipient, splitter) ||
    !same(factoryVault, vault) ||
    !same(boundToken, token) ||
    !same(quote, input.quote) ||
    version !== 1n ||
    count < 2n ||
    count > 8n
  )
    throw new Error("Royalty custody does not match its canonical launch.");
  const recipients = await Promise.all(
    Array.from({ length: Number(count) }, async (_, index) => {
      const account = await client.readContract({
        address: splitter,
        abi: royaltySplitterAbi,
        functionName: "recipients",
        args: [BigInt(index)],
        blockNumber,
      });
      const shareBps = await client.readContract({
        address: splitter,
        abi: royaltySplitterAbi,
        functionName: "shares",
        args: [account],
        blockNumber,
      });
      return { account: account.toLowerCase(), shareBps };
    }),
  );
  if (
    new Set(recipients.map((r) => r.account)).size !== recipients.length ||
    recipients.some((r) => r.account === zeroAddress || r.shareBps <= 0) ||
    recipients.reduce((sum, r) => sum + r.shareBps, 0) !== 10000 ||
    !same(
      hashLaunchOptions({
        buyTaxBps: input.buyTaxBps,
        sellTaxBps: input.sellTaxBps,
        minimumHolderBalance: input.minimumHolderBalance,
        recipients: recipients.map((r) => address(r.account)),
        shares: recipients.map((r) => r.shareBps),
      }),
      input.optionsHash,
    )
  )
    throw new Error("Royalty recipients do not match the launch options.");
  await canonical();
  return recipients;
}

export async function loadRoyaltyRecipients(
  chainId: number,
  input: RoyaltyInput,
) {
  // configure.ts writes JSON syntax in this yaml file. Reuse the configured chain's
  // RPC so local, legacy and production bundles do not require another manifest.
  const config = JSON.parse(
    await readFile(resolve(process.env.ENVIO_CONFIG ?? "config.yaml"), "utf8"),
  ) as {
    chains: { id: number; rpc?: { url: string }[] }[];
  };
  const rpc =
    process.env.INDEXER_CONTRACT_RPC_URL ??
    config.chains.find((c) => c.id === chainId)?.rpc?.[0]?.url;
  if (!rpc)
    throw new Error(
      "Royalty indexing requires a configured archive-capable contract RPC.",
    );
  const client = createPublicClient({
    transport: http(rpc, { timeout: 20_000, retryCount: 2 }),
  });
  if ((await client.getChainId()) !== chainId)
    throw new Error("Royalty contract RPC chain mismatch.");
  return readRoyaltyRecipients(client, input);
}
