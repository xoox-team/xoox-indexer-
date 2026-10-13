import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { writeVerifiedTestnetConfiguration } from "./configuration";
import { verifyIndexerDeployment } from "./deployment-admission";
import { readReviewedProIndexerSources } from "./pro-indexer-sources";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(
  process.argv[2] ?? join(project, "deployments/10143.json"),
);
const outputPath = join(project, "config.testnet.yaml");
const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
const proSources = await readReviewedProIndexerSources(process.argv[3]);

await writeVerifiedTestnetConfiguration(
  manifest,
  outputPath,
  async (deployment) => {
    // Keep the generated Envio config anonymous. A private RPC is used only for
    // this read-only preflight, when MONAD_TESTNET_RPC_URL is set.
    const raw = process.env.MONAD_TESTNET_RPC_URL?.trim() || deployment.rpcUrl;
    const verificationRpc = raw.replace(/^(['"])(.*)\1$/, "$2");
    let url: URL;
    try {
      url = new URL(verificationRpc);
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw new Error("invalid URL");
    } catch {
      throw new Error("Testnet verification RPC must be an HTTPS URL.");
    }
    const intervalMs = verificationRpc === deployment.rpcUrl ? 150 : 40;
    let nextRequestAt = 0;
    const pacedFetch: typeof fetch = async (input, init) => {
      const scheduledAt = Math.max(Date.now(), nextRequestAt);
      nextRequestAt = scheduledAt + intervalMs;
      if (scheduledAt > Date.now())
        await new Promise((done) => setTimeout(done, scheduledAt - Date.now()));
      return fetch(input, init);
    };
    const client = createPublicClient({
      chain: monadTestnet,
      transport: http(url.href, {
        fetchFn: pacedFetch,
        retryCount: 5,
        retryDelay: 500,
        timeout: 120_000,
      }),
    });
    try {
      await verifyIndexerDeployment(client, deployment);
    } catch {
      // viem provider errors can include the credential-bearing URL.
      throw new Error("Monad testnet deployment verification failed.");
    }
  },
  proSources,
);

console.log("Verified chain 10143 and wrote config.testnet.yaml.");
