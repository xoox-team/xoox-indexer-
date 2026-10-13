import {
  admitDuoGenerations,
  primaryDuoDeployment,
} from "./vendor/xoox-sdk/duo-generations";
import { deploymentVariants } from "./vendor/xoox-sdk/deployments";
import { verifyDeployment } from "./vendor/xoox-sdk/preflight";
import type { Deployment } from "./vendor/xoox-sdk/config";
import type { PublicClient } from "viem";

/** Operator-only config admission shares this SDK instance with configuration.ts.
 * The original registry object must retain its private issued source proof until
 * the source union is generated; serialized records and clones cannot replace it. */
export async function verifyIndexerDeployment(
  client: PublicClient,
  deployment: Deployment,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await admitDuoGenerations(client, deployment, signal);
  for (const source of deploymentVariants(deployment)) {
    signal?.throwIfAborted();
    // Historical factory event streams remain indexable when a future-launch
    // alignment expires. Full successor runtime/upstream/wiring admission above
    // remains mandatory; only the existing historical Duo-pair exemption applies.
    await verifyDeployment(client, {
      chainId: source.chainId,
      deployment: { ...primaryDuoDeployment(source), duoPairs: [] },
    });
    signal?.throwIfAborted();
  }
}
