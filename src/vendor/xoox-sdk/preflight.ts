// Vendored from the XOOX SDK; only what the indexer uses.
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { parseDeployment, type Deployment, type LiquidityWarningEvidence } from "./config";
import { assertMonadPaymentDependencies, monadV4 } from "./networks";
import {
  deploymentContractAddresses,
  verifyDeploymentWiring,
  type DeploymentRelationship,
  type DeploymentSecurityEvidence,
} from "./deployment-wiring";
import {
  readManifestQuotes,
  type ManifestQuoteEvidence,
} from "./manifest-quotes";
import {
  readApprovedDuoRoutes,
  readDuoAlignmentAttestation,
  readDuoAlignmentForMaintenance,
  duoAbi,
  type ApprovedDuoRoute,
} from "./duo";
import { quotePaymentConversion, type PaymentHop } from "./payment-routing";
export type ContractEvidence = {
  role: string;
  address: Address;
  codeHash: Hash;
  codeBytes: number;
};
export type LiquidityPositionEvidence = {
  role: "primary" | "secondary" | "supplemental";
  positionId: string;
  poolId: Hash;
  owner: Address;
  approved: Address;
  liquidity: string;
  tickLower?: number;
  tickUpper?: number;
  startingTick?: number;
  effectiveQuoteTick?: number;
};
export type LiquidityPoolEvidence = {
  role: "primary" | "secondary";
  poolId: Hash;
};
type LiquidityCanaryEvidenceBase = {
  kind: "single" | "duo";
  token: Address;
  quoteAsset: Address;
  launch: {
    curve: Address;
    phase: 2;
  };
  secondaryQuote?: Address;
  routeHash?: Hash;
  checkedAt: string;
  pools: LiquidityPoolEvidence[];
  positions: LiquidityPositionEvidence[];
  alignmentHash?: Hash;
  primaryStartingTick?: number;
  secondaryStartingTick?: number;
  crossRateDeviationBps?: number;
};
export type FomoLiquidityCanaryEvidence = LiquidityCanaryEvidenceBase & {
  provider: "fomo.family";
  url: string;
  warnings: LiquidityWarningEvidence;
};
export type TestnetLiquidityCanaryEvidence = LiquidityCanaryEvidenceBase & {
  provider: "monad-testnet-onchain";
  url?: never;
  warnings?: never;
};
export type LiquidityCanaryEvidence =
  | FomoLiquidityCanaryEvidence
  | TestnetLiquidityCanaryEvidence;
export type DuoRouteEvidence = {
  primaryQuote: Address;
  secondaryQuote: Address;
  routeHash: Hash;
  pairRouteHash: Hash;
  approved: true;
  routeRegistryVersion: "2";
  routeRevision: string;
  hops: PaymentHop[];
  quotedInput: string;
  quotedOutput: string;
  blockNumber: string;
  alignments: DuoAlignmentEvidence[];
};
export type DuoAlignmentEvidence = {
  configId: string;
  attestationHash: Hash;
  routeHash: Hash;
  routeRevision: string;
  primaryEconomicsHash: Hash;
  secondaryEconomicsHash: Hash;
  primaryPhantom: string;
  secondaryPhantom: string;
  observedPrimaryOut: string;
  quotedPrimaryOut: string;
  observedBlock: string;
  validUntil: string;
  maxDeviationBps: number;
  deviationBps: string;
};
export type PreflightReport = {
  version: 1;
  chainId: number;
  blockNumber: string;
  blockHash: Hash;
  blockTimestamp: string;
  checkedAt: string;
  contracts: ContractEvidence[];
  relationships: DeploymentRelationship[];
  security?: DeploymentSecurityEvidence;
  liquidityCanaries?: LiquidityCanaryEvidence[];
  duoRoutes?: DuoRouteEvidence[];
  osakaClz?: {
    opcode: string;
    initcode: string;
    result: string;
    expected: string;
    method: "eth_call creation";
  };
  quotes: ManifestQuoteEvidence[];
  scope: "dependencies" | "deployment";
  sources: string[];
};

function routeKey(primaryQuote: Address, secondaryQuote: Address): string {
  return `${primaryQuote.toLowerCase()}:${secondaryQuote.toLowerCase()}`;
}

/** Every published Duo pair must resolve to its exact governance-approved
 * secondary-to-primary route and produce a nonzero live quote at the same
 * evidence block. */
export async function verifyDuoRouteCatalog(
  client: PublicClient,
  deployment: Deployment,
  blockNumber: bigint,
): Promise<DuoRouteEvidence[]> {
  return verifyDuoRoutes(client, deployment, blockNumber, true);
}

/** This evidence checks existing-launch integrity, not future Duo admission. */
export async function verifyMaintenanceDuoRouteCatalog(
  client: PublicClient, deployment: Deployment, blockNumber: bigint,
): Promise<DuoRouteEvidence[]> {
  return verifyDuoRoutes(client, deployment, blockNumber, false);
}

async function verifyDuoRoutes(
  client: PublicClient, deployment: Deployment, blockNumber: bigint,
  requireFreshness: boolean,
): Promise<DuoRouteEvidence[]> {
  const pairs = deployment.duoPairs ?? [];
  if (!pairs.length) {
    if (
      deployment.environment === "configured" &&
      deployment.duoExecutor &&
      deployment.security?.permissionless !== false
    )
      throw new Error(
        "Configured Duo requires governance-approved, quoteable pair routes.",
      );
    return [];
  }
  if (!deployment.duoExecutor || !deployment.payments)
    throw new Error("Duo route dependencies are not configured.");
  const configCount = await client.readContract({
    address: deployment.factory,
    abi: duoAbi,
    functionName: "configCount",
    blockNumber,
  });
  if (configCount === 0n || configCount > 64n)
    throw new Error(
      "Published Duo requires a bounded enabled launch configuration catalog.",
    );
  const configs = await Promise.all(
    Array.from({ length: Number(configCount) }, (_, configId) =>
      client.readContract({
        address: deployment.factory,
        abi: duoAbi,
        functionName: "getConfig",
        args: [BigInt(configId)],
        blockNumber,
      }),
    ),
  );
  const enabledConfigIds = configs.flatMap((config, configId) =>
    config.enabled ? [BigInt(configId)] : [],
  );
  if (!enabledConfigIds.length)
    throw new Error("Published Duo has no enabled launch configuration.");
  const routes = new Map<string, ApprovedDuoRoute>();
  const primaries = [
    ...new Map(
      pairs.map((pair) => [pair.primaryQuote.toLowerCase(), pair.primaryQuote]),
    ).values(),
  ];
  for (const primary of primaries)
    for (const route of await readApprovedDuoRoutes(
      client,
      deployment,
      primary,
      blockNumber,
    ))
      routes.set(routeKey(route.primaryQuote, route.secondaryQuote), route);

  const evidence: DuoRouteEvidence[] = [];
  for (const pair of pairs) {
    const route = routes.get(routeKey(pair.primaryQuote, pair.secondaryQuote));
    if (!route)
      throw new Error(
        "Every Duo pair must have a governance-approved and quoteable normalization route.",
      );
    const secondary = deployment.quoteAssets.find(
      (quote) =>
        quote.address.toLowerCase() === pair.secondaryQuote.toLowerCase(),
    );
    if (!secondary)
      throw new Error(
        "Duo route secondary quote is missing from the manifest.",
      );
    const quotedInput = 10n ** BigInt(secondary.decimals);
    const quotedOutput = await quotePaymentConversion(
      client,
      deployment.payments,
      route.hops,
      quotedInput,
      blockNumber,
    );
    if (quotedOutput <= 0n)
      throw new Error("Duo normalization route has no live quoteable output.");
    const alignments = await Promise.all(
      enabledConfigIds.map((configId) =>
        (requireFreshness ? readDuoAlignmentAttestation : readDuoAlignmentForMaintenance)(
          client,
          deployment,
          route,
          configId,
          blockNumber,
        ),
      ),
    );
    evidence.push({
      primaryQuote: route.primaryQuote,
      secondaryQuote: route.secondaryQuote,
      routeHash: route.routeHash,
      pairRouteHash: route.routeHash,
      approved: true,
      routeRegistryVersion: "2",
      routeRevision: route.routeRevision.toString(),
      hops: route.hops,
      quotedInput: quotedInput.toString(),
      quotedOutput: quotedOutput.toString(),
      blockNumber: blockNumber.toString(),
      alignments: alignments.map((alignment) => ({
        configId: alignment.configId.toString(),
        attestationHash: alignment.attestationHash,
        routeHash: alignment.routeHash,
        routeRevision: alignment.routeRevision.toString(),
        primaryEconomicsHash: alignment.primaryEconomicsHash,
        secondaryEconomicsHash: alignment.secondaryEconomicsHash,
        primaryPhantom: alignment.primaryPhantom.toString(),
        secondaryPhantom: alignment.secondaryPhantom.toString(),
        observedPrimaryOut: alignment.observedPrimaryOut.toString(),
        quotedPrimaryOut: alignment.quotedPrimaryOut.toString(),
        observedBlock: alignment.observedBlock.toString(),
        validUntil: alignment.validUntil.toString(),
        maxDeviationBps: alignment.maxDeviationBps,
        deviationBps: alignment.deviationBps.toString(),
      })),
    });
  }
  return evidence;
}
const relationAbi = parseAbi([
  "function poolManager() view returns(address)",
  "function permit2() view returns(address)",
]);
const factoryPositionAbi = parseAbi([
  "function getLaunch(address token) view returns ((address token,address curve,address creator,address quoteAsset,uint256 configId,uint256 graduationThreshold,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,uint8 phase,bool exists))",
  "function duoConfig(address token) view returns ((bool enabled,address secondaryQuote))",
  "function positionIds(address token) view returns(uint256)",
  "function duoPositionIds(address token) view returns(uint256)",
  "function poolIds(address token) view returns(bytes32)",
  "function duoPoolIds(address token) view returns(bytes32)",
]);
const lockerPositionAbi = parseAbi([
  "function lockedPositions(address token) view returns(uint256)",
  "function secondaryLockedPositions(address token) view returns(uint256)",
  "function lockedPositionCount(address token) view returns(uint256)",
  "function lockedPositionAt(address token,uint256 index) view returns(uint256)",
  "function positionToken(uint256 tokenId) view returns(address)",
  "function isLocked(address token) view returns(bool)",
  "function isPositionLocked(uint256 tokenId) view returns(bool)",
]);
const positionSafetyAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns(address)",
  "function getApproved(uint256 tokenId) view returns(address)",
  "function getPositionLiquidity(uint256 tokenId) view returns(uint128)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint256 info)",
]);
const permanentPositionOwner = getAddress(
  "0x000000000000000000000000000000000000dEaD",
);

function v4PoolId(key: {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}): Hash {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address,address,uint24,int24,address"),
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

function signed24(value: bigint): number {
  const raw = Number(value & 0xffffffn);
  return raw >= 0x800000 ? raw - 0x1000000 : raw;
}

function positionTicks(info: bigint): { lower: number; upper: number } {
  return {
    lower: signed24(info >> 8n),
    upper: signed24(info >> 32n),
  };
}

/** External listings cannot exist for a private loopback fixture. The caller
 * verifies the RPC chain identity before reaching this exception. */
function isLocalLiquidityFixture(deployment: Deployment): boolean {
  if (deployment.environment !== "local" || deployment.chainId !== 31337)
    return false;
  try {
    const rpc = new URL(deployment.rpcUrl);
    return (
      ["http:", "https:"].includes(rpc.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(rpc.hostname) &&
      !rpc.username &&
      !rpc.password
    );
  } catch {
    return false;
  }
}

async function verifyLiquidityCanaries(
  client: PublicClient,
  deployment: Deployment,
  blockNumber: bigint,
  blockTimestamp: bigint,
  quotes: readonly ManifestQuoteEvidence[],
  duoRoutes: readonly DuoRouteEvidence[],
  requireActivationFreshness: boolean,
): Promise<LiquidityCanaryEvidence[] | undefined> {
  const acceptance =
    deployment.chainId === 10143
      ? deployment.testnetLiquidityAcceptance
      : deployment.liquidityAcceptance;
  if (deployment.chainId === 10143 && deployment.liquidityAcceptance)
    throw new Error(
      "Fomo liquidity acceptance is supported only on Monad mainnet 143.",
    );
  if (deployment.chainId !== 10143 && deployment.testnetLiquidityAcceptance)
    throw new Error(
      "Testnet liquidity acceptance requires Monad testnet 10143.",
    );
  // Supplied acceptance is still verified, even for local fixtures. Never
  // manufacture external-provider evidence to make a local deployment pass.
  if (!acceptance && isLocalLiquidityFixture(deployment)) return undefined;
  const duoPairs = deployment.duoPairs ?? [];
  const requiresDuoAcceptance =
    deployment.environment === "configured" &&
    duoPairs.length > 0 &&
    !(
      deployment.chainId === 10143 &&
      deployment.security?.permissionless === false
    );
  if (!acceptance && requiresDuoAcceptance)
    throw new Error(
      "Every published Duo pair requires its own current route-bound V4 liquidity canary.",
    );
  if (!deployment.security?.permissionless && !acceptance) return undefined;
  if (!acceptance || !deployment.locker)
    throw new Error(
      "Public launches require reviewed dead-owned V4 liquidity acceptance evidence.",
    );
  if (
    (deployment.chainId === 10143) !==
    (acceptance.provider === "monad-testnet-onchain")
  )
    throw new Error(
      "Liquidity acceptance provider does not match the manifest chain.",
    );
  const checkedAt = BigInt(
    Math.floor(new Date(acceptance.checkedAt).getTime() / 1_000),
  );
  if (
    checkedAt > blockTimestamp + 5n * 60n ||
    (requireActivationFreshness && blockTimestamp - checkedAt > 24n * 60n * 60n)
  )
    throw new Error(
      "Liquidity acceptance must be observed within 24 hours of public activation.",
    );
  if (
    new Set(acceptance.canaries.map((canary) => canary.token.toLowerCase()))
      .size !== acceptance.canaries.length
  )
    throw new Error("Liquidity acceptance contains duplicate canary tokens.");
  const routeEvidence = new Map(
    duoRoutes.map((route) => [
      routeKey(route.primaryQuote, route.secondaryQuote),
      route,
    ]),
  );
  if (deployment.security?.permissionless) {
    for (const quote of quotes.filter((quote) => quote.approved))
      if (
        !acceptance.canaries.some(
          (canary) =>
            canary.kind === "single" &&
            canary.quoteAsset.toLowerCase() === quote.address.toLowerCase(),
        )
      )
        throw new Error(
          `Approved quote ${quote.symbol} requires its own Single V4 liquidity canary.`,
        );
  }
  if (deployment.environment === "configured")
    for (const pair of duoPairs) {
      const route = routeEvidence.get(
        routeKey(pair.primaryQuote, pair.secondaryQuote),
      );
      const canary = acceptance.canaries.find(
        (candidate) =>
          candidate.kind === "duo" &&
          candidate.quoteAsset.toLowerCase() ===
            pair.primaryQuote.toLowerCase() &&
          candidate.secondaryQuote.toLowerCase() ===
            pair.secondaryQuote.toLowerCase(),
      );
      if (
        !route ||
        !canary ||
        canary.kind !== "duo" ||
        canary.routeHash.toLowerCase() !== route.routeHash.toLowerCase()
      )
        throw new Error(
          "Every published Duo pair requires its own current route-bound V4 liquidity canary.",
        );
    }
  const verified: LiquidityCanaryEvidence[] = [];
  for (const canary of acceptance.canaries) {
    let canaryAlignment: DuoAlignmentEvidence | undefined;
    if (
      !deployment.quoteAssets.some(
        (quote) =>
          quote.address.toLowerCase() === canary.quoteAsset.toLowerCase(),
      )
    )
      throw new Error(
        `Canary ${canary.token} references a quote outside this deployment.`,
      );
    const [launch, onchainDuo, primary, secondary, primaryPool, secondaryPool] =
      await Promise.all([
        client.readContract({
          address: deployment.factory,
          abi: factoryPositionAbi,
          functionName: "getLaunch",
          args: [canary.token],
          blockNumber,
        }),
        client.readContract({
          address: deployment.factory,
          abi: factoryPositionAbi,
          functionName: "duoConfig",
          args: [canary.token],
          blockNumber,
        }),
        client.readContract({
          address: deployment.factory,
          abi: factoryPositionAbi,
          functionName: "positionIds",
          args: [canary.token],
          blockNumber,
        }),
        client.readContract({
          address: deployment.factory,
          abi: factoryPositionAbi,
          functionName: "duoPositionIds",
          args: [canary.token],
          blockNumber,
        }),
        client.readContract({
          address: deployment.factory,
          abi: factoryPositionAbi,
          functionName: "poolIds",
          args: [canary.token],
          blockNumber,
        }),
        client.readContract({
          address: deployment.factory,
          abi: factoryPositionAbi,
          functionName: "duoPoolIds",
          args: [canary.token],
          blockNumber,
        }),
      ]);
    if (
      !launch.exists ||
      launch.token.toLowerCase() !== canary.token.toLowerCase() ||
      launch.curve === zeroAddress ||
      launch.quoteAsset.toLowerCase() !== canary.quoteAsset.toLowerCase() ||
      launch.phase !== 2
    )
      throw new Error(
        `Canary ${canary.token} is not a factory launch in the declared quote at the PoolCreated phase.`,
      );
    if (
      canary.kind === "single" &&
      (onchainDuo.enabled || onchainDuo.secondaryQuote !== zeroAddress)
    )
      throw new Error(
        `Canary ${canary.token} is a Duo launch but its evidence declares Single.`,
      );
    if (canary.kind === "duo") {
      const route = routeEvidence.get(
        routeKey(canary.quoteAsset, canary.secondaryQuote),
      );
      if (
        !deployment.duoExecutor ||
        !onchainDuo.enabled ||
        onchainDuo.secondaryQuote.toLowerCase() !==
          canary.secondaryQuote.toLowerCase() ||
        !route ||
        route.routeHash.toLowerCase() !== canary.routeHash.toLowerCase()
      )
        throw new Error(
          `Canary ${canary.token} Duo route hash or ordered pair does not match current approved route evidence.`,
        );
      canaryAlignment = route.alignments.find(
        (alignment) => alignment.configId === launch.configId.toString(),
      );
      if (!canaryAlignment)
        throw new Error(
          `Canary ${canary.token} has no active alignment for its launch configuration.`,
        );
      const tokenRouteHash = await client.readContract({
        address: deployment.duoExecutor,
        abi: duoAbi,
        functionName: "tokenConversionRouteHash",
        args: [canary.token],
        blockNumber,
      });
      if (tokenRouteHash.toLowerCase() !== canary.routeHash.toLowerCase())
        throw new Error(
          `Canary ${canary.token} token-bound Duo route hash does not match its evidence.`,
        );
    }
    const canonicalIds: Array<{
      role: "primary" | "secondary";
      id: bigint;
    }> = [{ role: "primary", id: primary }];
    if (primaryPool === zeroHash)
      throw new Error(`Canary ${canary.token} has no canonical V4 pool.`);
    if (
      canary.kind === "single" &&
      (secondary !== 0n || secondaryPool !== zeroHash)
    )
      throw new Error(
        `Canary ${canary.token} is a Duo launch but its evidence declares Single.`,
      );
    const pools: LiquidityPoolEvidence[] = [
      { role: "primary", poolId: primaryPool },
    ];
    if (canary.kind === "duo") {
      if (
        secondary === 0n ||
        secondary === primary ||
        secondaryPool === zeroHash ||
        secondaryPool === primaryPool
      )
        throw new Error(
          `Canary ${canary.token} does not have two distinct Duo V4 pools and positions.`,
        );
      canonicalIds.push({ role: "secondary", id: secondary });
      pools.push({ role: "secondary", poolId: secondaryPool });
    }
    if (canonicalIds.some(({ id }) => id === 0n))
      throw new Error(
        `Canary ${canary.token} has no completed V4 position onchain.`,
      );
    const recordedPrimary = await client.readContract({
      address: deployment.locker,
      abi: lockerPositionAbi,
      functionName: "lockedPositions",
      args: [canary.token],
      blockNumber,
    });
    if (recordedPrimary !== primary)
      throw new Error(
        `Canary ${canary.token} primary V4 position is not recorded by the locker.`,
      );
    if (canary.kind === "duo") {
      const recordedSecondary = await client.readContract({
        address: deployment.locker,
        abi: lockerPositionAbi,
        functionName: "secondaryLockedPositions",
        args: [canary.token],
        blockNumber,
      });
      if (recordedSecondary !== canonicalIds[1].id)
        throw new Error(
          `Canary ${canary.token} secondary V4 position is not recorded by the locker.`,
        );
    }
    const tokenLocked = await client.readContract({
      address: deployment.locker,
      abi: lockerPositionAbi,
      functionName: "isLocked",
      args: [canary.token],
      blockNumber,
    });
    if (!tokenLocked)
      throw new Error(
        `Canary ${canary.token} is not reported as permanently locked.`,
      );
    const positionCount = await client.readContract({
      address: deployment.locker,
      abi: lockerPositionAbi,
      functionName: "lockedPositionCount",
      args: [canary.token],
      blockNumber,
    });
    if (positionCount < BigInt(canonicalIds.length) || positionCount > 256n)
      throw new Error(
        `Canary ${canary.token} has an invalid permanent V4 position registry size.`,
      );
    const registeredIds: bigint[] = [];
    for (let start = 0; start < Number(positionCount); start += 8) {
      const batch = await Promise.all(
        Array.from(
          { length: Math.min(8, Number(positionCount) - start) },
          (_, offset) =>
            client.readContract({
              address: deployment.locker!,
              abi: lockerPositionAbi,
              functionName: "lockedPositionAt",
              args: [canary.token, BigInt(start + offset)],
              blockNumber,
            }),
        ),
      );
      registeredIds.push(...batch);
    }
    const uniqueRegisteredIds = new Set(
      registeredIds.map((id) => id.toString()),
    );
    if (
      uniqueRegisteredIds.size !== registeredIds.length ||
      registeredIds.some((id) => id === 0n) ||
      canonicalIds.some(({ id }) => !uniqueRegisteredIds.has(id.toString()))
    )
      throw new Error(
        `Canary ${canary.token} has an incomplete permanent V4 position registry.`,
      );
    const ids: Array<{
      role: "primary" | "secondary" | "supplemental";
      id: bigint;
    }> = registeredIds.map((id) => ({
      role:
        id === canonicalIds[0].id
          ? "primary"
          : canary.kind === "duo" && id === canonicalIds[1].id
            ? "secondary"
            : "supplemental",
      id,
    }));
    const positions: LiquidityPositionEvidence[] = [];
    for (const { role, id } of ids) {
      const [
        registeredToken,
        positionLocked,
        owner,
        approved,
        liquidity,
        positionInfo,
      ] = await Promise.all([
        client.readContract({
          address: deployment.locker,
          abi: lockerPositionAbi,
          functionName: "positionToken",
          args: [id],
          blockNumber,
        }),
        client.readContract({
          address: deployment.locker,
          abi: lockerPositionAbi,
          functionName: "isPositionLocked",
          args: [id],
          blockNumber,
        }),
        client.readContract({
          address: deployment.positionManager,
          abi: positionSafetyAbi,
          functionName: "ownerOf",
          args: [id],
          blockNumber,
        }),
        client.readContract({
          address: deployment.positionManager,
          abi: positionSafetyAbi,
          functionName: "getApproved",
          args: [id],
          blockNumber,
        }),
        client.readContract({
          address: deployment.positionManager,
          abi: positionSafetyAbi,
          functionName: "getPositionLiquidity",
          args: [id],
          blockNumber,
        }),
        client.readContract({
          address: deployment.positionManager,
          abi: positionSafetyAbi,
          functionName: "getPoolAndPositionInfo",
          args: [id],
          blockNumber,
        }),
      ]);
      const positionPoolId = v4PoolId(positionInfo[0]);
      const key = positionInfo[0];
      const ticks = positionTicks(positionInfo[1]);
      const memeIsCurrency0 =
        key.currency0.toLowerCase() === canary.token.toLowerCase();
      const startingTick = memeIsCurrency0 ? ticks.lower : ticks.upper;
      const effectiveQuoteTick = memeIsCurrency0 ? startingTick : -startingTick;
      const expectedPoolId =
        role === "primary"
          ? primaryPool
          : role === "secondary"
            ? secondaryPool
            : undefined;
      const expectedQuote =
        role === "secondary" && canary.kind === "duo"
          ? canary.secondaryQuote
          : role === "primary"
            ? canary.quoteAsset
            : undefined;
      const hasExpectedPair =
        expectedQuote === undefined ||
        (key.currency0.toLowerCase() === canary.token.toLowerCase() &&
          key.currency1.toLowerCase() === expectedQuote.toLowerCase()) ||
        (key.currency1.toLowerCase() === canary.token.toLowerCase() &&
          key.currency0.toLowerCase() === expectedQuote.toLowerCase());
      if (
        key.fee !== 0 ||
        key.tickSpacing !== 200 ||
        key.hooks.toLowerCase() !== deployment.hook.toLowerCase() ||
        (key.currency0.toLowerCase() !== canary.token.toLowerCase() &&
          key.currency1.toLowerCase() !== canary.token.toLowerCase()) ||
        !hasExpectedPair ||
        (expectedPoolId !== undefined &&
          positionPoolId.toLowerCase() !== expectedPoolId.toLowerCase()) ||
        !pools.some(
          ({ poolId }) => poolId.toLowerCase() === positionPoolId.toLowerCase(),
        )
      )
        throw new Error(
          `Canary ${canary.token} has a registered position outside its canonical V4 pool set.`,
        );
      if (
        registeredToken.toLowerCase() !== canary.token.toLowerCase() ||
        !positionLocked ||
        owner.toLowerCase() !== permanentPositionOwner.toLowerCase() ||
        approved !== zeroAddress ||
        liquidity === 0n
      )
        throw new Error(
          `Canary ${canary.token} does not have dead-owned V4 liquidity for its ${role} position.`,
        );
      positions.push({
        role,
        positionId: id.toString(),
        poolId: positionPoolId,
        owner: getAddress(owner),
        approved: getAddress(approved),
        liquidity: liquidity.toString(),
        ...(canary.kind === "duo" && role !== "supplemental"
          ? {
              tickLower: ticks.lower,
              tickUpper: ticks.upper,
              startingTick,
              effectiveQuoteTick,
            }
          : {}),
      });
    }
    let crossRateEvidence:
      | {
          alignmentHash: Hash;
          primaryStartingTick: number;
          secondaryStartingTick: number;
          crossRateDeviationBps: number;
        }
      | undefined;
    if (canary.kind === "duo") {
      const primaryPosition = positions.find(
        (position) => position.role === "primary",
      );
      const secondaryPosition = positions.find(
        (position) => position.role === "secondary",
      );
      if (
        !primaryPosition ||
        !secondaryPosition ||
        !canaryAlignment ||
        primaryPosition.startingTick === undefined ||
        secondaryPosition.startingTick === undefined ||
        primaryPosition.effectiveQuoteTick === undefined ||
        secondaryPosition.effectiveQuoteTick === undefined
      )
        throw new Error(
          `Canary ${canary.token} is missing Duo cross-rate position evidence.`,
        );
      const actualLogRate =
        (primaryPosition.effectiveQuoteTick -
          secondaryPosition.effectiveQuoteTick) *
        Math.log(1.0001);
      const expectedLogRate =
        Math.log(Number(BigInt(canaryAlignment.observedPrimaryOut))) -
        Math.log(Number(BigInt(canaryAlignment.secondaryPhantom)));
      const crossRateDeviationBps = Math.ceil(
        Math.abs(Math.exp(actualLogRate - expectedLogRate) - 1) * 10_000,
      );
      if (
        !Number.isFinite(crossRateDeviationBps) ||
        crossRateDeviationBps > 500
      )
        throw new Error(
          `Canary ${canary.token} Duo tick-snapped cross-rate exceeds 500 bps.`,
        );
      crossRateEvidence = {
        alignmentHash: canaryAlignment.attestationHash,
        primaryStartingTick: primaryPosition.startingTick,
        secondaryStartingTick: secondaryPosition.startingTick,
        crossRateDeviationBps,
      };
    }
    const verifiedCanary: LiquidityCanaryEvidenceBase = {
      kind: canary.kind,
      token: canary.token,
      quoteAsset: canary.quoteAsset,
      launch: {
        curve: getAddress(launch.curve),
        phase: 2,
      },
      ...(canary.kind === "duo"
        ? {
            secondaryQuote: canary.secondaryQuote,
            routeHash: canary.routeHash,
          }
        : {}),
      checkedAt: acceptance.checkedAt,
      pools,
      positions,
      ...crossRateEvidence,
    };
    if (
      acceptance.provider === "fomo.family" &&
      "url" in canary &&
      "warnings" in canary
    )
      verified.push({
        ...verifiedCanary,
        provider: "fomo.family",
        url: canary.url,
        warnings: canary.warnings,
      });
    else if (acceptance.provider === "monad-testnet-onchain")
      verified.push({ ...verifiedCanary, provider: "monad-testnet-onchain" });
    else
      throw new Error("Liquidity canary evidence does not match its provider.");
  }
  return verified;
}

export function assertHookPermissions(hook: Address): void {
  const flags = BigInt(hook) & ((1n << 14n) - 1n);
  // AFTER_SWAP_RETURNS_DELTA is required because afterSwap charges a fee delta.
  if (flags !== 0x2044n)
    throw new Error(
      `Hook address has flags 0x${flags.toString(16)}; expected beforeInitialize, afterSwap, and afterSwapReturnsDelta (0x2044).`,
    );
}
export type DeploymentVerificationOptions = {
    chainId: number;
    deployment?: Deployment;
    dependencies?: {
      poolManager: Address;
      positionManager: Address;
      permit2?: Address;
      quoter?: Address;
      stateView?: Address;
    };
    expectedCodeHashes?: Record<string, Hash>;
    probeOsaka?: boolean;
    /** Verify one already-confirmed block instead of implicitly selecting the RPC head. */
    blockNumber?: bigint;
  };

export async function verifyDeployment(client: PublicClient, options: DeploymentVerificationOptions): Promise<PreflightReport> {
  return verifyDeploymentIntegrity(client, options, true);
}

export type MaintenancePreflightReport = Omit<PreflightReport, 'scope'> & {
  scope: 'maintenance'; futureDuoLaunchFreshnessChecked: false;
};
/** Existing-launch testnet maintenance retains wiring and live canary checks.
 * The publication/creation verifier retains activation age and expiry guards.
 * Public maintenance requires the already accepted catalog; no manifest changes.
 */
export async function verifyMaintenanceDeployment(client: PublicClient,
  options: DeploymentVerificationOptions): Promise<MaintenancePreflightReport> {
  const deployment = options.deployment;
  if (options.chainId !== 10143 || deployment?.chainId !== 10143 ||
      deployment.environment !== 'configured' || typeof deployment.security?.permissionless !== 'boolean' ||
      (deployment.security.permissionless && !deployment.testnetLiquidityAcceptance))
    throw new Error('Maintenance verification requires the closed Monad testnet or accepted public Monad testnet deployment.');
  if (deployment.security.permissionless) parseDeployment(deployment);
  const report = await verifyDeploymentIntegrity(client, options, false);
  return { ...report, scope: 'maintenance', futureDuoLaunchFreshnessChecked: false };
}

async function verifyDeploymentIntegrity(client: PublicClient,
  options: DeploymentVerificationOptions, requireDuoFreshness: boolean): Promise<PreflightReport> {
  if (![143, 10143, 31337].includes(options.chainId))
    throw new Error("Preflight supports only Monad mainnet, Monad testnet, and local rehearsals.");
  const deployment = options.deployment;
  if (deployment && deployment.chainId !== options.chainId)
    throw new Error(
      "Manifest chain does not match the requested verification chain.",
    );
  if (deployment) assertMonadPaymentDependencies(deployment);
  const fullContracts = deployment
    ? deploymentContractAddresses(deployment)
    : undefined;
  const actualChain = await client.getChainId();
  if (actualChain !== options.chainId)
    throw new Error(
      `RPC chain ${actualChain} does not match configured chain ${options.chainId}.`,
    );
  const block =
    options.blockNumber === undefined
      ? await client.getBlock({ blockTag: "latest" })
      : await client.getBlock({ blockNumber: options.blockNumber });
  if (!block.hash || block.number === null)
    throw new Error("RPC did not return a mined block.");
  if (options.blockNumber !== undefined && block.number !== options.blockNumber)
    throw new Error("RPC did not return the requested confirmed block.");
  if (
    deployment?.environment === "configured" &&
    options.blockNumber === undefined
  ) {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (block.timestamp > now + 5n * 60n || now - block.timestamp > 5n * 60n)
      throw new Error(
        "Configured RPC head timestamp differs from the local clock by more than five minutes.",
      );
  }
  if (deployment && BigInt(deployment.startBlock) > block.number)
    throw new Error("Deployment startBlock is above the current chain head.");
  if (options.chainId === 143) {
    for (const role of ["poolManager", "positionManager", "permit2"] as const) {
      const configured = options.dependencies?.[role] ?? deployment?.[role];
      const official = monadV4[role];
      if (configured && configured.toLowerCase() !== official.toLowerCase())
        throw new Error(
          `Deployment must use the official Monad V4 ${role} at ${official}.`,
        );
    }
  }
  if (deployment && options.dependencies)
    for (const role of ["poolManager", "positionManager", "permit2"] as const) {
      const expected = options.dependencies[role];
      if (
        expected &&
        expected.toLowerCase() !== deployment[role]?.toLowerCase()
      )
        throw new Error(
          `Dependency ${role} does not match the deployment manifest.`,
        );
    }
  const deps =
    options.dependencies ??
    (options.chainId === 143
      ? monadV4
      : deployment
        ? {
            poolManager: deployment.poolManager,
            positionManager: deployment.positionManager,
            permit2: deployment.permit2!,
          }
        : undefined);
  if (!deps)
    throw new Error(
      "This network needs explicit verified V4 dependency addresses; no testnet defaults are assumed.",
    );
  const contracts: Record<string, Address> = { ...deps };
  if (deployment) {
    Object.assign(contracts, fullContracts);
    if (deployment.payments) {
      const p = deployment.payments;
      Object.assign(contracts, {
        paymentRouter: p.router,
        paymentV3Factory: p.v3Factory,
        paymentQuoterV3: p.quoterV3,
        paymentQuoterV4: p.quoterV4,
        paymentWeth: p.weth,
      });
    }
    assertHookPermissions(deployment.hook);
    for (const quote of deployment.quoteAssets)
      if (quote.address !== zeroAddress)
        contracts[`quote:${quote.symbol}:${quote.address.toLowerCase()}`] =
          quote.address;
  }
  const evidence: ContractEvidence[] = [];
  const relationships: PreflightReport["relationships"] = [];
  let security: PreflightReport["security"];
  if (deployment) {
    const wiring = await verifyDeploymentWiring(
      client,
      deployment,
      block.number,
    );
    Object.assign(contracts, wiring.derivedContracts);
    relationships.push(...wiring.relationships);
    security = wiring.security;
  }
  // Deliberately bounded to one request at a time for the public endpoint.
  for (const [role, address] of Object.entries(contracts)) {
    const code = await client.getCode({ address, blockNumber: block.number });
    if (!code || code === "0x")
      throw new Error(`${role} has no deployed code at ${address}.`);
    const codeHash = keccak256(code),
      expected = options.expectedCodeHashes?.[role];
    if (expected && expected.toLowerCase() !== codeHash.toLowerCase())
      throw new Error(
        `${role} code hash does not match the pinned deployment evidence.`,
      );
    evidence.push({
      role,
      address: getAddress(address),
      codeHash,
      codeBytes: (code.length - 2) / 2,
    });
  }
  for (const [contract, getter, expected] of [
    [deps.positionManager, "poolManager", deps.poolManager],
    ...(deps.permit2
      ? [[deps.positionManager, "permit2", deps.permit2] as const]
      : []),
    ...(deps.quoter
      ? [[deps.quoter, "poolManager", deps.poolManager] as const]
      : []),
    ...(deps.stateView
      ? [[deps.stateView, "poolManager", deps.poolManager] as const]
      : []),
  ] as const) {
    if (
      relationships.some(
        (relation) =>
          relation.contract.toLowerCase() === contract.toLowerCase() &&
          relation.getter === getter,
      )
    )
      continue;
    const value = await client.readContract({
      address: contract,
      abi: relationAbi,
      functionName: getter,
      args: [],
      blockNumber: block.number,
    });
    if (value.toLowerCase() !== expected.toLowerCase())
      throw new Error(
        `${contract}.${getter}() points to ${value}, expected ${expected}.`,
      );
    relationships.push({
      contract: getAddress(contract),
      getter,
      value: getAddress(value),
    });
  }
  const quotes = deployment
    ? await readManifestQuotes(client, deployment, block.number)
    : [];
  const duoRoutes = deployment
    ? await (requireDuoFreshness ? verifyDuoRouteCatalog : verifyMaintenanceDuoRouteCatalog)(client, deployment, block.number)
    : [];
  const liquidityCanaries = deployment
    ? await verifyLiquidityCanaries(
        client,
        deployment,
        block.number,
        block.timestamp,
        quotes,
        duoRoutes,
        requireDuoFreshness,
      )
    : undefined;
  let osakaClz: PreflightReport["osakaClz"];
  if (options.probeOsaka) {
    // PUSH1 1; CLZ; PUSH0; MSTORE; PUSH1 32; PUSH0; RETURN.
    // This is eth_call creation simulation, with no deployed address or signed transaction.
    const initcode = "0x60011e5f5260205ff3" as const;
    const expected = `0x${"ff".padStart(64, "0")}`;
    const result = (
      await client.call({ data: initcode, blockNumber: block.number })
    ).data;
    if (result !== expected)
      throw new Error(
        "RPC does not return the EIP-7939 CLZ result required by the Osaka build.",
      );
    osakaClz = {
      opcode: "0x1e",
      initcode,
      result,
      expected,
      method: "eth_call creation",
    };
  }
  const canonical = await client.getBlock({ blockNumber: block.number });
  if (canonical.hash !== block.hash)
    throw new Error(
      "Chain reorganized during preflight. Retry to obtain a consistent evidence block.",
    );
  return {
    version: 1,
    chainId: actualChain,
    blockNumber: block.number.toString(),
    blockHash: block.hash,
    blockTimestamp: block.timestamp.toString(),
    checkedAt: new Date().toISOString(),
    contracts: evidence,
    relationships,
    ...(security ? { security } : {}),
    ...(duoRoutes.length ? { duoRoutes } : {}),
    ...(liquidityCanaries ? { liquidityCanaries } : {}),
    osakaClz,
    quotes,
    scope: deployment ? "deployment" : "dependencies",
    sources: [
      "https://docs.monad.xyz/developer-essentials/network-information",
      "https://developers.uniswap.org/docs/protocols/v4/deployments",
      ...(liquidityCanaries
        ? liquidityCanaries.flatMap((canary) =>
            canary.url ? [canary.url] : [],
          )
        : []),
      ...(osakaClz ? ["https://eips.ethereum.org/EIPS/eip-7939"] : []),
    ],
  };
}
