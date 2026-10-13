// Vendored from the XOOX SDK; only what the indexer uses.
import {
  getAddress,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  toBytes,
  isAddress,
  parseAbi,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { missingCapability } from "./holder-fees";
import type { Deployment } from "./config";
import {
  findPaymentRoute,
  quotePaymentConversion,
  type PaymentHop,
} from "./payment-routing";

/** Direct launch into two pools, with supply split by the factory. */
export type DuoConfig = {
  enabled: boolean;
  secondaryQuote: Address;
};

export type DuoCapability = { version: 0 } | { version: 2; executor: Address };

export type ApprovedDuoRoute = {
  primaryQuote: Address;
  secondaryQuote: Address;
  routeHash: Hash;
  routeRevision: bigint;
  hops: PaymentHop[];
  blockNumber: bigint;
};

export type DuoAlignmentAttestation = {
  routeHash: Hash;
  primaryEconomicsHash: Hash;
  secondaryEconomicsHash: Hash;
  primaryPhantom: bigint;
  secondaryPhantom: bigint;
  observedPrimaryOut: bigint;
  routeRevision: bigint;
  observedBlock: bigint;
  validUntil: bigint;
  maxDeviationBps: number;
};

export type VerifiedDuoAlignment = DuoAlignmentAttestation & {
  configId: bigint;
  policy: Address;
  attestationHash: Hash;
  quotedPrimaryOut: bigint;
  deviationBps: bigint;
  blockNumber: bigint;
} & (
  /** Historical V1 drafts omitted the discriminator and retain their old codec. */
  | { policyVersion?: 1; commitmentVersion?: never; commitmentHash?: never; factory?: never; chainId?: never }
  | { policyVersion: 2; commitmentVersion: 2; commitmentHash: Hash; factory: Address; chainId: number }
);

// Separate capability ABI keeps existing factory deployments readable.
export const duoAbi = parseAbi([
  "error EconomicsChanged()",
  "struct Hop { uint8 kind; address tokenIn; address tokenOut; uint24 fee; int24 tickSpacing; }",
  "struct StrategyParams { bool baseFeeEnabled; uint16 creatorBps; uint16 holderBps; uint16 burnBps; uint16 liquidityBps; }",
  "struct DuoConfig { bool enabled; address secondaryQuote; }",
  "struct Config { uint256 supply; uint256 phantomQuote; uint256 graduationThreshold; uint16 curveFeeBps; uint16 protocolShareBps; uint16 buybackShareBps; uint16 snipeStartBps; uint32 snipeDuration; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "struct DuoAlignmentAttestation { bytes32 routeHash; bytes32 primaryEconomicsHash; bytes32 secondaryEconomicsHash; uint256 primaryPhantom; uint256 secondaryPhantom; uint256 observedPrimaryOut; uint64 routeRevision; uint64 observedBlock; uint64 validUntil; uint16 maxDeviationBps; }",
  "struct TokenParams { string name; string symbol; string description; string image; string website; string twitter; string telegram; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bool dividendEnabled; bytes32 expectedEconomics; bytes32 salt; uint256 deadline; }",
  "function duoVersion() view returns (uint256)",
  "function duoExecutor() view returns (address)",
  "function duoLaunchPolicy() view returns (address)",
  "function factory() view returns (address)",
  "function poolManager() view returns (address)",
  "function v3Factory() view returns (address)",
  "function weth() view returns (address)",
  "function routeRegistryVersion() pure returns(uint256)",
  "function conversionRouteHash(address input,address output,Hop[] hops) pure returns(bytes32)",
  "function pairConversionRouteHash(address input,address output) view returns(bytes32)",
  "function approvedConversionRoutes(bytes32 routeHash) view returns(bool)",
  "function conversionRouteRevision(bytes32 routeHash) view returns(uint64)",
  "function duoAlignmentVersion() pure returns(uint256)",
  "function policyVersion() pure returns(uint256)",
  "function duoLaunchCommitmentVersion() pure returns(uint256)",
  "function activeDuoLaunchAlignmentCommitment(uint256 configId,address secondaryQuote,address primaryQuote) view returns(bytes32)",
  "function duoAlignmentAttestation(uint256 configId,address secondaryQuote,address primaryQuote) view returns(DuoAlignmentAttestation)",
  "function setDuoAlignmentAttestation(uint256 configId,address secondaryQuote,address primaryQuote,DuoAlignmentAttestation attestation)",
  "function activeDuoAlignmentHash(uint256 configId,address secondaryQuote,address primaryQuote) view returns(bytes32)",
  "function economicsHash(uint256 configId,address quote) view returns(bytes32)",
  "function pairTokenEconomics(address quote) view returns(uint256 phantomQuote,uint256 graduationThreshold,uint8 decimals)",
  "function getConfig(uint256 configId) view returns(Config)",
  "function configCount() view returns(uint256)",
  "function tokenConversionRouteHash(address token) view returns(bytes32)",
  "function duoConfig(address token) view returns (DuoConfig)",
  "function duoPoolIds(address token) view returns (bytes32)",
  "function duoPositionIds(address token) view returns (uint256)",
  "function duoEconomicsHash(uint256 configId,address quote,StrategyParams strategy,DuoConfig duo) view returns (bytes32)",
  "function createTokenWithDuo(TokenParams params,uint256 configId,address quote,StrategyParams strategy,DuoConfig duo) payable returns (address token,address curve)",
  "function createTokenForWithDuo(TokenParams params,uint256 configId,address quote,address creator,StrategyParams strategy,DuoConfig duo) payable returns (address token,address curve)",
  "function launchAndBuyWithDuo(TokenParams params,uint256 configId,address quote,StrategyParams strategy,DuoConfig duo,uint256 quoteIn,uint256 minTokensOut,uint256 deadline) payable returns (address token,address curve,uint256 tokensOut,uint256 spent,uint256 refund)",
]);

function checkedAddress(value: Address, label: string): Address {
  if (!isAddress(value, { strict: true }))
    throw new Error(
      `${label} must be a valid address with a correct checksum.`,
    );
  return getAddress(value);
}

/** Unknown versions and failures never downgrade to a supported configuration. */
export async function readDuoCapability(
  client: PublicClient,
  factory: Address,
  blockNumber?: bigint,
): Promise<DuoCapability> {
  const atBlock = blockNumber ?? (await client.getBlockNumber());
  const factoryAddress = checkedAddress(factory, "Factory");
  let version: bigint;
  try {
    version = await client.readContract({
      address: factoryAddress,
      abi: duoAbi,
      functionName: "duoVersion",
      blockNumber: atBlock,
    });
  } catch (error) {
    if (missingCapability(error)) return { version: 0 };
    throw error;
  }
  if (version === 0n) return { version: 0 };
  if (version !== 2n) throw new Error("Factory Duo version is unsupported.");
  const executor = checkedAddress(
    await client.readContract({
      address: factoryAddress,
      abi: duoAbi,
      functionName: "duoExecutor",
      blockNumber: atBlock,
    }),
    "Duo executor",
  );
  if (executor === zeroAddress)
    throw new Error("Duo executor is not configured.");
  const code = await client.getCode({
    address: executor,
    blockNumber: atBlock,
  });
  if (!code || code === "0x")
    throw new Error("Duo executor has no deployed code.");
  const executorFactory = checkedAddress(
    await client.readContract({
      address: executor,
      abi: duoAbi,
      functionName: "factory",
      blockNumber: atBlock,
    }),
    "Duo executor factory",
  );
  if (executorFactory !== factoryAddress)
    throw new Error("Duo executor is connected to a different factory.");
  return { version: 2, executor };
}

const sameAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

function validRouteHash(value: Hash): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value) && value !== zeroHash;
}

/** Resolve the manifest's exact typed route and bind it to governance state at
 * one block. Missing and revoked routes are omitted; RPC or wiring failures
 * reject the whole result so callers cannot advertise a stale pair. */
export async function readApprovedDuoRoutes(
  client: PublicClient,
  deployment: Deployment,
  primaryQuote: Address,
  blockNumber?: bigint,
): Promise<ApprovedDuoRoute[]> {
  const primary = checkedAddress(primaryQuote, "Primary quote");
  const configuredPairs = (deployment.duoPairs ?? []).filter((pair) =>
    sameAddress(pair.primaryQuote, primary),
  );
  if (!configuredPairs.length) return [];
  if (!deployment.duoExecutor || !deployment.payments)
    throw new Error("Duo route dependencies are not configured.");
  const atBlock = blockNumber ?? (await client.getBlockNumber());
  const capability = await readDuoCapability(
    client,
    deployment.factory,
    atBlock,
  );
  if (
    capability.version !== 2 ||
    !sameAddress(capability.executor, deployment.duoExecutor)
  )
    throw new Error("Duo route executor does not match the deployment.");
  const executor = capability.executor;
  const [routeRegistryVersion, poolManager, v3Factory, weth] =
    await Promise.all([
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "routeRegistryVersion",
        blockNumber: atBlock,
      }),
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "poolManager",
        blockNumber: atBlock,
      }),
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "v3Factory",
        blockNumber: atBlock,
      }),
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "weth",
        blockNumber: atBlock,
      }),
    ]);
  if (routeRegistryVersion !== 2n)
    throw new Error("Duo route registry version is unsupported.");
  if (
    !sameAddress(poolManager, deployment.poolManager) ||
    !sameAddress(v3Factory, deployment.payments.v3Factory) ||
    !sameAddress(weth, deployment.payments.weth)
  )
    throw new Error("Duo route dependencies do not match the deployment.");

  const routes: ApprovedDuoRoute[] = [];
  for (const pair of configuredPairs) {
    const secondary = checkedAddress(pair.secondaryQuote, "Secondary quote");
    const hops = findPaymentRoute(deployment.payments, secondary, primary);
    if (!hops?.length) continue;
    const [computedHash, pairHash] = await Promise.all([
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "conversionRouteHash",
        args: [secondary, primary, hops],
        blockNumber: atBlock,
      }),
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "pairConversionRouteHash",
        args: [secondary, primary],
        blockNumber: atBlock,
      }),
    ]);
    if (
      !validRouteHash(computedHash) ||
      !validRouteHash(pairHash) ||
      computedHash.toLowerCase() !== pairHash.toLowerCase()
    )
      continue;
    const [approved, routeRevision] = await Promise.all([
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "approvedConversionRoutes",
        args: [computedHash],
        blockNumber: atBlock,
      }),
      client.readContract({
        address: executor,
        abi: duoAbi,
        functionName: "conversionRouteRevision",
        args: [computedHash],
        blockNumber: atBlock,
      }),
    ]);
    if (!approved || routeRevision === 0n) continue;
    routes.push({
      primaryQuote: primary,
      secondaryQuote: secondary,
      routeHash: computedHash,
      routeRevision,
      hops,
      blockNumber: atBlock,
    });
  }
  return routes;
}

const MAX_ALIGNMENT_BLOCK_AGE = 300n;
const MAX_ALIGNMENT_DEVIATION_BPS = 100n;
const MIN_ALIGNMENT_VALIDITY = 5n * 60n;

function alignmentDeviationBps(observed: bigint, expected: bigint): bigint {
  if (observed <= 0n || expected <= 0n)
    throw new Error("Duo alignment amounts must be positive.");
  const difference =
    observed > expected ? observed - expected : expected - observed;
  return (difference * 10_000n + expected - 1n) / expected;
}

async function effectivePhantom(
  client: PublicClient,
  factory: Address,
  quote: Address,
  configId: bigint,
  blockNumber: bigint,
): Promise<bigint> {
  if (quote === zeroAddress) {
    const config = await client.readContract({
      address: factory,
      abi: duoAbi,
      functionName: "getConfig",
      args: [configId],
      blockNumber,
    });
    if (!config.enabled || config.phantomQuote <= 0n)
      throw new Error(
        "Duo alignment references an inactive launch configuration.",
      );
    return config.phantomQuote;
  }
  const [phantom] = await client.readContract({
    address: factory,
    abi: duoAbi,
    functionName: "pairTokenEconomics",
    args: [quote],
    blockNumber,
  });
  if (phantom <= 0n)
    throw new Error("Duo alignment references missing quote economics.");
  return phantom;
}

/** Validate the config-specific, short-lived alignment attestation and requote
 * its exact secondary phantom input through the same typed route at one block. */
export async function readDuoAlignmentAttestation(
  client: PublicClient,
  deployment: Deployment,
  route: ApprovedDuoRoute,
  configId: bigint,
  blockNumber?: bigint,
): Promise<VerifiedDuoAlignment> {
  return readDuoAlignment(client, deployment, route, configId, blockNumber, true);
}

/** Existing-launch maintenance retains all static alignment and route checks.
 * Its original launch attestation need not authorize another future launch.
 */
export async function readDuoAlignmentForMaintenance(
  client: PublicClient, deployment: Deployment, route: ApprovedDuoRoute,
  configId: bigint, blockNumber?: bigint,
): Promise<VerifiedDuoAlignment> {
  return readDuoAlignment(client, deployment, route, configId, blockNumber, false);
}

function recordedDuoAlignmentHash(deployment: Deployment, route: ApprovedDuoRoute,
  configId: bigint, attestation: DuoAlignmentAttestation): Hash {
  const key = keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32,uint256,address,uint256,address,address'),
    [keccak256(toBytes('LONG_DUO_LAUNCH_ALIGNMENT_V1')), BigInt(deployment.chainId),
      deployment.factory, configId, route.secondaryQuote, route.primaryQuote],
  ));
  return keccak256(encodeAbiParameters(
    parseAbiParameters('bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,uint64,uint64,uint16,uint64'),
    [key, attestation.routeHash, attestation.primaryEconomicsHash, attestation.secondaryEconomicsHash,
      attestation.primaryPhantom, attestation.secondaryPhantom, attestation.observedPrimaryOut,
      attestation.routeRevision, attestation.observedBlock, attestation.maxDeviationBps, attestation.validUntil],
  ));
}

/** Exact V2 codec, not authorization: callers still need the current full
 * attestation, trusted Factory/Policy lineage, route, economics and live quote. */
export function duoStableAlignmentCommitment(
  chainId: number, factory: Address, policy: Address,
  route: Pick<ApprovedDuoRoute, "primaryQuote" | "secondaryQuote">,
  configId: bigint, attestation: DuoAlignmentAttestation,
): Hash {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || configId < 0n)
    throw new Error("Duo commitment chain or configuration is invalid.");
  const checkedFactory = checkedAddress(factory, "Duo Factory"), checkedPolicy = checkedAddress(policy, "Duo Policy");
  if (checkedFactory === zeroAddress || checkedPolicy === zeroAddress)
    throw new Error("Duo commitment lineage is missing.");
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,uint256,address,address,uint256,address,address,bytes32,bytes32,bytes32,uint256,uint256,uint256,uint64,uint16"),
    [keccak256(toBytes("XOOX_DUO_LAUNCH_INTENT_V2")), BigInt(chainId), checkedFactory, checkedPolicy,
      configId, checkedAddress(route.secondaryQuote, "Secondary quote"), checkedAddress(route.primaryQuote, "Primary quote"),
      attestation.routeHash, attestation.primaryEconomicsHash, attestation.secondaryEconomicsHash,
      attestation.primaryPhantom, attestation.secondaryPhantom, attestation.observedPrimaryOut,
      attestation.routeRevision, attestation.maxDeviationBps],
  ));
}

async function readDuoAlignment(
  client: PublicClient, deployment: Deployment, route: ApprovedDuoRoute,
  configId: bigint, blockNumber: bigint | undefined, requireFreshness: boolean,
): Promise<VerifiedDuoAlignment> {
  if (!deployment.duoExecutor || !deployment.payments)
    throw new Error("Duo alignment dependencies are not configured.");
  const atBlock = blockNumber ?? (await client.getBlockNumber());
  if (route.blockNumber !== atBlock)
    throw new Error(
      "Duo route and alignment must use the same evidence block.",
    );
  const policy = checkedAddress(
    await client.readContract({
      address: deployment.factory,
      abi: duoAbi,
      functionName: "duoLaunchPolicy",
      blockNumber: atBlock,
    }),
    "Duo launch policy",
  );
  const code = await client.getCode({ address: policy, blockNumber: atBlock });
  if (!code || code === "0x")
    throw new Error("Duo alignment policy has no deployed code.");
  const [policyFactory, policyVersion] = await Promise.all([
    client.readContract({ address: policy, abi: duoAbi, functionName: "factory", blockNumber: atBlock }),
    client.readContract({ address: policy, abi: duoAbi, functionName: "policyVersion", blockNumber: atBlock }),
  ]);
  if (!sameAddress(checkedAddress(policyFactory, "Duo policy Factory"), deployment.factory))
    throw new Error("Duo policy is connected to a different Factory.");
  if (policyVersion !== 1n && policyVersion !== 2n)
    throw new Error("Duo policy version is unsupported.");
  if (policyVersion === 2n) {
    const [commitmentVersion, chainId] = await Promise.all([
      client.readContract({ address: policy, abi: duoAbi, functionName: "duoLaunchCommitmentVersion", blockNumber: atBlock }),
      client.getChainId(),
    ]);
    if (commitmentVersion !== 2n || chainId !== deployment.chainId)
      throw new Error("Duo V2 commitment schema or chain is unsupported.");
  }
  const [
    version,
    attestation,
    activeAttestationHash,
    block,
    primaryEconomicsHash,
    secondaryEconomicsHash,
    primaryPhantom,
    secondaryPhantom,
  ] = await Promise.all([
    client.readContract({
      address: policy,
      abi: duoAbi,
      functionName: "duoAlignmentVersion",
      blockNumber: atBlock,
    }),
    client.readContract({
      address: policy,
      abi: duoAbi,
      functionName: "duoAlignmentAttestation",
      args: [configId, route.secondaryQuote, route.primaryQuote],
      blockNumber: atBlock,
    }),
    client.readContract({
      address: policy,
      abi: duoAbi,
      functionName: "activeDuoAlignmentHash",
      args: [configId, route.secondaryQuote, route.primaryQuote],
      blockNumber: atBlock,
    }),
    client.getBlock({ blockNumber: atBlock }),
    client.readContract({
      address: deployment.factory,
      abi: duoAbi,
      functionName: "economicsHash",
      args: [configId, route.primaryQuote],
      blockNumber: atBlock,
    }),
    client.readContract({
      address: deployment.factory,
      abi: duoAbi,
      functionName: "economicsHash",
      args: [configId, route.secondaryQuote],
      blockNumber: atBlock,
    }),
    effectivePhantom(
      client,
      deployment.factory,
      route.primaryQuote,
      configId,
      atBlock,
    ),
    effectivePhantom(
      client,
      deployment.factory,
      route.secondaryQuote,
      configId,
      atBlock,
    ),
  ]);
  const maxDeviationBps = Number(attestation.maxDeviationBps);
  if (
    version !== 1n ||
    (requireFreshness && !validRouteHash(activeAttestationHash)) ||
    attestation.routeHash.toLowerCase() !== route.routeHash.toLowerCase() ||
    attestation.routeRevision !== route.routeRevision ||
    attestation.primaryEconomicsHash.toLowerCase() !==
      primaryEconomicsHash.toLowerCase() ||
    attestation.secondaryEconomicsHash.toLowerCase() !==
      secondaryEconomicsHash.toLowerCase() ||
    attestation.primaryPhantom !== primaryPhantom ||
    attestation.secondaryPhantom !== secondaryPhantom ||
    maxDeviationBps < 0 ||
    maxDeviationBps > Number(MAX_ALIGNMENT_DEVIATION_BPS) ||
    attestation.observedBlock === 0n ||
    attestation.observedBlock > atBlock ||
    attestation.validUntil === 0n ||
    (requireFreshness && (atBlock - attestation.observedBlock > MAX_ALIGNMENT_BLOCK_AGE ||
      attestation.validUntil < block.timestamp + MIN_ALIGNMENT_VALIDITY)) ||
    alignmentDeviationBps(attestation.observedPrimaryOut, primaryPhantom) >
      BigInt(maxDeviationBps)
  )
    throw new Error(
      "Duo alignment attestation is missing, stale, or mismatched.",
    );
  const quotedPrimaryOut = await quotePaymentConversion(
    client,
    deployment.payments,
    route.hops,
    secondaryPhantom,
    atBlock,
  );
  const deviationBps = alignmentDeviationBps(quotedPrimaryOut, primaryPhantom);
  if (deviationBps > BigInt(maxDeviationBps))
    throw new Error("Duo alignment live route exceeds the approved deviation.");
  const attestationHash = requireFreshness ? activeAttestationHash
    : recordedDuoAlignmentHash(deployment, route, configId, attestation);
  if (!requireFreshness && validRouteHash(activeAttestationHash) && activeAttestationHash !== attestationHash)
    throw new Error('Duo alignment active hash differs from its recorded inputs.');
  let commitmentHash: Hash | undefined;
  if (policyVersion === 2n) {
    const recordedFull = recordedDuoAlignmentHash(deployment, route, configId, attestation);
    if (typeof activeAttestationHash !== "string" || !/^0x[\da-f]{64}$/i.test(activeAttestationHash) ||
      (requireFreshness && attestation.validUntil > block.timestamp + 3600n))
      throw new Error("Duo V2 current full provenance is malformed or exceeds its validity bound.");
    if (validRouteHash(activeAttestationHash) && !sameAddress(activeAttestationHash, recordedFull))
      throw new Error("Duo V2 current full provenance differs from its recorded inputs.");
    commitmentHash = duoStableAlignmentCommitment(deployment.chainId, deployment.factory, policy, route, configId, attestation);
    const activeCommitment = await client.readContract({ address: policy, abi: duoAbi,
      functionName: "activeDuoLaunchAlignmentCommitment", args: [configId, route.secondaryQuote, route.primaryQuote], blockNumber: atBlock });
    if (typeof activeCommitment !== "string" || !/^0x[\da-f]{64}$/i.test(activeCommitment) ||
      (requireFreshness && !validRouteHash(activeCommitment)) ||
      (!validRouteHash(activeAttestationHash) && activeCommitment !== zeroHash) ||
      (validRouteHash(activeCommitment) && !sameAddress(activeCommitment, commitmentHash)))
      throw new Error("Duo V2 stable intent differs from its current full provenance.");
    if (await client.getChainId() !== deployment.chainId)
      throw new Error("Duo V2 chain changed during its evidence read.");
  }
  const verified = {
    ...attestation,
    maxDeviationBps,
    configId,
    policy,
    attestationHash,
    quotedPrimaryOut,
    deviationBps,
    blockNumber: atBlock,
  };
  return policyVersion === 2n ? { ...verified, policyVersion: 2, commitmentVersion: 2,
    commitmentHash: commitmentHash!, factory: getAddress(deployment.factory), chainId: deployment.chainId } : verified;
}

