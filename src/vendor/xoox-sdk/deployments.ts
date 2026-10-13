// Vendored from the XOOX SDK; only what the indexer uses.
import {
  keccak256,
  stringToHex,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { factoryAbi } from "./abi";
import type { Deployment, QuoteAsset } from "./config";
import { admittedDuoDeploymentVariants, admittedDuoRegistryFingerprint } from "./duo-generations";
export * from "./duo-generations";

export function deploymentVariants(active: Deployment): readonly Deployment[] {
  return [active, ...(active.legacyDeployments ?? []), ...admittedDuoDeploymentVariants(active)];
}

export type DeploymentRegistryIdentity = {
  activeFactory: Address;
  factories: readonly Address[];
  fingerprint: Hash;
};

/** Stable public identity for the factories and quote units accepted by a
 * deployment registry. Address case and legacy manifest order do not change it. */
export function deploymentRegistryIdentity(
  active: Deployment,
): DeploymentRegistryIdentity {
  const normalize = (value: Address) => value.toLowerCase() as Address,
    activeFactory = normalize(active.factory),
    legacy = [...(active.legacyDeployments ?? []), ...admittedDuoDeploymentVariants(active)].sort((a, b) =>
      normalize(a.factory).localeCompare(normalize(b.factory)),
    ),
    members = [active, ...legacy].map((deployment) => ({
      factory: normalize(deployment.factory),
      quoteAssets: deployment.quoteAssets
        .map((quote) => ({
          address: normalize(quote.address),
          decimals: quote.decimals,
        }))
        .sort((a, b) => a.address.localeCompare(b.address)),
    })),
    canonical = JSON.stringify({
      chainId: active.chainId,
      activeFactory,
      members,
      ...(active.duoGenerations ? { sourceFingerprint: admittedDuoRegistryFingerprint(active) } : {}),
    });
  return {
    activeFactory,
    factories: members.map(({ factory }) => factory),
    fingerprint: keccak256(stringToHex(canonical)),
  };
}

export function registeredDeployment(
  active: Deployment,
  factory: Address,
): Deployment {
  const source = deploymentVariants(active).find(
    (item) => item.factory.toLowerCase() === factory.toLowerCase(),
  );
  if (!source)
    throw new Error("This deployment is not in the configured registry.");
  return source;
}

export function deploymentQuoteAssets(active: Deployment): QuoteAsset[] {
  const quotes = new Map<string, QuoteAsset>();
  for (const deployment of deploymentVariants(active))
    for (const quote of deployment.quoteAssets)
      if (!quotes.has(quote.address.toLowerCase()))
        quotes.set(quote.address.toLowerCase(), quote);
  return [...quotes.values()];
}

type TokenDeploymentCacheEntry = {
  promise: Promise<Address>;
  settled: boolean;
};
const tokenDeploymentCaches = new WeakMap<
    object,
    Map<string, TokenDeploymentCacheEntry>
  >(),
  TOKEN_DEPLOYMENT_CACHE_LIMIT = 2_048;

function makeTokenDeploymentCacheRoom(
  cache: Map<string, TokenDeploymentCacheEntry>,
): boolean {
  if (cache.size < TOKEN_DEPLOYMENT_CACHE_LIMIT) return true;
  for (const [key, entry] of cache) {
    if (!entry.settled) continue;
    cache.delete(key);
    return true;
  }
  return false;
}

const TOKEN_NOT_IN_DEPLOYMENT = "TOKEN_NOT_IN_DEPLOYMENT";

/** The address is not a launch of any configured factory. Unlike a failed read or an ambiguous
 * registry, asking again cannot change the answer, so callers can tell it apart and stop retrying. */
export class TokenNotInDeploymentError extends Error {
  readonly code = TOKEN_NOT_IN_DEPLOYMENT;
  constructor() {
    super("This token address is not part of a configured deployment.");
    this.name = "TokenNotInDeploymentError";
  }
}

/** The marker is checked, not the class, so a copy of this module still matches. */
export function isTokenNotInDeploymentError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === TOKEN_NOT_IN_DEPLOYMENT
  );
}

export async function resolveTokenDeployment(
  client: PublicClient,
  active: Deployment,
  token: Address,
): Promise<Deployment> {
  let cache = tokenDeploymentCaches.get(client as object);
  if (!cache) {
    cache = new Map();
    tokenDeploymentCaches.set(client as object, cache);
  }
  const key = `${deploymentRegistryIdentity(active).fingerprint}:${token.toLowerCase()}`,
    cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return registeredDeployment(active, await cached.promise);
  }

  const promise = (async (): Promise<Address> => {
      const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
      // Every registry member must respond. An RPC failure is not evidence that
      // a token belongs elsewhere, and multiple claims must never choose a vault.
      const candidates = await Promise.all(
          deploymentVariants(active).map(async (deployment) => {
            const launch = await client.readContract({
              address: deployment.factory,
              abi: factoryAbi,
              functionName: "getLaunch",
              args: [token],
              blockNumber,
            });
            if (typeof launch.exists !== "boolean")
              throw new Error(
                "Factory launch membership could not be verified.",
              );
            return launch.exists ? deployment.factory : undefined;
          }),
        ),
        matches = candidates.filter((factory): factory is Address => !!factory);
      if (matches.length > 1)
        throw new Error(
          "This token has ambiguous ownership across multiple deployment factories.",
        );
      if (!matches[0]) throw new TokenNotInDeploymentError();
      return matches[0];
    })(),
    entry: TokenDeploymentCacheEntry = { promise, settled: false },
    cachedEntry = makeTokenDeploymentCacheRoom(cache);
  if (cachedEntry) cache.set(key, entry);
  promise.then(
    () => {
      entry.settled = true;
    },
    () => {
      if (cachedEntry && cache!.get(key) === entry) cache!.delete(key);
    },
  );
  return registeredDeployment(active, await promise);
}
