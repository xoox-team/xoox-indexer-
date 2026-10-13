import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDeployment } from "./vendor/xoox-sdk/config";
import { getContractAddress } from "viem";
import { envioConfiguration } from "./configuration";
import { readReviewedProIndexerSources } from "./pro-indexer-sources";
import { TRADE_DEX_CHAIN_ID, tradeDexSubscriptions } from "./trade-dex-registry";
import { ROUTER } from "./terminal-feed/constants";
const manifest = process.argv[2];
const deployment = manifest
  ? parseDeployment(JSON.parse(await readFile(resolve(manifest), "utf8")))
  : undefined;
if (process.argv[3] !== undefined && !deployment)
  throw new Error(
    "Reviewed Pro source selection requires a deployment manifest.",
  );
const proSources = await readReviewedProIndexerSources(process.argv[3]);
const file = deployment ? "config.yaml" : "config.codegen.yaml";
await writeFile(
  file,
  JSON.stringify(envioConfiguration(deployment, proSources), null, 2) + "\n",
);
if (!deployment) {
  const test = envioConfiguration();
  const chain = test.chains[0];
  chain.skip = false;

  chain.rpc = [
    {
      url: "http://127.0.0.1:1",
      for: "sync",
      initial_block_interval: 500,
      interval_ceiling: 2_000,
      backoff_millis: 1_000,
      query_timeout_millis: 20_000,
      polling_interval: 2_000,
    },
  ];
  // These addresses belong exclusively to simulated unit-test events. Runnable
  // production config is generated only from a validated deployment manifest.
  const fixtureAddresses = {
    Factory: "0x4000000000000000000000000000000000000000",
    FeeVault: "0x5000000000000000000000000000000000000000",
    Hook: "0x6000000000000000000000000000000000000000",
    SwapRouter: "0x7000000000000000000000000000000000000000",
    PoolManager: "0x8000000000000000000000000000000000000000",
    Treasury: "0x9000000000000000000000000000000000000000",
    PaymentRouter: "0xb000000000000000000000000000000000000000",
    LaunchRouter: "0xd000000000000000000000000000000000000000",
    ProFactory: "0xe000000000000000000000000000000000000000",
    ProSwapRouter: "0xf000000000000000000000000000000000000000",
  };
  for (const [name, address] of Object.entries(fixtureAddresses)) {
    const role = chain.contracts.find((contract) => contract.name === name);
    if (!role) throw new Error(`Missing simulated contract role ${name}.`);
    role.address = [address];
  }
  // The consent projection suite uses the synthetic bootstrap fixture in addition
  // to the ordinary Pro Factory fixture. Neither address is a runnable source.
  chain.contracts.find((contract) => contract.name === "ProFactory")!.address.push(
    "0x1000000000000000000000000000000000000000",
  );
  chain.contracts.find(
    (contract) => contract.name === "ProConsentRegistry",
  )!.address = [getContractAddress({
    from: "0x000000000000000000000000000000000000200c",
    nonce: 1n,
  }).toLowerCase()];
  const tradeRoles = tradeDexSubscriptions(TRADE_DEX_CHAIN_ID);
  // The terminal router shares the Trade chain; its handler is registered only
  // where this role is subscribed (src/terminal-feed/configured.ts).
  const subscribed = [
    ...tradeRoles,
    { name: "TerminalRouter", address: [ROUTER] },
  ];
  test.chains.push({
    ...chain,
    id: TRADE_DEX_CHAIN_ID,
    start_block: Math.min(...tradeRoles.map((role) => role.start_block!)),
    // TestIndexer resumes synthetic batches by adjusting the chain start; its
    // current implementation cannot combine that with per-contract starts.
    contracts: chain.contracts.map((role) => ({
      name: role.name,
      address:
        subscribed.find((entry) => entry.name === role.name)?.address ?? [],
    })),
  });
  await writeFile("config.test.yaml", JSON.stringify(test, null, 2) + "\n");
}
console.log(
  deployment
    ? `Generated ${file} for chain ${deployment.chainId} at block ${deployment.startBlock}.`
    : `Generated disabled ${file} for code generation only. Provide a deployment manifest to configure a runnable indexer.`,
);
