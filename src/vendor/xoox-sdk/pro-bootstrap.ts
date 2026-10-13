// Vendored from the XOOX SDK; only what the indexer uses.
import {
  concatHex,
  createPublicClient,
  custom,
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionResult,
  multicall3Abi,
  parseAbiParameters,
  size,
  deploylessCallViaBytecodeBytecode,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  parseAbi,
  sliceHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  captureProFeeProgramClaimPolicies,
  type ProFeeProgramClaimPolicy,
} from "./pro-fee-program-claim-policy";
import { MONAD_MAX_CODE_SIZE } from "./monad-code-limits";

export const PRO_BOOTSTRAP_SOURCE_SCHEMA =
  "xoox.pro-bootstrap.reviewed-artifacts" as const;
export const PRO_BOOTSTRAP_PROOF_SCHEMA = "xoox.pro-token.bootstrap" as const;
export const PRO_BOOTSTRAP_COMPONENT_ARTIFACTS = Object.freeze({
  factory: "packages/contracts/src/pro/ProFactory.sol:ProFactory",
  partnerRegistry:
    "packages/contracts/src/pro/ProPartnerRegistry.sol:ProPartnerRegistry",
  marketCalendar:
    "packages/contracts/src/pro/ProMarketHours.sol:ProMarketHours",
  ruleValidator:
    "packages/contracts/src/pro/ProRuleValidator.sol:ProRuleValidator",
  tokenDeployer: "packages/contracts/src/pro/ProDeployers.sol:ProTokenDeployer",
  policyDeployer:
    "packages/contracts/src/pro/ProDeployers.sol:ProPolicyDeployer",
  curveDeployer: "packages/contracts/src/pro/ProDeployers.sol:ProCurveDeployer",
  router: "packages/contracts/src/pro/ProRouter.sol:ProRouter",
  vaultDeployer: "packages/contracts/src/pro/ProDeployers.sol:ProVaultDeployer",
  vestingDeployer:
    "packages/contracts/src/pro/ProModuleDeployers.sol:ProVestingDeployer",
  slidingDeployer:
    "packages/contracts/src/pro/ProModuleDeployers.sol:ProSlidingDeployer",
  priceOracle: "packages/contracts/src/pro/ProPriceOracle.sol:ProPriceOracle",
  reactiveDeployer:
    "packages/contracts/src/pro/ProReactiveDeployer.sol:ProReactiveDeployer",
  linkRegistry:
    "packages/contracts/src/pro/ProLinkRegistry.sol:ProLinkRegistry",
  peakDeployer:
    "packages/contracts/src/pro/ProPeakDeployer.sol:ProPeakDeployer",
  peakRegistry:
    "packages/contracts/src/pro/ProPeakRegistry.sol:ProPeakRegistry",
  beaconDeployer:
    "packages/contracts/src/pro/ProPeakDeployer.sol:ProBeaconDeployer",
  entangledDeployer:
    "packages/contracts/src/pro/ProPeakDeployer.sol:ProEntangledDeployer",
  reactiveValidationChild:
    "packages/contracts/src/pro/ProReactiveValidation.sol:ProReactiveValidation",
} as const);
/** Additive fee source paths never replace the role map for profiles 1–3. */
export const PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS = Object.freeze({
  factory:
    "packages/contracts/src/pro/programs/ProFeeProgramFactory.sol:ProFeeProgramFactory",
  partnerRegistry:
    "packages/contracts/src/pro/programs/ProFeeProgramPartnerRegistry.sol:ProFeeProgramPartnerRegistry",
  tokenDeployer:
    "packages/contracts/src/pro/programs/ProFeeProgramTokenDeployer.sol:ProFeeProgramTokenDeployer",
  curveDeployer:
    "packages/contracts/src/pro/programs/ProFeeProgramCurveDeployer.sol:ProFeeProgramCurveDeployer",
  router:
    "packages/contracts/src/pro/programs/ProFeeProgramRouter.sol:ProFeeProgramRouter",
  programDeployer:
    "packages/contracts/src/pro/programs/ProFeeProgramDeployer.sol:ProFeeProgramDeployer",
  claimProcessor:
    "packages/contracts/src/pro/programs/ProFeeProgramClaimProcessor.sol:ProFeeProgramClaimProcessor",
  programVaultCodeChunk0:
    "packages/contracts/src/pro/programs/ProFeeProgramDeployer.sol:ProFeeProgramCodeChunk",
  programVaultCodeChunk1:
    "packages/contracts/src/pro/programs/ProFeeProgramDeployer.sol:ProFeeProgramCodeChunk",
} as const);
export const PRO_FEE_PROGRAM_VAULT_ARTIFACT =
  "packages/contracts/src/pro/programs/ProFeeProgramVault.sol:ProFeeProgramVault" as const;
export const PRO_FEE_PROGRAM_CURVE_ARTIFACT =
  "packages/contracts/src/pro/programs/ProFeeProgramCurve.sol:ProFeeProgramCurve" as const;
export type ProBootstrapComponent =
  | keyof typeof PRO_BOOTSTRAP_COMPONENT_ARTIFACTS
  | keyof typeof PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS;
export const PRO_BOOTSTRAP_CONSENT_LINK_REGISTRY_ARTIFACT =
  "packages/contracts/src/pro/ProLinkRegistryV2.sol:ProLinkRegistryV2" as const;
/** Selects the reviewed role's exact source identity, never an RPC-derived artifact. */
export function proBootstrapComponentArtifact(
  component: ProBootstrapComponent,
  sourceVersion: 1 | 2 | 3,
) {
  if (![1, 2, 3].includes(sourceVersion))
    throw new Error("Unknown reviewed Bootstrap source version.");
  if (!Object.hasOwn(PRO_BOOTSTRAP_COMPONENT_ARTIFACTS, component))
    throw new Error("Unknown reviewed Bootstrap component role.");
  return component === "linkRegistry" && sourceVersion === 3
    ? PRO_BOOTSTRAP_CONSENT_LINK_REGISTRY_ARTIFACT
    : PRO_BOOTSTRAP_COMPONENT_ARTIFACTS[
        component as keyof typeof PRO_BOOTSTRAP_COMPONENT_ARTIFACTS
      ];
}
/** Explicit source-family selector. Calling the legacy selector with 4 remains an error. */
export function proFeeProgramBootstrapComponentArtifact(
  component: ProBootstrapComponent,
) {
  if (Object.hasOwn(PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS, component))
    return PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS[
      component as keyof typeof PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS
    ];
  return proBootstrapComponentArtifact(component, 3);
}
const mandatory = [
  "factory",
  "partnerRegistry",
  "marketCalendar",
  "ruleValidator",
  "tokenDeployer",
  "policyDeployer",
  "curveDeployer",
  "router",
  "vaultDeployer",
  "vestingDeployer",
] as const;
const bindingReadConcurrency = new WeakMap<PublicClient, number>();
const reviewedBootstrapGetterClients = new WeakSet<PublicClient>();
const canonicalGetterStates = new WeakMap<PublicClient, {
  observations: Map<string, string>;
  permits: Map<string, number>;
  factories: Set<string>;
}>();
// Creation code shipped by the pinned viem 2.56.3 deployless Multicall3 reader.
const REVIEWED_MULTICALL_CREATION_HASH = "0x0388a0d41a63e5bbe5b1005f52975ef622c77817a483f36849c5447365555071";
const observationKey = (method: string, params: unknown) => `${method}:${JSON.stringify(canonicalObservationKey(params))}`;
/** Only this loader's successfully issued v3 infrastructure can select the getter lane. */
export function canAggregateProCanonicalGetters(client: PublicClient, factory: Address, blockHash: Hex): boolean {
  return canonicalGetterStates.get(client)?.factories.has(`${factory.toLowerCase()}:${blockHash.toLowerCase()}`) === true;
}
const reviewedZeroArgumentGetters = new Set([
  "proTokenVersion", "deploymentReady", "factory", "registryVersion", "calendarVersion", "supportedRules",
  "vaultDeployer", "vestingDeployer", "curveDeployer", "componentDeployer", "partnerRegistry", "marketCalendar",
  "ruleValidator", "tokenDeployer", "policyDeployer", "router", "deployerKind", "priceInfrastructureConfigured",
  "reactiveInfrastructureConfigured", "peakInfrastructureConfigured", "slidingDeployer", "slidingDeployerCodeHash",
  "priceOracle", "priceOracleCodeHash", "reactiveDeployer", "reactiveDeployerCodeHash", "linkRegistry", "linkRegistryCodeHash",
  "peakDeployer", "peakDeployerCodeHash", "peakRegistry", "peakRegistryCodeHash", "oracleVersion", "priceUpdater", "priceMaxAgeSeconds",
  "activityRegistry", "deployer", "linkRegistryVersion", "validationChild", "validationVersion", "reactiveParticipantVersion",
  "reactiveConsentVersion", "oracle", "oracleCodeHash", "activityRegistryCodeHash", "beaconDeployer", "beaconDeployerCodeHash",
  "entangledDeployer", "entangledDeployerCodeHash", "moduleRule", "approvedQuoteCount",
  "supportedGraduatingRules", "supportsGraduation", "graduationRegistry", "graduationRegistryCodeHash", "factoryCodeHash",
  "partnerRegistryCodeHash", "graduationGuard", "graduationGuardCodeHash", "graduationVerifier", "graduationVerifierCodeHash",
  "executor", "executorCodeHash", "hook", "hookCodeHash", "poolManager", "poolManagerCodeHash", "positionManager",
  "positionManagerCodeHash", "permit2", "permit2CodeHash", "locker", "lockerCodeHash", "pendingSweepToken", "activeSeedToken",
  "verifiedSeedToken", "available", "guardVersion", "verifierVersion", "registry", "registryCodeHash", "REQUIRED_FLAGS", "feeHook", "positionOwner",
  "curve", "policy", "token", "creator", "totalSupply", "supply", "rulesBitmap", "perpetual", "decimals",
  "name", "symbol", "description", "image", "website", "twitter", "telegram", "quoteAsset", "feeRecipient", "phantomQuote",
  "graduationThreshold", "baseFeeBps", "buyTaxBps", "sellTaxBps", "tokenReserve", "realQuoteReserve", "accruedFees",
  "readyToGraduate", "graduated", "settledTradeCount", "buyerRewards", "minimumRewardBuy", "contributionPerOperation",
  "rulesActive", "contextPending", "migrationPending", "vesting", "contributionVault",
  "owner", "authority", "updater", "maxAgeSeconds", "oracleUpdater", "oracleMaxAgeSeconds",
]);
const reviewedAddressKeyGetters = new Set(["isSystemAddress", "approvedQuotes", "approvedQuoteCodeHash", "reactiveValidationChild",
  "infrastructureAvailable", "curveOf", "policyOf", "creatorOf", "configurationHash", "supplyOf", "tokenOf", "isCurve", "isInfrastructure"]);
type CanonicalGetterContract = Readonly<{ address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }>;
/** Internal SDK reader lane. Call sites contain exact source-reviewed public/pure
 * getter lists, after target runtime/lineage checks. Never pass quotes, authorization,
 * caller-dependent reads, or operations here. Default clients keep individual reads. */
export async function readProCanonicalGetterBatch(
  client: PublicClient, blockHash: Hex, contracts: readonly CanonicalGetterContract[],
): Promise<unknown[]> {
  if (contracts.length < 1 || contracts.length > 256 || !/^0x[0-9a-fA-F]{64}$/.test(blockHash))
    throw new Error("Reviewed getter batch exceeds its finite canonical bound.");
  const state = canonicalGetterStates.get(client);
  const selector = { blockHash, requireCanonical: true as const };
  const encoded = contracts.map(contract => {
    const functions = contract.abi.filter(item => item.type === "function" && item.name === contract.functionName);
    if (functions.length !== 1 || !(functions[0].type === "function") ||
        !["pure", "view"].includes(functions[0].stateMutability) ||
        !(functions[0].inputs.length === 0 && reviewedZeroArgumentGetters.has(contract.functionName) ||
          functions[0].inputs.length === 1 && functions[0].inputs[0].type === "address" && reviewedAddressKeyGetters.has(contract.functionName) ||
          contract.functionName === "validateWiring" && functions[0].inputs.length === 3 && functions[0].inputs.every(input => input.type === "address")))
      throw new Error("Reviewed getter must have one public/pure ABI selector.");
    return { contract, data: encodeFunctionData({ ...contract, functionName: contract.functionName } as never) };
  });
  const decode = (index: number, raw: Hex) => {
    const contract = contracts[index];
    const value = decodeFunctionResult({ abi: contract.abi, functionName: contract.functionName, data: raw });
    if (raw.toLowerCase() !== encodeFunctionResult({ abi: contract.abi, functionName: contract.functionName, result: value } as never).toLowerCase())
      throw new Error("Reviewed getter returned noncanonical ABI bytes: " + contract.functionName + ".");
    return value;
  };
  if (!state) return Promise.all(encoded.map(async ({ contract, data }, index) => decode(index,
    await client.request({ method: "eth_call", params: [{ to: contract.address, data }, selector] } as never) as Hex)));
  const values: unknown[] = new Array(contracts.length);
  const missing: number[] = [];
  encoded.forEach(({ contract, data }, index) => {
    const raw = state.observations.get(observationKey("eth_call", [{ to: contract.address, data }, selector]));
    if (raw === undefined) missing.push(index); else values[index] = decode(index, raw as Hex);
  });
  const completedGroups: { index: number; raw: Hex; value: unknown }[][] = [];
  let next = 0;
  const worker = async () => {
   while (next < missing.length) {
    const offset = next; next += 24;
    const indices = missing.slice(offset, offset + 24);
    const calls = indices.map(index => ({ target: contracts[index].address, allowFailure: true, callData: encoded[index].data }));
    const inner = encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] });
    const permit = `${blockHash.toLowerCase()}:${inner.toLowerCase()}`;
    state.permits.set(permit, (state.permits.get(permit) ?? 0) + 1);
    let raw: Hex | undefined;
    const capture = createPublicClient({ cacheTime: 0, batch: { multicall: false }, transport: custom({
      async request(input) {
        const result = await client.request(input as never);
        if (input.method === "eth_call") raw = result as Hex;
        return result;
      },
    }, { retryCount: 0 }) });
    try {
      await capture.multicall({ contracts: indices.map(index => contracts[index]), ...selector,
        deployless: true, allowFailure: false, batchSize: 1024 } as never);
      if (typeof raw !== "string") throw new Error("Reviewed aggregate return bytes are missing.");
      const results = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: raw });
      if (results.length !== indices.length || raw.toLowerCase() !== encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results }).toLowerCase())
        throw new Error("Reviewed aggregate returned a noncanonical or incomplete result.");
      const completed = results.map((result, position) => {
        if (!result.success) throw new Error("Reviewed aggregate getter failed.");
        return { index: indices[position], raw: result.returnData, value: decode(indices[position], result.returnData) };
      });
      completedGroups.push(completed);
    } finally {
      const remaining = state.permits.get(permit) ?? 0;
      if (remaining <= 1) state.permits.delete(permit); else state.permits.set(permit, remaining - 1);
    }
  }
  };
  // Two independent getter batches use the existing transport lane; never
  // increase its HTTP concurrency. No observations are retained on partial failure.
  await Promise.all(Array.from({ length: Math.min(2, Math.ceil(missing.length / 24)) }, worker));
  completedGroups.flat().forEach(({ index, raw, value }) => {
    values[index] = value;
    if (state.observations.size >= 512) state.observations.delete(state.observations.keys().next().value!);
    state.observations.set(observationKey("eth_call", [{ to: contracts[index].address, data: encoded[index].data }, selector]), raw);
  });
  return values;
}
function canonicalObservationKey(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalObservationKey);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonicalObservationKey(entry)]));
  return value;
}
/** A single loader can reuse completed, immutable observations at an exact canonical
 * block hash. Full parameters remain part of the key; chain and header guards always
 * reach the original client. Discard this client after the loader or review completes. */
export function createProCanonicalReadClient(
  client: PublicClient,
  signal?: AbortSignal,
  options: Readonly<{ aggregateReviewedBootstrapGetters?: true }> = {},
): PublicClient {
  const aggregateReviewedGetters = options.aggregateReviewedBootstrapGetters === true;
  const observations = new Map<string, string>();
  const getterState = { observations, permits: new Map<string, number>(), factories: new Set<string>() };
  signal?.addEventListener("abort", () => observations.clear(), { once: true });
  const wrapped = createPublicClient({
    chain: client.chain,
    cacheTime: 0,
    batch: { multicall: false },
    transport: custom({
      async request(input) {
        signal?.throwIfAborted();
        const serialized = JSON.stringify(input.params ?? []);
        const params = JSON.parse(serialized) as unknown[];
        const selector = params[1];
        const pinned = selector !== null && typeof selector === "object" &&
          "requireCanonical" in selector && selector.requireCanonical === true &&
          "blockHash" in selector && typeof selector.blockHash === "string" &&
          /^0x[0-9a-fA-F]{64}$/.test(selector.blockHash);
        const call = params[0];
        const aggregate = aggregateReviewedGetters && input.method === "eth_call" &&
          call !== null && typeof call === "object" && !("to" in call);
        if (aggregate) {
          // Only viem's deployless wrapper at an exact canonical hash belongs to
          // this read lane. Keep its bounded getter batch independent of caller,
          // value, overrides and the unpinned transaction simulation lane.
          if (!pinned || params.length !== 2 || Object.keys(selector).length !== 2 ||
            Object.keys(call).length !== 1 || !("data" in call) ||
            typeof call.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(call.data) ||
            !call.data.startsWith(deploylessCallViaBytecodeBytecode) ||
            (call.data.length - 2) / 2 > 24 * 1024)
            throw new Error("Reviewed getter aggregate has invalid canonical call parameters.");
          const [creationCode, inner] = decodeAbiParameters(parseAbiParameters("bytes,bytes"), sliceHex(call.data as Hex, size(deploylessCallViaBytecodeBytecode)));
          const permit = `${(selector.blockHash as string).toLowerCase()}:${inner.toLowerCase()}`;
          const decoded = decodeFunctionData({ abi: multicall3Abi, data: inner });
          if (keccak256(creationCode) !== REVIEWED_MULTICALL_CREATION_HASH ||
              decoded.functionName !== "aggregate3" || decoded.args[0].length < 1 || decoded.args[0].length > 24 ||
              !getterState.permits.has(permit))
            throw new Error("Reviewed aggregate is outside its exact registered getter batch.");
          params[0] = { data: call.data, gas: "0x4c4b40" }; // Five million gas; no funding or sender.
        }
        const reusable = pinned && !aggregate && serialized.length <= 16_384 &&
          ["eth_call", "eth_getCode", "eth_getBalance"].includes(input.method);
        const key = reusable ? observationKey(input.method, params) : undefined;
        if (key !== undefined && observations.has(key)) return observations.get(key)!;
        const result: unknown = await client.request({ method: input.method, params } as never);
        signal?.throwIfAborted();
        if (aggregate && (typeof result !== "string" ||
          !/^0x(?:[0-9a-fA-F]{2})*$/.test(result) || (result.length - 2) / 2 > 32 * 1024))
          throw new Error("Reviewed getter aggregate has invalid or oversized return bytes.");
        // Pending reads, errors and large/nonprimitive results are never retained.
        if (key !== undefined && typeof result === "string" && /^0x[0-9a-fA-F]*$/.test(result) && result.length <= 131_072) {
          if (observations.size >= 512) observations.delete(observations.keys().next().value!);
          observations.set(key, result);
        }
        return result;
      },
    }, { retryCount: 0 }),
  }) as PublicClient;
  const concurrency = bindingReadConcurrency.get(client);
  if (concurrency !== undefined) bindingReadConcurrency.set(wrapped, concurrency);
  if (aggregateReviewedGetters) {
    reviewedBootstrapGetterClients.add(wrapped);
    canonicalGetterStates.set(wrapped, getterState);
  }
  return wrapped;
}
/** One loader's immutable canonical observations; never shared between RPC clients or refreshes. */
export type ProBootstrapReadScope = Readonly<{ schema: "xoox.pro-bootstrap.read-scope" }>;
const readScopes = new WeakMap<ProBootstrapReadScope, {
  client: PublicClient;
  proofs: Map<string, ProBootstrapProof>;
}>();
export function createProBootstrapReadScope(client: PublicClient): ProBootstrapReadScope {
  const scope = Object.freeze({ schema: "xoox.pro-bootstrap.read-scope" as const });
  readScopes.set(scope, { client, proofs: new Map() });
  return scope;
}
export function assertProBootstrapReadScope(client: PublicClient, scope: ProBootstrapReadScope): void {
  const state = readScopes.get(scope);
  if (!state) throw new Error("Pro source reuse requires an issued read scope.");
  if (state.client !== client) throw new Error("Pro source reuse requires the same RPC client.");
}
/** Internal compound-reader admission. A copied selector/proof or foreign
 * client/scope/manifest can never select a previously issued source. */
export function assertProBootstrapProofInScope(
  client: PublicClient,
  scope: ProBootstrapReadScope,
  proof: ProBootstrapProof,
  manifest: ProBootstrapSourceManifest,
): void {
  assertProBootstrapReadScope(client, scope);
  assertProBootstrapProof(proof);
  const reviewed = captureManifest(manifest, proof.factory);
  const key = JSON.stringify([reviewed, proof.blockNumber, proof.blockHash], (_key, value) =>
    typeof value === "bigint" ? value.toString() : value);
  if (readScopes.get(scope)!.proofs.get(key) !== proof)
    throw new Error("Compound source requires the same issued client/scope/manifest proof.");
}
/** Internal initial reader owns its one canonical wrapper and abort lifetime. */
export function assertProInitialBaseClient(client: PublicClient): void {
  if (reviewedBootstrapGetterClients.has(client))
    throw new Error("Initial compound reader requires the base RPC client.");
}
/** Scheduling only: dedicated RPC clients can opt into finite binding batches.
 * Source validation and canonical selectors are unchanged; unregistered clients use eight. */
export function setProBootstrapBindingReadConcurrency(
  client: PublicClient,
  maximum: number,
): void {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20)
    throw new Error(
      "Bootstrap binding read concurrency must be an integer from 1 through 20.",
    );
  bindingReadConcurrency.set(client, maximum);
}
type MandatoryComponent = (typeof mandatory)[number];
const optionalGroups = Object.freeze({
  price: ["slidingDeployer", "priceOracle"],
  reactive: ["reactiveDeployer", "linkRegistry"],
  peak: ["peakDeployer", "peakRegistry", "beaconDeployer", "entangledDeployer"],
} as const);
export type ProBootstrapConfiguration = Readonly<{
  price: boolean;
  reactive: boolean;
  peak: boolean;
}>;
type Components<T> = Readonly<
  Record<MandatoryComponent, T> &
    Partial<Record<Exclude<ProBootstrapComponent, MandatoryComponent>, T>>
>;
export type ProBootstrapSourceArtifact = Readonly<{
  artifact:
    | (typeof PRO_BOOTSTRAP_COMPONENT_ARTIFACTS)[keyof typeof PRO_BOOTSTRAP_COMPONENT_ARTIFACTS]
    | (typeof PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS)[keyof typeof PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS]
    | typeof PRO_BOOTSTRAP_CONSENT_LINK_REGISTRY_ARTIFACT;
  address: Address;
  runtimeCodeHash: Hex;
}>;
/**
 * TRUSTED INPUT from reviewed deployment records, never contract getters or a user draft.
 * Each runtime hash must come from the reviewed artifact after its exact deployment
 * immutables are applied. Attesting a deployer also attests its embedded product creation
 * code; individual launched products still need registration/receipt/state verification.
 * These hashes establish reviewed source only as strongly as this external review record.
 * Version 1 explicitly reviews embedded Reactive validation. Version 2 reviews the
 * independently pinned stateless child; when Reactive is configured its artifact is mandatory.
 * Version 3 additionally reviews the pending-participant Registry and actual Factory entry version.
 */
export type ProFeeProgramSourceReview = Readonly<{
  version: 4;
  vaultArtifact: typeof PRO_FEE_PROGRAM_VAULT_ARTIFACT;
  /** Independent compiler-artifact creation-code hash, never an RPC getter. */
  vaultCreationCodeHash: Hex;
  curveArtifact: typeof PRO_FEE_PROGRAM_CURVE_ARTIFACT;
  curveCreationCodeHash: Hex;
  /** Independent deployment-constructor review, including builtin native index0. */
  claimPolicies: readonly ProFeeProgramClaimPolicy[];
}>;
/** One ERC20 quote the owner approved on the Factory before it was sealed, with the runtime hash it was reviewed with. */
export type ProBootstrapReviewedQuote = Readonly<{
  address: Address;
  runtimeCodeHash: Hex;
}>;
/** The most ERC20 quotes a reviewed manifest may list; the Factory owner approves a handful. */
export const PRO_BOOTSTRAP_MAX_REVIEWED_QUOTES = 64;
export type ProBootstrapSourceManifest = Readonly<{
  schema: typeof PRO_BOOTSTRAP_SOURCE_SCHEMA;
  version: 1 | 2 | 3 | 4;
  reviewId: string;
  chainId: bigint;
  factory: Address;
  configuration: ProBootstrapConfiguration;
  artifacts: Components<ProBootstrapSourceArtifact>;
  /** Mandatory only for explicit reviewed profile 4; forbidden for profiles 1–3. */
  feePrograms?: ProFeeProgramSourceReview;
  /**
   * The exact ERC20 quote list of a Factory with the on-chain quote allowlist (native MON is implicit and not listed;
   * an empty list means native only). Present for profiles 1–3 of a Factory that has the allowlist; absent for the
   * earlier Core generation, which accepts any quote contract and is read exactly as before. Mandatory for profile 4:
   * the fee-program Factory was never deployed without the allowlist, so its proof always verifies the list.
   */
  quotes?: readonly ProBootstrapReviewedQuote[];
}>;
export type ProBootstrapSnapshotSelector = Readonly<{
  blockNumber: bigint;
  blockHash: Hex;
  chainId?: bigint;
  blockTimestamp?: bigint;
}>;
export type ProBootstrapProof = Readonly<{
  schema: typeof PRO_BOOTSTRAP_PROOF_SCHEMA;
  version: 1;
  factory: Address;
  partnerRegistry: Address;
  owner: Address;
  routerAuthority: Address;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  supportedBitmap: bigint;
  /** Read from the reviewed market calendar at the proof's block; see ProCoreGeneration. */
  coreGeneration: ProCoreGeneration;
  sourceReview: Readonly<{
    schema: typeof PRO_BOOTSTRAP_SOURCE_SCHEMA;
    version: 1 | 2 | 3 | 4;
    reviewId: string;
  }>;
  configuration: ProBootstrapConfiguration;
  components: Components<
    Readonly<{
      artifact: ProBootstrapSourceArtifact["artifact"];
      address: Address;
      codeHash: Hex;
    }>
  >;
  /** Authenticated publisher identity; source proof does not establish economic accuracy. */
  price?: Readonly<{ updater: Address; maxAgeSeconds: number }>;
  /** Explicit reviewed Reactive source profile; absent when Reactive is unconfigured. */
  reactiveValidationProfile?: "embedded-v1" | "child-v1";
  /** Only issued for the genuine configured v3 participant-consent source. */
  reactiveConsentProfile?: "pending-participant-v2";
  /**
   * Present exactly when the reviewed manifest listed quotes: the ERC20 quotes the Factory approved (native MON is
   * implicit), each pinned by the runtime hash read at the proof's block. Absent for the earlier Core generation,
   * where the Factory does not restrict a launch's quote asset.
   */
  approvedQuotes?: readonly Readonly<{ address: Address; codeHash: Hex }>[];
  /** Independent revenue source version; core/policy proof.version stays 1. */
  programSource?: Readonly<{
    version: 4;
    programDeployer: Address;
    claimProcessor: Address;
    claimProcessorCodeHash: Hex;
    claimPolicies: readonly ProFeeProgramClaimPolicy[];
    vaultArtifact: typeof PRO_FEE_PROGRAM_VAULT_ARTIFACT;
    vaultCreationCodeHash: Hex;
    vaultCreationCode: Hex;
    curveArtifact: typeof PRO_FEE_PROGRAM_CURVE_ARTIFACT;
    curveCreationCodeHash: Hex;
  }>;
}>;

export const proBootstrapAbi = parseAbi([
  "function proTokenVersion() view returns(uint256)",
  "function deploymentReady() view returns(bool)",
  "function supportedRules() view returns(uint256)",
  "function owner() view returns(address)",
  "function factory() view returns(address)",
  "function partnerRegistry() view returns(address)",
  "function marketCalendar() view returns(address)",
  "function ruleValidator() view returns(address)",
  "function tokenDeployer() view returns(address)",
  "function policyDeployer() view returns(address)",
  "function curveDeployer() view returns(address)",
  "function router() view returns(address)",
  "function vaultDeployer() view returns(address)",
  "function vestingDeployer() view returns(address)",
  "function componentDeployer() view returns(address)",
  "function authority() view returns(address)",
  "function deployerKind() view returns(uint256)",
  "function registryVersion() view returns(uint256)",
  "function calendarVersion() view returns(uint256)",
  "function isSystemAddress(address component) view returns(bool)",
  "function priceInfrastructureConfigured() view returns(bool)",
  "function reactiveInfrastructureConfigured() view returns(bool)",
  "function peakInfrastructureConfigured() view returns(bool)",
  "function slidingDeployer() view returns(address)",
  "function priceOracle() view returns(address)",
  "function priceUpdater() view returns(address)",
  "function priceMaxAgeSeconds() view returns(uint32)",
  "function slidingDeployerCodeHash() view returns(bytes32)",
  "function priceOracleCodeHash() view returns(bytes32)",
  "function oracleVersion() view returns(uint256)",
  "function updater() view returns(address)",
  "function maxAgeSeconds() view returns(uint32)",
  "function reactiveDeployer() view returns(address)",
  "function linkRegistry() view returns(address)",
  "function reactiveDeployerCodeHash() view returns(bytes32)",
  "function linkRegistryCodeHash() view returns(bytes32)",
  "function linkRegistryVersion() view returns(uint256)",
  "function reactiveParticipantVersion() view returns(uint256)",
  "function reactiveConsentVersion() view returns(uint256)",
  "function validationChild() view returns(address)",
  "function validationVersion() view returns(uint256)",
  "function REACTIVE_VALIDATION_CODE_HASH() view returns(bytes32)",
  "function reactiveValidationChild(address helper) view returns(address)",
  "function activityRegistry() view returns(address)",
  "function deployer() view returns(address)",
  "function peakDeployer() view returns(address)",
  "function peakRegistry() view returns(address)",
  "function peakDeployerCodeHash() view returns(bytes32)",
  "function peakRegistryCodeHash() view returns(bytes32)",
  "function beaconDeployer() view returns(address)",
  "function entangledDeployer() view returns(address)",
  "function beaconDeployerCodeHash() view returns(bytes32)",
  "function entangledDeployerCodeHash() view returns(bytes32)",
  "function moduleRule() view returns(uint8)",
  "function oracle() view returns(address)",
  "function oracleCodeHash() view returns(bytes32)",
  "function activityRegistryCodeHash() view returns(bytes32)",
  "function oracleUpdater() view returns(address)",
  "function oracleMaxAgeSeconds() view returns(uint32)",
  "function infrastructureAvailable(address activity) view returns(bool)",
  "function feeProgramVersion() view returns(uint256)",
  "function programDeployer() view returns(address)",
  "function programDeployerCodeHash() view returns(bytes32)",
  "function claimProcessor() view returns(address)",
  "function claimProcessorCodeHash() view returns(bytes32)",
  "function claimProcessorVersion() view returns(uint256)",
  "function policyCount() view returns(uint256)",
  "function policyAt(uint256 index) view returns(uint8 assetRole,address asset,bytes32 runtimeCodeHash,uint8 decimals,uint256 minimumClaim)",
  "function decimals() view returns(uint8)",
  "function codeChunk0() view returns(address)",
  "function codeChunk1() view returns(address)",
  "function codeChunkHash0() view returns(bytes32)",
  "function codeChunkHash1() view returns(bytes32)",
  "function vaultCreationCodeHash() view returns(bytes32)",
  "function curveCreationCodeHash() view returns(bytes32)",
  "function quoteAllowlistVersion() view returns(uint256)",
  "function approvedQuotes(address quote) view returns(bool)",
  "function approvedQuoteCodeHash(address quote) view returns(bytes32)",
  "function approvedQuoteCount() view returns(uint256)",
  "function approvedQuoteAt(uint256 index) view returns(address)",
]);
type ReadName = (typeof proBootstrapAbi)[number]["name"];
const issuedProofs = new WeakMap<object, ProBootstrapSourceManifest>();
const ALL_RULES = (1n << 23n) - 1n;
/**
 * Calendar generations a reviewed Factory may carry. Version 1 is the Core generation live on Monad testnet; version 2
 * keeps Session Clock trading open once its calendar tables end. The reviewed manifest pins the exact runtime hash of
 * whichever calendar the Factory names, so the version only labels it and one SDK build serves both generations.
 */
const MARKET_CALENDAR_VERSIONS = [1n, 2n] as const;
/**
 * The Core contract generation a bootstrap proof attests, told apart by the market calendar the Factory creates.
 * Generation 1 is the set activated on Monad testnet on 2026-10-03 (calendar version 1). Generation 2 (calendar
 * version 2) comes only from a Factory that carries the Session Clock, Value Ladder and Release Schedule fixes of
 * the 2026-10 audit, so wording that promises those behaviours may only be shown for a proof with generation 2.
 */
export type ProCoreGeneration = 1 | 2;
const ZERO_HASH = ("0x" + "00".repeat(32)) as Hex;
const same = (actual: unknown, expected: unknown) =>
  typeof actual === "string" && typeof expected === "string"
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
/** `expected` may be a list of accepted values; any one of them satisfies the binding. */
function requireEqual(actual: unknown, expected: unknown, label: string) {
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.some((value) => same(actual, value)))
    throw new Error(
      "Bootstrap " + label + " does not match its reviewed binding.",
    );
}
function address(value: unknown, label: string): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value, { strict: true }) ||
    same(value, zeroAddress)
  )
    throw new Error(label + " must be a nonzero valid address.");
  return getAddress(value);
}
function hash(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[\da-fA-F]{64}$/.test(value) ||
    same(value, ZERO_HASH)
  )
    throw new Error(label + " must be a nonzero bytes32 hash.");
  return value.toLowerCase() as Hex;
}
function uint(value: unknown, bits: number, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value >= 1n << BigInt(bits))
    throw new Error(label + " must be a uint" + bits + " bigint.");
  return value;
}
function exactKeys(value: unknown, expected: readonly string[], label: string) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== expected.length ||
    expected.some((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      return !descriptor || !("value" in descriptor);
    })
  )
    throw new Error(
      label +
        " requires exact configured keys, without extra or missing roles.",
    );
}
function configuredNames(
  configuration: ProBootstrapConfiguration,
  version: 1 | 2 | 3 | 4,
): ProBootstrapComponent[] {
  return [
    ...mandatory,
    ...Object.entries(optionalGroups).flatMap(([group, names]) =>
      configuration[group as keyof ProBootstrapConfiguration] ? [...names] : [],
    ),
    ...(version >= 2 && configuration.reactive
      ? (["reactiveValidationChild"] as const)
      : []),
    ...(version === 4
      ? ([
          "programDeployer",
          "claimProcessor",
          "programVaultCodeChunk0",
          "programVaultCodeChunk1",
        ] as const)
      : []),
  ];
}
function captureManifest(
  value: ProBootstrapSourceManifest,
  factory: Address,
): ProBootstrapSourceManifest {
  exactKeys(
    value,
    [
      "schema",
      "version",
      "reviewId",
      "chainId",
      "factory",
      "configuration",
      "artifacts",
      ...(value?.version === 4 ? ["feePrograms", "quotes"] : []),
      ...(value?.version !== 4 && value && Object.hasOwn(value, "quotes")
        ? ["quotes"]
        : []),
    ],
    "Reviewed bootstrap manifest",
  );
  if (
    value.schema !== PRO_BOOTSTRAP_SOURCE_SCHEMA ||
    ![1, 2, 3, 4].includes(value.version) ||
    typeof value.reviewId !== "string" ||
    !value.reviewId.trim() ||
    value.reviewId.length > 256 ||
    uint(value.chainId, 256, "Reviewed chain") === 0n ||
    !same(value.factory, factory)
  )
    throw new Error(
      "A reviewed bootstrap source manifest for this Factory and chain is required.",
    );
  exactKeys(
    value.configuration,
    ["price", "reactive", "peak"],
    "Bootstrap configuration",
  );
  if (
    Object.values(value.configuration).some(
      (flag) => typeof flag !== "boolean",
    ) ||
    (value.configuration.peak && !value.configuration.price)
  )
    throw new Error(
      "Reviewed bootstrap configuration requires boolean flags and Peak requires price infrastructure.",
    );
  const configuration = Object.freeze({ ...value.configuration });
  let feePrograms: ProFeeProgramSourceReview | undefined;
  if (value.version === 4) {
    exactKeys(
      value.feePrograms,
      [
        "version",
        "vaultArtifact",
        "vaultCreationCodeHash",
        "curveArtifact",
        "curveCreationCodeHash",
        "claimPolicies",
      ],
      "Reviewed fee program creation source",
    );
    if (
      value.feePrograms!.version !== 4 ||
      value.feePrograms!.vaultArtifact !== PRO_FEE_PROGRAM_VAULT_ARTIFACT ||
      value.feePrograms!.curveArtifact !== PRO_FEE_PROGRAM_CURVE_ARTIFACT
    )
      throw new Error("Unexpected fee program Vault source artifact.");
    feePrograms = Object.freeze({
      version: 4,
      vaultArtifact: PRO_FEE_PROGRAM_VAULT_ARTIFACT,
      vaultCreationCodeHash: hash(
        value.feePrograms!.vaultCreationCodeHash,
        "Reviewed Vault creation source",
      ),
      curveArtifact: PRO_FEE_PROGRAM_CURVE_ARTIFACT,
      curveCreationCodeHash: hash(
        value.feePrograms!.curveCreationCodeHash,
        "Reviewed Curve creation source",
      ),
      claimPolicies: captureProFeeProgramClaimPolicies(
        value.feePrograms!.claimPolicies,
      ),
    });
  }
  const names = configuredNames(configuration, value.version);
  exactKeys(value.artifacts, names, "Reviewed bootstrap artifacts");
  const artifacts = {} as Record<
    ProBootstrapComponent,
    ProBootstrapSourceArtifact
  >;
  for (const name of names) {
    const artifact = value.artifacts[name]!;
    exactKeys(
      artifact,
      ["artifact", "address", "runtimeCodeHash"],
      name + " reviewed artifact",
    );
    if (
      artifact.artifact !==
      (value.version === 4
        ? proFeeProgramBootstrapComponentArtifact(name)
        : proBootstrapComponentArtifact(name, value.version))
    )
      throw new Error("Unexpected reviewed source artifact for " + name + ".");
    artifacts[name] = Object.freeze({
      artifact: artifact.artifact,
      address: address(artifact.address, name),
      runtimeCodeHash: hash(
        artifact.runtimeCodeHash,
        name + " reviewed runtime",
      ),
    });
  }
  requireEqual(artifacts.factory.address, factory, "manifest Factory address");
  if (
    new Set(names.map((name) => artifacts[name].address.toLowerCase())).size !==
    names.length
  )
    throw new Error("Reviewed bootstrap component addresses must be distinct.");
  let quotes: readonly ProBootstrapReviewedQuote[] | undefined;
  if (Object.hasOwn(value, "quotes")) {
    if (
      !Array.isArray(value.quotes) ||
      value.quotes.length > PRO_BOOTSTRAP_MAX_REVIEWED_QUOTES
    )
      throw new Error(
        "Reviewed quotes must be a bounded list for a Factory with the quote allowlist.",
      );
    quotes = Object.freeze(
      value.quotes.map((entry, index) => {
        exactKeys(
          entry,
          ["address", "runtimeCodeHash"],
          "Reviewed quote " + index,
        );
        return Object.freeze({
          address: address(entry.address, "Reviewed quote " + index),
          runtimeCodeHash: hash(
            entry.runtimeCodeHash,
            "Reviewed quote " + index + " runtime",
          ),
        });
      }),
    );
    const taken = new Set(names.map((name) => artifacts[name].address));
    if (
      quotes.some(
        (quote) =>
          taken.has(quote.address) ||
          quotes!.filter((other) => other.address === quote.address).length !==
            1,
      )
    )
      throw new Error(
        "Reviewed quotes must be distinct from each other and from every bootstrap component.",
      );
  }
  return Object.freeze({
    schema: PRO_BOOTSTRAP_SOURCE_SCHEMA,
    version: value.version,
    reviewId: value.reviewId,
    chainId: value.chainId,
    factory,
    configuration,
    artifacts: Object.freeze(artifacts),
    ...(feePrograms ? { feePrograms } : {}),
    ...(quotes ? { quotes } : {}),
  });
}
function captureSelector(value?: ProBootstrapSnapshotSelector) {
  if (value === undefined) return undefined;
  return Object.freeze({
    blockNumber: uint(value?.blockNumber, 256, "Selected bootstrap block"),
    blockHash: hash(value?.blockHash, "Selected bootstrap block hash"),
    ...(value.chainId === undefined
      ? {}
      : { chainId: uint(value.chainId, 256, "Selected bootstrap chain") }),
    ...(value.blockTimestamp === undefined
      ? {}
      : {
          blockTimestamp: uint(
            value.blockTimestamp,
            64,
            "Selected bootstrap timestamp",
          ),
        }),
  });
}
/** Only an explicit empty EVM revert proves an old source's selector is absent.
 * Transport/canonical/decode failures must never become a legacy profile fallback. */
function isEmptyExecutionRevert(error: unknown): boolean {
  const visited = new Set<object>();
  let current: unknown = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const rpc = current as {
      code?: unknown;
      data?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      rpc.code === 3 &&
      rpc.data === "0x" &&
      typeof rpc.message === "string" &&
      /^execution reverted$/i.test(rpc.message.trim())
    )
      return true;
    current = rpc.cause;
  }
  return false;
}
/** Issuance is separate from freshness; consumers must bind this exact proof to their current snapshot. */
export function assertProBootstrapProof(
  value: unknown,
): asserts value is ProBootstrapProof {
  if (!value || typeof value !== "object" || !issuedProofs.has(value))
    throw new Error(
      "Bootstrap proof must come from the canonical reviewed source reader.",
    );
}
/**
 * Refuses a launch quote that a Factory with the on-chain allowlist would refuse, before anything is signed. Native MON is
 * always allowed. The earlier Core generation has no allowlist (the proof lists no quotes), so nothing is refused here.
 */
export function assertProBootstrapQuotes(
  proof: ProBootstrapProof,
  quotes: readonly Address[],
): void {
  assertProBootstrapProof(proof);
  if (!proof.approvedQuotes) return;
  const approved = new Set(
    proof.approvedQuotes.map((quote) => quote.address.toLowerCase()),
  );
  for (const quote of quotes) {
    if (same(quote, zeroAddress)) continue;
    const value = address(quote, "Quote asset");
    if (!approved.has(value.toLowerCase()))
      throw new Error(
        "This quote asset is not on the approved list of the Pro Factory, so a launch against it would be refused.",
      );
  }
}
/**
 * The ERC20 quotes the owner approves on a Core Factory before sealing it: every non-native quote of the deployment's
 * trading pair configuration (WMON and every other quote the web offers), each once. The reviewed manifest `quotes`
 * must list exactly these, and the proof then confirms the Factory approved exactly these.
 */
export function proCoreQuoteApprovals(
  quoteAssets: readonly Readonly<{ address: string }>[],
): readonly Address[] {
  const seen = new Set<Address>();
  for (const asset of quoteAssets) {
    if (same(asset.address, zeroAddress)) continue;
    seen.add(address(asset.address, "Configured quote asset"));
  }
  return Object.freeze([...seen]);
}
/**
 * Runner gate for the owner's quote approvals. Approvals are sealed by `finalizeDeployment` and the bootstrap proof above
 * can only be issued for a sealed Factory, so a wrong approval list would otherwise surface only after it can no longer
 * be corrected. The activation runner calls this right before it signs the finalize transaction, with the exact quote
 * list of the reviewed manifest (`proCoreQuoteApprovals` of the deployment's quote list, with each quote's runtime hash).
 * It refuses a sealed Factory, a Factory without the allowlist, an `approvedQuoteCount` that differs from the list,
 * a missing approval flag or pinned hash, a quote whose deployed code is not the reviewed code, a system address, and an
 * approved quote that is not on the list or is listed twice. Native MON must be approved implicitly with a zero pin.
 * Everything is read at one canonical block, which is returned as evidence.
 */
export async function assertProQuoteApprovalsBeforeFinalize(
  client: PublicClient,
  factory: Address,
  quotes: readonly ProBootstrapReviewedQuote[],
): Promise<
  Readonly<{ blockNumber: bigint; blockHash: Hex; approvedQuoteCount: number }>
> {
  const target = address(factory, "Pro Factory");
  if (
    !Array.isArray(quotes) ||
    quotes.length > PRO_BOOTSTRAP_MAX_REVIEWED_QUOTES
  )
    throw new Error(
      "Reviewed quotes must be a bounded list for a Factory with the quote allowlist.",
    );
  const reviewed = quotes.map((entry, index) => {
    exactKeys(entry, ["address", "runtimeCodeHash"], "Reviewed quote " + index);
    return Object.freeze({
      address: address(entry.address, "Reviewed quote " + index),
      runtimeCodeHash: hash(
        entry.runtimeCodeHash,
        "Reviewed quote " + index + " runtime",
      ),
    });
  });
  const listed = new Set(reviewed.map((quote) => quote.address));
  if (listed.size !== reviewed.length)
    throw new Error("Reviewed quotes must be distinct from each other.");
  const blockNumber = uint(
    await client.getBlockNumber({ cacheTime: 0 }),
    256,
    "Pre-finalize block",
  );
  const block = await client.getBlock({ blockNumber });
  requireEqual(block.number, blockNumber, "requested mined block number");
  const blockHash = hash(block.hash, "Pre-finalize block hash");
  const pinned = Object.freeze({ blockHash, requireCanonical: true as const });
  const read = (functionName: ReadName, args?: readonly unknown[]) =>
    client.readContract({
      address: target,
      abi: proBootstrapAbi,
      functionName,
      ...(args ? { args } : {}),
      ...pinned,
    } as never);
  if ((await read("deploymentReady")) !== false)
    throw new Error(
      "This Factory is already sealed by finalizeDeployment, so its quote approvals can no longer be corrected.",
    );
  try {
    requireEqual(
      await read("quoteAllowlistVersion"),
      1n,
      "Factory.quoteAllowlistVersion",
    );
  } catch (cause) {
    throw new Error("Factory does not prove the quote allowlist.", { cause });
  }
  requireEqual(
    await read("approvedQuoteCount"),
    BigInt(reviewed.length),
    "approvedQuoteCount",
  );
  requireEqual(
    await read("approvedQuotes", [zeroAddress]),
    true,
    "approvedQuotes (native MON)",
  );
  requireEqual(
    await read("approvedQuoteCodeHash", [zeroAddress]),
    ZERO_HASH,
    "approvedQuoteCodeHash (native MON)",
  );
  for (const quote of reviewed) {
    const runtime = await client.getCode({ address: quote.address, ...pinned });
    if (typeof runtime !== "string" || !/^0x(?:[\da-fA-F]{2})+$/.test(runtime))
      throw new Error("A reviewed quote has no valid contract runtime code.");
    requireEqual(
      keccak256(runtime),
      quote.runtimeCodeHash,
      "quote runtime hash",
    );
    requireEqual(
      await read("approvedQuotes", [quote.address]),
      true,
      "approvedQuotes",
    );
    requireEqual(
      await read("approvedQuoteCodeHash", [quote.address]),
      quote.runtimeCodeHash,
      "approvedQuoteCodeHash",
    );
    requireEqual(
      await read("isSystemAddress", [quote.address]),
      false,
      "isSystemAddress",
    );
  }
  const seen = new Set<Address>();
  for (let index = 0; index < reviewed.length; index++) {
    const approved = address(
      await read("approvedQuoteAt", [BigInt(index)]),
      "Listed quote",
    );
    if (!listed.has(approved) || seen.has(approved))
      throw new Error(
        "Factory approves a quote that is not on the reviewed list, or lists one twice.",
      );
    seen.add(approved);
  }
  return Object.freeze({
    blockNumber,
    blockHash,
    approvedQuoteCount: reviewed.length,
  });
}
/**
 * The quote options a creator may pick. With the allowlist proven, only native MON and the listed ERC20 quotes remain;
 * without it (the earlier generation, or a proof not issued yet) the configured list is shown unchanged.
 */
export function proOfferedQuoteAssets<T extends Readonly<{ address: string }>>(
  quoteAssets: readonly T[],
  proof?: Pick<ProBootstrapProof, "approvedQuotes">,
): readonly T[] {
  const approved = proof?.approvedQuotes;
  if (!approved) return quoteAssets;
  const listed = new Set(approved.map((quote) => quote.address.toLowerCase()));
  return quoteAssets.filter(
    (asset) =>
      same(asset.address, zeroAddress) ||
      listed.has(asset.address.toLowerCase()),
  );
}
/** Retains only the originally captured trusted deployment record, never RPC-derived source attestations. */
export function proBootstrapManifestFromProof(
  value: ProBootstrapProof,
): ProBootstrapSourceManifest {
  assertProBootstrapProof(value);
  return issuedProofs.get(value)!;
}

/**
 * Source attestation for the finalized ordinary bootstrap and genuinely configured optional
 * creation sources. All reads use one canonical EIP-1898 block; no latest/number fallback.
 * This does not attest external rule assets/DEX routers, oracle economic accuracy, or an LP receipt.
 */
export async function readProBootstrapInfrastructure(
  client: PublicClient,
  factory: Address,
  manifest: ProBootstrapSourceManifest,
  selector?: ProBootstrapSnapshotSelector,
  readScope?: ProBootstrapReadScope,
): Promise<ProBootstrapProof> {
  if (readScope) assertProBootstrapReadScope(client, readScope);
  // Capture scheduling once before any await; changing a client's registration
  // cannot alter the finite batches of an already-running canonical proof.
  const maximumBindingReads = bindingReadConcurrency.get(client) ?? 8;
  const target = address(factory, "Pro Factory");
  const reviewed = captureManifest(manifest, target);
  const aggregateReviewedBindings = reviewed.version === 3 && reviewedBootstrapGetterClients.has(client);
  const selected = captureSelector(selector);
  if (selected?.chainId !== undefined)
    requireEqual(selected.chainId, reviewed.chainId, "selected reviewed chain");
  // A supplied selector already fixes the requested number. Read both fresh
  // guards together, then validate them before querying any source state.
  const [rawChain, selectedBlock] = selected
    ? await Promise.all([
        client.getChainId(), client.getBlock({ blockNumber: selected.blockNumber }),
      ])
    : [await client.getChainId(), undefined] as const;
  if (!Number.isSafeInteger(rawChain) || rawChain < 1)
    throw new Error("RPC returned an invalid bootstrap chain ID.");
  const chainId = BigInt(rawChain);
  requireEqual(chainId, reviewed.chainId, "reviewed chain");
  const blockNumber =
    selected?.blockNumber ??
    uint(await client.getBlockNumber({ cacheTime: 0 }), 256, "Bootstrap block");
  const before = selectedBlock ?? await client.getBlock({ blockNumber });
  requireEqual(before.number, blockNumber, "requested mined block number");
  const blockTimestamp = uint(
    before.timestamp,
    64,
    "Bootstrap block timestamp",
  );
  const blockHash = hash(before.hash, "Bootstrap block hash");
  if (selected) {
    requireEqual(
      blockHash,
      selected.blockHash,
      "selected canonical block hash",
    );
    if (selected.blockTimestamp !== undefined)
      requireEqual(
        blockTimestamp,
        selected.blockTimestamp,
        "selected canonical timestamp",
      );
  }
  // All source values are immutable at this exact canonical hash. Keep the
  // original full attestation for default callers and only reuse genuine
  // completed proofs within an explicitly issued, finite loader scope.
  const scopeState = readScope ? readScopes.get(readScope)! : undefined;
  const scopeKey = scopeState
    ? JSON.stringify([reviewed, blockNumber, blockHash], (_key, value) =>
        typeof value === "bigint" ? value.toString() : value)
    : undefined;
  const reused = scopeKey ? scopeState!.proofs.get(scopeKey) : undefined;
  if (reused) {
    assertProBootstrapProof(reused);
    requireEqual(blockTimestamp, reused.blockTimestamp, "selected canonical timestamp");
    const [afterChain, after] = await Promise.all([
      client.getChainId(), client.getBlock({ blockNumber }),
    ]);
    requireEqual(afterChain, rawChain, "final canonical chain");
    requireEqual(after.number, blockNumber, "final canonical block number");
    requireEqual(after.hash, blockHash, "final canonical block hash");
    requireEqual(after.timestamp, blockTimestamp, "final canonical block timestamp");
    return reused;
  }
  const pinned = Object.freeze({ blockHash, requireCanonical: true as const });
  const read = (
    component: Address,
    functionName: ReadName,
    args?: readonly unknown[],
  ) =>
    client.readContract({
      address: component,
      abi: proBootstrapAbi,
      functionName,
      ...(args ? { args } : {}),
      ...pinned,
    } as never);
  const names = configuredNames(reviewed.configuration, reviewed.version);
  const runtimes = new Map<ProBootstrapComponent, Hex>();
  const entries = await Promise.all(
    names.map(async (name) => {
      const source = reviewed.artifacts[name]!;
      const runtime = await client.getCode({
        address: source.address,
        ...pinned,
      });
      if (
        typeof runtime !== "string" ||
        !/^0x(?:[\da-fA-F]{2})+$/.test(runtime)
      )
        throw new Error(name + " has no valid contract runtime code.");
      const codeHash = keccak256(runtime);
      requireEqual(
        codeHash,
        source.runtimeCodeHash,
        name + " runtime source hash",
      );
      runtimes.set(name, runtime);
      return [
        name,
        Object.freeze({
          artifact: source.artifact,
          address: source.address,
          codeHash,
        }),
      ] as const;
    }),
  );
  const components = Object.freeze(
    Object.fromEntries(entries),
  ) as ProBootstrapProof["components"];
  const at = (name: ProBootstrapComponent) => components[name]!.address;
  const codeHash = (name: ProBootstrapComponent) => components[name]!.codeHash;
  // These CREATE child positions are fixed by the attested current constructor sources.
  const children: (readonly [
    ProBootstrapComponent,
    ProBootstrapComponent,
    bigint,
  ])[] = [
    ["marketCalendar", "factory", 1n],
    ["ruleValidator", "factory", 2n],
    ...(reviewed.version !== 4
      ? ([["partnerRegistry", "factory", 3n]] as const)
      : []),
    ["vaultDeployer", "curveDeployer", 1n],
    ["vestingDeployer", "curveDeployer", 2n],
  ];
  if (reviewed.version === 4)
    children.push(
      ["programVaultCodeChunk0", "programDeployer", 1n],
      ["programVaultCodeChunk1", "programDeployer", 2n],
    );
  if (reviewed.configuration.reactive)
    children.push(["linkRegistry", "reactiveDeployer", 1n]);
  if (reviewed.version >= 2 && reviewed.configuration.reactive)
    children.push(["reactiveValidationChild", "reactiveDeployer", 2n]);
  if (reviewed.configuration.peak)
    children.push(["peakRegistry", "peakDeployer", 1n]);
  for (const [child, parent, nonce] of children)
    requireEqual(
      at(child),
      getContractAddress({ from: at(parent), nonce }),
      child + " constructor child provenance",
    );
  if (reviewed.version < 3) {
    const absentSelectors: readonly (readonly [
      Address,
      (
        | "REACTIVE_VALIDATION_CODE_HASH"
        | "validationChild"
        | "reactiveParticipantVersion"
        | "reactiveConsentVersion"
      ),
    ])[] = [
      ...(reviewed.version === 1
        ? ([
            [at("ruleValidator"), "REACTIVE_VALIDATION_CODE_HASH"],
            ...(reviewed.configuration.reactive
              ? ([[at("reactiveDeployer"), "validationChild"]] as const)
              : []),
          ] as const)
        : []),
      [target, "reactiveParticipantVersion"],
      ...(reviewed.configuration.reactive
        ? ([
            [at("reactiveDeployer"), "reactiveConsentVersion"],
            [at("linkRegistry"), "reactiveConsentVersion"],
          ] as const)
        : []),
    ];
    for (const [component, functionName] of absentSelectors) {
      try {
        await client.request({
          method: "eth_call",
          params: [
            {
              to: component,
              data: encodeFunctionData({ abi: proBootstrapAbi, functionName }),
            },
            pinned,
          ],
        } as never);
      } catch (error) {
        if (isEmptyExecutionRevert(error)) continue;
        throw new Error(
          "Bootstrap legacy selector absence was not proven for " +
            functionName +
            ".",
          { cause: error },
        );
      }
      throw new Error(
        "Bootstrap reviewed v" +
          reviewed.version +
          " profile contains a new Reactive selector: " +
          functionName +
          ".",
      );
    }
  }
  if (reviewed.version >= 2) {
    const literal = hash(
      await read(at("ruleValidator"), "REACTIVE_VALIDATION_CODE_HASH"),
      "Reviewed Reactive validation literal",
    );
    if (reviewed.configuration.reactive)
      requireEqual(
        literal,
        codeHash("reactiveValidationChild"),
        "Reactive validation literal runtime hash",
      );
  }
  type Binding = readonly [
    role: ProBootstrapComponent,
    name: ReadName,
    value: unknown,
    args?: readonly Address[],
  ];
  const bindings: Binding[] = [
    ["factory", "proTokenVersion", 1n],
    ["factory", "deploymentReady", true],
    ["partnerRegistry", "factory", target],
    ["partnerRegistry", "registryVersion", 1n],
    ["marketCalendar", "calendarVersion", MARKET_CALENDAR_VERSIONS],
    ["ruleValidator", "proTokenVersion", 1n],
    ["ruleValidator", "supportedRules", ALL_RULES],
    ["curveDeployer", "vaultDeployer", at("vaultDeployer")],
    ["curveDeployer", "vestingDeployer", at("vestingDeployer")],
    ["vaultDeployer", "curveDeployer", at("curveDeployer")],
    ["vestingDeployer", "componentDeployer", at("curveDeployer")],
  ];
  for (const name of [
    "partnerRegistry",
    "marketCalendar",
    "ruleValidator",
    "tokenDeployer",
    "policyDeployer",
    "curveDeployer",
    "router",
    "vestingDeployer",
  ] as const)
    bindings.push(["factory", name, at(name)]);
  for (const name of [
    "tokenDeployer",
    "policyDeployer",
    "curveDeployer",
    "router",
    "vaultDeployer",
    "vestingDeployer",
  ] as const)
    bindings.push([name, "factory", target], [name, "proTokenVersion", 1n]);
  for (const [name, kind] of [
    ["tokenDeployer", 1n],
    ["policyDeployer", 2n],
    ["curveDeployer", 3n],
    ["vestingDeployer", 5n],
  ] as const)
    bindings.push([name, "deployerKind", kind]);
  for (const name of names.filter(
    (name) =>
      ![
        "programDeployer",
        "claimProcessor",
        "programVaultCodeChunk0",
        "programVaultCodeChunk1",
      ].includes(name),
  ))
    bindings.push(["factory", "isSystemAddress", true, [at(name)]]);
  if (reviewed.version === 4) {
    for (const role of [
      "factory",
      "partnerRegistry",
      "tokenDeployer",
      "curveDeployer",
      "router",
      "programDeployer",
      "claimProcessor",
    ] as const)
      bindings.push([role, "feeProgramVersion", 4n]);
    bindings.push(
      ["router", "programDeployer", at("programDeployer")],
      ["router", "programDeployerCodeHash", codeHash("programDeployer")],
      ["programDeployer", "factory", target],
      ["programDeployer", "router", at("router")],
      ["programDeployer", "proTokenVersion", 1n],
      ["programDeployer", "claimProcessor", at("claimProcessor")],
      ["programDeployer", "claimProcessorCodeHash", codeHash("claimProcessor")],
      ["claimProcessor", "claimProcessorVersion", 4n],
      ["programDeployer", "codeChunk0", at("programVaultCodeChunk0")],
      ["programDeployer", "codeChunk1", at("programVaultCodeChunk1")],
      ["programDeployer", "codeChunkHash0", codeHash("programVaultCodeChunk0")],
      ["programDeployer", "codeChunkHash1", codeHash("programVaultCodeChunk1")],
      [
        "programDeployer",
        "vaultCreationCodeHash",
        reviewed.feePrograms!.vaultCreationCodeHash,
      ],
      [
        "curveDeployer",
        "curveCreationCodeHash",
        reviewed.feePrograms!.curveCreationCodeHash,
      ],
    );
  }
  for (const [group, roles] of Object.entries(optionalGroups)) {
    const enabled =
      reviewed.configuration[group as keyof ProBootstrapConfiguration];
    const flag = (
      group === "price"
        ? "priceInfrastructureConfigured"
        : group === "reactive"
          ? "reactiveInfrastructureConfigured"
          : "peakInfrastructureConfigured"
    ) as ReadName;
    bindings.push(["factory", flag, enabled]);
    for (const name of roles.filter(
      (name) => name !== "beaconDeployer" && name !== "entangledDeployer",
    ))
      bindings.push(
        ["factory", name, enabled ? at(name) : zeroAddress],
        [
          "factory",
          (name + "CodeHash") as ReadName,
          enabled ? codeHash(name) : ZERO_HASH,
        ],
      );
  }
  if (reviewed.configuration.price)
    bindings.push(
      ["slidingDeployer", "factory", target],
      ["slidingDeployer", "proTokenVersion", 1n],
      ["slidingDeployer", "deployerKind", 4n],
      ["priceOracle", "oracleVersion", 1n],
    );
  else
    bindings.push(
      ["factory", "priceUpdater", zeroAddress],
      ["factory", "priceMaxAgeSeconds", 0],
    );
  if (reviewed.configuration.reactive)
    bindings.push(
      ["reactiveDeployer", "factory", target],
      ["reactiveDeployer", "proTokenVersion", 1n],
      ["reactiveDeployer", "deployerKind", 6n],
      ["reactiveDeployer", "linkRegistry", at("linkRegistry")],
      ["reactiveDeployer", "activityRegistry", at("partnerRegistry")],
      ["linkRegistry", "factory", target],
      ["linkRegistry", "deployer", at("reactiveDeployer")],
      ["linkRegistry", "activityRegistry", at("partnerRegistry")],
      ["linkRegistry", "linkRegistryVersion", 1n],
    );
  if (reviewed.version >= 2 && reviewed.configuration.reactive)
    bindings.push(
      ["reactiveDeployer", "validationChild", at("reactiveValidationChild")],
      [
        "ruleValidator",
        "reactiveValidationChild",
        at("reactiveValidationChild"),
        [at("reactiveDeployer")],
      ],
      ["reactiveValidationChild", "validationVersion", 1n],
    );
  if (reviewed.version >= 3) {
    bindings.push(["factory", "reactiveParticipantVersion", 2n]);
    if (reviewed.configuration.reactive)
      bindings.push(
        ["reactiveDeployer", "reactiveConsentVersion", 2n],
        ["linkRegistry", "reactiveConsentVersion", 2n],
      );
  }
  if (reviewed.configuration.peak) {
    bindings.push(
      ["peakDeployer", "factory", target],
      ["peakDeployer", "proTokenVersion", 1n],
      ["peakDeployer", "deployerKind", 7n],
      ["peakDeployer", "peakRegistry", at("peakRegistry")],
      [
        "peakDeployer",
        "infrastructureAvailable",
        true,
        [at("partnerRegistry")],
      ],
      ["peakRegistry", "factory", target],
      ["peakRegistry", "registryVersion", 1n],
      ["peakRegistry", "deployer", at("peakDeployer")],
      ["peakRegistry", "activityRegistry", at("partnerRegistry")],
      ["peakRegistry", "oracle", at("priceOracle")],
      ["peakRegistry", "oracleCodeHash", codeHash("priceOracle")],
      ["peakRegistry", "activityRegistryCodeHash", codeHash("partnerRegistry")],
    );
    for (const [name, rule] of [
      ["beaconDeployer", 22],
      ["entangledDeployer", 21],
    ] as const)
      bindings.push(
        ["peakDeployer", name, at(name)],
        ["peakDeployer", (name + "CodeHash") as ReadName, codeHash(name)],
        [name, "peakDeployer", at("peakDeployer")],
        [name, "proTokenVersion", 1n],
        [name, "moduleRule", rule],
      );
  }
  if (reviewed.quotes) {
    // The allowlist is part of the Factory, so it must exist before any of its entries can be read.
    try {
      requireEqual(
        await read(target, "quoteAllowlistVersion"),
        1n,
        "Factory.quoteAllowlistVersion",
      );
    } catch (cause) {
      throw new Error(
        "Bootstrap Factory does not prove the quote allowlist that the reviewed manifest lists.",
        { cause },
      );
    }
    // Native MON is implicit. The count plus one approval flag per reviewed quote leaves no room for an
    // unreviewed ERC20 quote, because a flag can only be set by approveQuote, which also lists the quote.
    bindings.push(
      ["factory", "approvedQuoteCount", BigInt(reviewed.quotes.length)],
      ["factory", "approvedQuotes", true, [zeroAddress]],
      ["factory", "approvedQuoteCodeHash", ZERO_HASH, [zeroAddress]],
    );
    for (const quote of reviewed.quotes)
      bindings.push(
        ["factory", "approvedQuotes", true, [quote.address]],
        [
          "factory",
          "approvedQuoteCodeHash",
          quote.runtimeCodeHash,
          [quote.address],
        ],
        ["factory", "isSystemAddress", false, [quote.address]],
      );
  }
  // These caller-independent v3 getters have no dependency on the binding
  // results. For manifests without quote attestations, append the unchanged
  // list to that same bounded read phase; all decoded guards remain below.
  const postContracts = aggregateReviewedBindings ? [
        { address: target, abi: proBootstrapAbi, functionName: "owner" },
        { address: at("router"), abi: proBootstrapAbi, functionName: "authority" },
        { address: target, abi: proBootstrapAbi, functionName: "supportedRules" },
        ...(reviewed.configuration.price ? [
          { address: at("priceOracle"), abi: proBootstrapAbi, functionName: "updater" },
          { address: at("priceOracle"), abi: proBootstrapAbi, functionName: "maxAgeSeconds" },
          { address: target, abi: proBootstrapAbi, functionName: "priceUpdater" },
          { address: target, abi: proBootstrapAbi, functionName: "priceMaxAgeSeconds" },
          ...(reviewed.configuration.peak ? [
            { address: at("peakRegistry"), abi: proBootstrapAbi, functionName: "oracleUpdater" },
            { address: at("peakRegistry"), abi: proBootstrapAbi, functionName: "oracleMaxAgeSeconds" },
          ] : []),
        ] : []),
      ] : [];
  const combinePostBindings = aggregateReviewedBindings && !reviewed.quotes;
  let postGetters: readonly unknown[] | undefined;
  // Default batches fit the finite browser lane; a dedicated RPC client may
  // opt into at most twenty. Every reciprocal binding and selector is retained.
  let coreGeneration: ProCoreGeneration | undefined;
  if (aggregateReviewedBindings) {
    const bindingContracts = bindings.map(([role, functionName, , args]) => ({ address: at(role), abi: proBootstrapAbi, functionName, ...(args ? { args } : {}) }));
    const values = await readProCanonicalGetterBatch(client, blockHash,
      combinePostBindings ? [...bindingContracts, ...postContracts] : bindingContracts);
    if (combinePostBindings) postGetters = values.slice(bindings.length);
    bindings.forEach(([role, name, expected], index) => {
      const actual = values[index];
      requireEqual(actual, expected, role + "." + name);
      if (role === "marketCalendar" && name === "calendarVersion") coreGeneration = actual === 2n ? 2 : 1;
    });
  } else {
    for (let start = 0; start < bindings.length; start += maximumBindingReads) {
      const batch = bindings.slice(start, start + maximumBindingReads);
      const values = await Promise.all(batch.map(([role, name, , args]) => read(at(role), name, args)));
      batch.forEach(([role, name, expected], index) => {
        const actual = values[index];
        requireEqual(actual, expected, role + "." + name);
        if (role === "marketCalendar" && name === "calendarVersion") coreGeneration = actual === 2n ? 2 : 1;
      });
    }
  }
  if (coreGeneration === undefined)
    throw new Error("Bootstrap did not read the market calendar version.");
  let approvedQuotes: ProBootstrapProof["approvedQuotes"];
  if (reviewed.quotes) {
    const reviewedQuotes = reviewed.quotes;
    const pinnedQuotes = await Promise.all(
      reviewedQuotes.map(async (quote) => {
        const runtime = await client.getCode({
          address: quote.address,
          ...pinned,
        });
        if (
          typeof runtime !== "string" ||
          !/^0x(?:[\da-fA-F]{2})+$/.test(runtime)
        )
          throw new Error(
            "A reviewed quote has no valid contract runtime code.",
          );
        const quoteHash = keccak256(runtime);
        requireEqual(quoteHash, quote.runtimeCodeHash, "quote runtime hash");
        return Object.freeze({ address: quote.address, codeHash: quoteHash });
      }),
    );
    // Every listed entry must be a reviewed one, whatever order the owner approved them in.
    const reviewedSet = new Set(reviewedQuotes.map((quote) => quote.address));
    for (let index = 0; index < reviewedQuotes.length; index++) {
      const listed = address(
        await read(target, "approvedQuoteAt", [BigInt(index)]),
        "Listed quote",
      );
      if (!reviewedSet.has(listed))
        throw new Error(
          "Bootstrap Factory lists a quote that the reviewed manifest does not.",
        );
    }
    approvedQuotes = Object.freeze(pinnedQuotes);
  }
  // Quote attestations retain their previous ordering before post getters.
  if (aggregateReviewedBindings && !postGetters)
    postGetters = await readProCanonicalGetterBatch(client, blockHash, postContracts);
  const [ownerValue, authorityValue, supportedBitmap] = postGetters?.slice(0, 3) ?? await Promise.all([
    read(target, "owner"),
    read(at("router"), "authority"),
    read(target, "supportedRules"),
  ]);
  const owner = address(ownerValue, "Factory owner");
  const routerAuthority = address(authorityValue, "Router authority");
  if (
    typeof supportedBitmap !== "bigint" ||
    supportedBitmap < 0n ||
    supportedBitmap > ALL_RULES
  )
    throw new Error(
      "Bootstrap Factory returned an invalid supported rule bitmap.",
    );
  const conditionalMask =
    (1n << 4n) |
    (1n << 12n) |
    (1n << 17n) |
    (1n << 20n) |
    (1n << 21n) |
    (1n << 22n);
  const ordinaryMask = ALL_RULES & ~conditionalMask;
  requireEqual(
    supportedBitmap & ordinaryMask,
    ordinaryMask,
    "ordinary capability bits",
  );
  for (const [flag, mask] of [
    ["price", 1n << 4n],
    ["reactive", 1n << 20n],
    ["peak", (1n << 21n) | (1n << 22n)],
  ] as const)
    requireEqual(
      supportedBitmap & mask,
      reviewed.configuration[flag] ? mask : 0n,
      flag + " source capability bits",
    );
  let price: ProBootstrapProof["price"];
  let programSource: ProBootstrapProof["programSource"];
  if (reviewed.version === 4) {
    const claimPolicies = reviewed.feePrograms!.claimPolicies;
    requireEqual(
      await read(at("claimProcessor"), "policyCount"),
      BigInt(claimPolicies.length),
      "reviewed holder claim policy count",
    );
    for (let index = 0; index < claimPolicies.length; index++) {
      const policy = claimPolicies[index];
      const actual = await read(at("claimProcessor"), "policyAt", [
        BigInt(index),
      ]);
      if (!Array.isArray(actual) || actual.length !== 5)
        throw new Error("Invalid canonical holder claim asset policy.");
      for (const [position, expected] of [
        policy.assetRole,
        policy.asset,
        policy.runtimeCodeHash,
        policy.decimals,
        policy.minimumClaim,
      ].entries())
        requireEqual(
          actual[position],
          expected,
          "reviewed holder claim asset policy",
        );
      if (policy.asset !== zeroAddress) {
        const runtime = await client.getCode({
          address: policy.asset,
          ...pinned,
        });
        if (
          typeof runtime !== "string" ||
          !/^0x(?:[\da-f]{2})+$/i.test(runtime)
        )
          throw new Error("Reviewed holder payout asset has no runtime code.");
        requireEqual(
          keccak256(runtime),
          policy.runtimeCodeHash,
          "reviewed holder payout asset runtime",
        );
        requireEqual(
          await read(policy.asset, "decimals"),
          policy.decimals,
          "actual holder payout asset decimals",
        );
      }
    }
    const chunks = [
      runtimes.get("programVaultCodeChunk0")!,
      runtimes.get("programVaultCodeChunk1")!,
    ];
    if (
      chunks.some(
        (runtime) =>
          !runtime.startsWith("0x00") ||
          runtime.length <= 4 ||
          (runtime.length - 2) / 2 > MONAD_MAX_CODE_SIZE,
      )
    )
      throw new Error(
        "Fee program creation chunks require inert STOP-prefixed, bounded bytecode.",
      );
    const vaultCreationCode = concatHex(
      chunks.map((runtime) => sliceHex(runtime, 1)),
    );
    requireEqual(
      keccak256(vaultCreationCode),
      reviewed.feePrograms!.vaultCreationCodeHash,
      "reconstructed Vault creation source hash",
    );
    if (
      (chunks[0].length - 4) / 2 !==
      Math.floor((vaultCreationCode.length - 2) / 4)
    )
      throw new Error(
        "Fee program Vault creation chunks have incorrect constructor split lengths.",
      );
    programSource = Object.freeze({
      version: 4,
      programDeployer: at("programDeployer"),
      claimProcessor: at("claimProcessor"),
      claimProcessorCodeHash: codeHash("claimProcessor"),
      claimPolicies,
      vaultArtifact: PRO_FEE_PROGRAM_VAULT_ARTIFACT,
      vaultCreationCodeHash: reviewed.feePrograms!.vaultCreationCodeHash,
      vaultCreationCode,
      curveArtifact: PRO_FEE_PROGRAM_CURVE_ARTIFACT,
      curveCreationCodeHash: reviewed.feePrograms!.curveCreationCodeHash,
    });
  }
  if (reviewed.configuration.price) {
    const [updaterValue, maxAgeSeconds, factoryUpdater, factoryAge] =
      postGetters?.slice(3, 7) ?? await Promise.all([
        read(at("priceOracle"), "updater"),
        read(at("priceOracle"), "maxAgeSeconds"),
        read(target, "priceUpdater"),
        read(target, "priceMaxAgeSeconds"),
      ]);
    const updater = address(updaterValue, "Price updater");
    if (
      typeof maxAgeSeconds !== "number" ||
      !Number.isInteger(maxAgeSeconds) ||
      maxAgeSeconds <= 0 ||
      maxAgeSeconds > 0xffffffff
    )
      throw new Error("Bootstrap price age must be a positive uint32.");
    requireEqual(factoryUpdater, updater, "price updater");
    requireEqual(factoryAge, maxAgeSeconds, "price maximum age");
    const updaterCode = await client.getCode({ address: updater, ...pinned });
    if (updaterCode !== undefined && updaterCode !== "0x")
      throw new Error("Bootstrap price updater must remain an EOA.");
    if (reviewed.configuration.peak) {
      requireEqual(
        postGetters ? postGetters[7] : await read(at("peakRegistry"), "oracleUpdater"),
        updater,
        "Peak price updater",
      );
      requireEqual(
        postGetters ? postGetters[8] : await read(at("peakRegistry"), "oracleMaxAgeSeconds"),
        maxAgeSeconds,
        "Peak price maximum age",
      );
    }
    price = Object.freeze({ updater, maxAgeSeconds });
  }
  const [afterChain, after] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockNumber }),
  ]);
  requireEqual(afterChain, rawChain, "final canonical chain");
  requireEqual(after.number, blockNumber, "final canonical block number");
  requireEqual(after.hash, blockHash, "final canonical block hash");
  requireEqual(
    after.timestamp,
    blockTimestamp,
    "final canonical block timestamp",
  );
  const proof: ProBootstrapProof = Object.freeze({
    schema: PRO_BOOTSTRAP_PROOF_SCHEMA,
    version: 1,
    factory: target,
    partnerRegistry: at("partnerRegistry"),
    owner,
    routerAuthority,
    chainId,
    blockNumber,
    blockHash,
    blockTimestamp,
    supportedBitmap,
    coreGeneration,
    sourceReview: Object.freeze({
      schema: PRO_BOOTSTRAP_SOURCE_SCHEMA,
      version: reviewed.version,
      reviewId: reviewed.reviewId,
    }),
    configuration: reviewed.configuration,
    components,
    ...(approvedQuotes ? { approvedQuotes } : {}),
    ...(price ? { price } : {}),
    ...(reviewed.configuration.reactive
      ? ({
          reactiveValidationProfile:
            reviewed.version >= 2 ? "child-v1" : "embedded-v1",
        } as const)
      : {}),
    ...(reviewed.version >= 3 && reviewed.configuration.reactive
      ? ({ reactiveConsentProfile: "pending-participant-v2" } as const)
      : {}),
    ...(programSource ? { programSource } : {}),
  });
  issuedProofs.set(proof, reviewed);
  if (aggregateReviewedBindings) canonicalGetterStates.get(client)!.factories.add(`${target.toLowerCase()}:${blockHash.toLowerCase()}`);
  if (scopeKey) {
    if (scopeState!.proofs.size >= 8) throw new Error("Pro read scope exceeded its finite source bound.");
    scopeState!.proofs.set(scopeKey, proof);
  }
  return proof;
}
