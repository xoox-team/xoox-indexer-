// Vendored from the XOOX SDK; only what the indexer uses.
import {
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { canAggregateProCanonicalGetters, readProCanonicalGetterBatch, assertProBootstrapReadScope, type ProBootstrapReadScope } from "./pro-bootstrap";

export const PRO_GRADUATION_SOURCE_SCHEMA =
  "xoox.pro-graduation.reviewed-artifacts" as const;
export const PRO_GRADUATION_PROOF_SCHEMA =
  "xoox.pro-graduation.infrastructure" as const;

/** Exact source identifiers for the current frozen protocol and genuine upstream stack. */
export const PRO_GRADUATION_COMPONENT_ARTIFACTS = Object.freeze({
  factory: "packages/contracts/src/pro/ProFactory.sol:ProFactory",
  partnerRegistry:
    "packages/contracts/src/pro/ProPartnerRegistry.sol:ProPartnerRegistry",
  registry:
    "packages/contracts/src/pro/ProGraduationRegistry.sol:ProGraduationRegistry",
  guard: "packages/contracts/src/GraduationGuard.sol:GraduationGuard",
  verifier:
    "packages/contracts/src/pro/ProGraduationVerifier.sol:ProGraduationVerifier",
  executor:
    "packages/contracts/src/pro/ProGraduationExecutor.sol:ProGraduationExecutor",
  hook: "packages/contracts/src/pro/ProGraduationHook.sol:ProGraduationHook",
  poolManager: "v4-core/src/PoolManager.sol:PoolManager",
  positionManager: "v4-periphery/src/PositionManager.sol:PositionManager",
  permit2: "permit2/src/Permit2.sol:Permit2",
  locker: "packages/contracts/src/LaunchLocker.sol:LaunchLocker",
} as const);
export type ProGraduationComponent =
  keyof typeof PRO_GRADUATION_COMPONENT_ARTIFACTS;

/** Selects an existing canonical snapshot; it is not source, capability or user-draft proof. */
export type ProGraduationSnapshotSelector = Readonly<{
  blockNumber: bigint;
  blockHash: Hex;
}>;

/**
 * TRUSTED INPUT: load only from reviewed deployment configuration, never from RPC,
 * a user draft, or a captured contract getter. The hashes must be derived from the
 * reviewed compiler artifacts with the deployment's exact immutable values applied.
 * This API verifies that attestation against chain code; it does not independently
 * establish that an arbitrary supplied hash came from reviewed Solidity source.
 * This eleven-component manifest attests the graduation infrastructure. Ordinary
 * Token/Policy/Curve deployers and the launch router are selected once by the
 * Factory owner; live enforcement claims also require a reviewed bootstrap record
 * for those implementations and their fixed children. This proof alone does not
 * attest the ordinary launch implementation sources.
 */
export type ProGraduationSourceManifest = Readonly<{
  schema: typeof PRO_GRADUATION_SOURCE_SCHEMA;
  version: 1;
  reviewId: string;
  chainId: bigint;
  factory: Address;
  artifacts: Readonly<{
    [Component in ProGraduationComponent]: Readonly<{
      artifact: (typeof PRO_GRADUATION_COMPONENT_ARTIFACTS)[Component];
      runtimeCodeHash: Hex;
    }>;
  }>;
}>;

export type ProGraduationInfrastructureProof = Readonly<{
  schema: typeof PRO_GRADUATION_PROOF_SCHEMA;
  version: 1;
  factoryVersion: 1;
  registryKind: 8;
  supportsGraduation: true;
  supportedBitmap: bigint;
  supportedGraduatingBitmap: bigint;
  poolFee: 0;
  tickSpacing: 200;
  positionOwner: Address;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  sourceReview: Readonly<{
    schema: typeof PRO_GRADUATION_SOURCE_SCHEMA;
    version: 1;
    reviewId: string;
  }>;
  components: Readonly<
    Record<
      ProGraduationComponent,
      Readonly<{ address: Address; codeHash: Hex }>
    >
  >;
}>;

export const proGraduationInfrastructureAbi = parseAbi([
  "function proTokenVersion() view returns(uint256)",
  "function supportedRules() view returns(uint256)",
  "function supportedGraduatingRules() view returns(uint256)",
  "function supportsGraduation() view returns(bool)",
  "function deploymentReady() view returns(bool)",
  "function graduationRegistry() view returns(address)",
  "function graduationRegistryCodeHash() view returns(bytes32)",
  "function partnerRegistry() view returns(address)",
  "function isSystemAddress(address component) view returns(bool)",
  "function factory() view returns(address)",
  "function factoryCodeHash() view returns(bytes32)",
  "function partnerRegistryCodeHash() view returns(bytes32)",
  "function deployerKind() view returns(uint256)",
  "function available() view returns(bool)",
  "function isInfrastructure(address component) view returns(bool)",
  "function validateFactoryInstallation(address expectedFactory) view returns(bool)",
  "function graduationGuard() view returns(address)",
  "function graduationGuardCodeHash() view returns(bytes32)",
  "function graduationVerifier() view returns(address)",
  "function graduationVerifierCodeHash() view returns(bytes32)",
  "function guardVersion() view returns(uint256)",
  "function verifierVersion() view returns(uint256)",
  "function registry() view returns(address)",
  "function registryCodeHash() view returns(bytes32)",
  "function registryVersion() view returns(uint256)",
  "function executor() view returns(address)",
  "function executorCodeHash() view returns(bytes32)",
  "function poolManager() view returns(address)",
  "function poolManagerCodeHash() view returns(bytes32)",
  "function positionManager() view returns(address)",
  "function positionManagerCodeHash() view returns(bytes32)",
  "function permit2() view returns(address)",
  "function permit2CodeHash() view returns(bytes32)",
  "function locker() view returns(address)",
  "function lockerCodeHash() view returns(bytes32)",
  "function hook() view returns(address)",
  "function hookCodeHash() view returns(bytes32)",
  "function validateWiring(address registry,address manager,address hook) view returns(bool)",
  "function feeHook() view returns(address)",
  "function positionOwner() view returns(address)",
  "function REQUIRED_FLAGS() view returns(uint160)",
  "function pendingSweepToken() view returns(address)",
  "function activeSeedToken() view returns(address)",
  "function verifiedSeedToken() view returns(address)",
]);

const componentNames = Object.keys(
  PRO_GRADUATION_COMPONENT_ARTIFACTS,
) as ProGraduationComponent[];
const DEAD_OWNER = getAddress("0x000000000000000000000000000000000000dead");
// Frozen v1 wire IDs: 23 rules; R20 ReactivePair, R21 Entangled and R22 Beacon
// have either the original ordinary-only or the reviewed linked-capable graduating profile.
// Individual linked eligibility still requires its actual bit and dedicated source proof.
const V1_ALL_RULE_BITMAP = (1n << 23n) - 1n;
const LINKED_BITMAP = (1n << 20n) | (1n << 21n) | (1n << 22n);
const issuedProofs = new WeakSet<object>();
const scopedProofs = new WeakMap<ProBootstrapReadScope, Map<string, ProGraduationInfrastructureProof>>();

function address(value: unknown, label: string): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value, { strict: true }) ||
    value.toLowerCase() === zeroAddress
  )
    throw new Error(label + " must be a nonzero valid address.");
  return getAddress(value);
}
function hash(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[\da-fA-F]{64}$/.test(value) ||
    /^0x0{64}$/.test(value)
  )
    throw new Error(label + " must be a nonzero bytes32 value.");
  return value.toLowerCase() as Hex;
}
function code(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[\da-fA-F]{2})+$/.test(value))
    throw new Error(label + " has no valid contract runtime code.");
  return value as Hex;
}
function sameAddress(value: unknown, expected: Address): boolean {
  return (
    typeof value === "string" && value.toLowerCase() === expected.toLowerCase()
  );
}

function sourceManifest(value: ProGraduationSourceManifest, factory: Address) {
  if (
    !value ||
    value.schema !== PRO_GRADUATION_SOURCE_SCHEMA ||
    value.version !== 1 ||
    typeof value.reviewId !== "string" ||
    !value.reviewId.trim() ||
    value.reviewId.length > 256 ||
    typeof value.chainId !== "bigint" ||
    value.chainId <= 0n ||
    value.chainId >= 1n << 256n ||
    !sameAddress(value.factory, factory) ||
    !value.artifacts ||
    typeof value.artifacts !== "object"
  )
    throw new Error(
      "A reviewed graduation source manifest for this Factory is required.",
    );
  if (
    Object.keys(value.artifacts).length !== componentNames.length ||
    componentNames.some((name) => !Object.hasOwn(value.artifacts, name))
  )
    throw new Error(
      "Reviewed graduation manifest must contain every exact source artifact.",
    );
  const hashes = {} as Record<ProGraduationComponent, Hex>;
  for (const name of componentNames) {
    const artifact = value.artifacts[name];
    if (
      !artifact ||
      artifact.artifact !== PRO_GRADUATION_COMPONENT_ARTIFACTS[name]
    )
      throw new Error("Unexpected reviewed source artifact for " + name + ".");
    hashes[name] = hash(
      artifact.runtimeCodeHash,
      name + " reviewed runtime hash",
    );
  }
  // Capture all trusted input before awaiting RPC: later caller mutations cannot alter proof scope.
  return Object.freeze({
    reviewId: value.reviewId,
    chainId: value.chainId,
    hashes: Object.freeze(hashes),
  });
}

function snapshotSelector(value?: ProGraduationSnapshotSelector) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.blockNumber !== "bigint" ||
    value.blockNumber < 0n ||
    value.blockNumber >= 1n << 256n
  )
    throw new Error(
      "Requested graduation snapshot number must be a uint256 bigint.",
    );
  return Object.freeze({
    blockNumber: value.blockNumber,
    blockHash: hash(value.blockHash, "Requested graduation snapshot hash"),
  });
}

/**
 * Reject serialized/user-created proof-shaped objects. Readonly containers retain the
 * issued object's identity. This guard proves issuance, not freshness: consumers must
 * also bind its Factory, chain, number, hash and timestamp to their current snapshot.
 */
export function assertProGraduationInfrastructureProof(
  value: unknown,
): asserts value is ProGraduationInfrastructureProof {
  if (!value || typeof value !== "object" || !issuedProofs.has(value))
    throw new Error(
      "Graduation proof must come from the canonical infrastructure reader.",
    );
}

/** Recover only the original reviewed attestation carried by an issued proof. */
export function proGraduationManifestFromProof(
  proof: ProGraduationInfrastructureProof,
): ProGraduationSourceManifest {
  assertProGraduationInfrastructureProof(proof);
  return Object.freeze({
    schema: PRO_GRADUATION_SOURCE_SCHEMA,
    version: 1,
    reviewId: proof.sourceReview.reviewId,
    chainId: proof.chainId,
    factory: proof.components.factory.address,
    artifacts: Object.freeze(
      Object.fromEntries(
        componentNames.map((name) => [
          name,
          Object.freeze({
            artifact: PRO_GRADUATION_COMPONENT_ARTIFACTS[name],
            runtimeCodeHash: proof.components[name].codeHash,
          }),
        ]),
      ) as ProGraduationSourceManifest["artifacts"],
    ),
  });
}

/**
 * Reads only canonical EIP-1898 state. All code, pins and reciprocal identities are
 * checked against one mined block; unsupported canonical RPCs reject without fallback.
 * Reviewed runtime attestations are mandatory and separate from ABI/hash getter checks.
 * This infrastructure proof does not prove an individual creation or graduation receipt.
 * A supplied selector reuses that exact block and never selects a newer current height.
 */
export async function readProGraduationInfrastructure(
  client: PublicClient,
  factory: Address,
  reviewedManifest: ProGraduationSourceManifest,
  selector?: ProGraduationSnapshotSelector,
  readScope?: ProBootstrapReadScope,
): Promise<ProGraduationInfrastructureProof> {
  if (readScope) assertProBootstrapReadScope(client, readScope);
  const target = address(factory, "Pro Factory");
  const reviewed = sourceManifest(reviewedManifest, target);
  const selected = snapshotSelector(selector);
  // A selected block fixes both independent guards before source state is read.
  const [rawChain, selectedBlock] = selected
    ? await Promise.all([
        client.getChainId(), client.getBlock({ blockNumber: selected.blockNumber }),
      ])
    : [await client.getChainId(), undefined] as const;
  if (!Number.isSafeInteger(rawChain) || rawChain < 1)
    throw new Error("RPC returned an invalid chain ID.");
  const chainId = BigInt(rawChain);
  if (chainId !== reviewed.chainId)
    throw new Error("Reviewed graduation manifest belongs to another chain.");
  const blockNumber =
    selected?.blockNumber ?? (await client.getBlockNumber({ cacheTime: 0 }));
  if (
    typeof blockNumber !== "bigint" ||
    blockNumber < 0n ||
    blockNumber >= 1n << 256n
  )
    throw new Error("RPC returned an invalid graduation block number.");
  const before = selectedBlock ?? await client.getBlock({ blockNumber });
  if (
    before.number !== blockNumber ||
    typeof before.timestamp !== "bigint" ||
    before.timestamp < 0n ||
    before.timestamp >= 1n << 64n
  )
    throw new Error("RPC did not return the requested mined graduation block.");
  const blockHash = hash(before.hash, "Graduation block hash");
  if (selected && blockHash !== selected.blockHash)
    throw new Error(
      "Requested graduation snapshot hash is not canonical at its block number.",
    );
  const scopeKey = readScope
    ? JSON.stringify([target, reviewed, blockNumber, blockHash], (_key, value) =>
        typeof value === "bigint" ? value.toString() : value)
    : undefined;
  const reused = readScope && scopeKey ? scopedProofs.get(readScope)?.get(scopeKey) : undefined;
  if (reused) {
    assertProGraduationInfrastructureProof(reused);
    if (before.timestamp !== reused.blockTimestamp)
      throw new Error("Requested graduation snapshot timestamp changed at its canonical hash.");
    const [after, finalChain] = await Promise.all([
      client.getBlock({ blockNumber }), client.getChainId(),
    ]);
    if (after.number !== blockNumber || hash(after.hash, "Final graduation block hash") !== blockHash ||
        after.timestamp !== before.timestamp || !Number.isSafeInteger(finalChain) || BigInt(finalChain) !== chainId)
      throw new Error("Canonical graduation block or chain changed during verification.");
    return reused;
  }
  const pinned = Object.freeze({ blockHash, requireCanonical: true as const });
  const read = (
    component: Address,
    functionName: (typeof proGraduationInfrastructureAbi)[number]["name"],
    args?: readonly Address[],
  ) =>
    client.readContract({
      address: component,
      abi: proGraduationInfrastructureAbi,
      functionName,
      ...(args ? { args } : {}),
      ...pinned,
    } as never);
  const aggregate = canAggregateProCanonicalGetters(client, target, blockHash);
  const getters = (calls: readonly (readonly [Address, (typeof proGraduationInfrastructureAbi)[number]["name"], (readonly Address[])?])[]) => aggregate
    ? readProCanonicalGetterBatch(client, blockHash, calls.map(([address, functionName, args]) => ({ address, abi: proGraduationInfrastructureAbi, functionName, ...(args ? { args } : {}) })))
    : Promise.all(calls.map(([component, name, args]) => read(component, name, args)));
  const attestCode = async (
    name: ProGraduationComponent,
    component: Address,
  ) => {
    const actualHash = keccak256(
      code(await client.getCode({ address: component, ...pinned }), name),
    );
    if (actualHash !== reviewed.hashes[name])
      throw new Error(
        name + " runtime differs from the reviewed source artifact.",
      );
    return Object.freeze({ address: component, codeHash: actualHash });
  };
  const factoryComponent = await attestCode("factory", target);
  const [
    version,
    supportedBitmap,
    supportedGraduatingBitmap,
    support,
    ready,
    registryValue,
    registryPin,
    activityValue,
  ] = await getters([
    [target, "proTokenVersion"], [target, "supportedRules"],
    [target, "supportedGraduatingRules"], [target, "supportsGraduation"],
    [target, "deploymentReady"], [target, "graduationRegistry"],
    [target, "graduationRegistryCodeHash"], [target, "partnerRegistry"],
  ]);
  if (
    version !== 1n ||
    support !== true ||
    ready !== true ||
    typeof supportedBitmap !== "bigint" ||
    supportedBitmap < 0n ||
    supportedBitmap > V1_ALL_RULE_BITMAP ||
    typeof supportedGraduatingBitmap !== "bigint" ||
    supportedGraduatingBitmap < 0n ||
    (supportedGraduatingBitmap !== (supportedBitmap & ~LINKED_BITMAP) &&
      supportedGraduatingBitmap !== supportedBitmap) ||
    (supportedGraduatingBitmap & supportedBitmap) !== supportedGraduatingBitmap
  )
    throw new Error(
      "Unsupported or unavailable graduating Factory capabilities.",
    );
  const registry = address(registryValue, "Graduation Registry");
  const partnerRegistry = address(activityValue, "Partner Registry");
  const [registryComponent, partnerComponent] = await Promise.all([
    attestCode("registry", registry),
    attestCode("partnerRegistry", partnerRegistry),
  ]);
  if (hash(registryPin, "Factory Registry pin") !== registryComponent.codeHash)
    throw new Error(
      "Factory graduation Registry code pin differs from actual reviewed code.",
    );
  const [
    registryFactory,
    registryVersion,
    kind,
    available,
    registryFactoryPin,
    registryPartner,
    partnerPin,
    guardValue,
    guardPin,
    verifierValue,
    verifierPin,
    executorValue,
    executorPin,
    hookValue,
    hookPin,
    managerValue,
    managerPin,
    positionsValue,
    positionsPin,
    permitValue,
    permitPin,
    lockerValue,
    lockerPin,
    partnerFactory,
    partnerVersion,
    factoryRegistrySystem,
    partnerSystem,
    pendingSweep,
    activeSeed,
    verifiedSeed,
    installation,
  ] = await Promise.all([
    getters([
      [registry, "factory"],
      [registry, "proTokenVersion"],
      [registry, "deployerKind"],
      [registry, "available"],
      [registry, "factoryCodeHash"],
      [registry, "partnerRegistry"],
      [registry, "partnerRegistryCodeHash"],
      [registry, "graduationGuard"],
      [registry, "graduationGuardCodeHash"],
      [registry, "graduationVerifier"],
      [registry, "graduationVerifierCodeHash"],
      [registry, "executor"],
      [registry, "executorCodeHash"],
      [registry, "hook"],
      [registry, "hookCodeHash"],
      [registry, "poolManager"],
      [registry, "poolManagerCodeHash"],
      [registry, "positionManager"],
      [registry, "positionManagerCodeHash"],
      [registry, "permit2"],
      [registry, "permit2CodeHash"],
      [registry, "locker"],
      [registry, "lockerCodeHash"],
      [partnerRegistry, "factory"],
      [partnerRegistry, "registryVersion"],
      [target, "isSystemAddress", [registry]],
      [target, "isSystemAddress", [partnerRegistry]],
      [registry, "pendingSweepToken"],
      [registry, "activeSeedToken"],
      [registry, "verifiedSeedToken"],
    ]),
    read(registry, "validateFactoryInstallation", [target]),
  ]).then(([values, installation]) => [...values, installation]);
  if (
    !sameAddress(registryFactory, target) ||
    registryVersion !== 1n ||
    kind !== 8n ||
    available !== true ||
    installation !== true ||
    !sameAddress(registryPartner, partnerRegistry) ||
    !sameAddress(partnerFactory, target) ||
    partnerVersion !== 1n ||
    factoryRegistrySystem !== true ||
    partnerSystem !== true ||
    hash(registryFactoryPin, "Registry Factory pin") !==
      factoryComponent.codeHash ||
    hash(partnerPin, "Registry Partner pin") !== partnerComponent.codeHash ||
    !sameAddress(pendingSweep, zeroAddress) ||
    !sameAddress(activeSeed, zeroAddress) ||
    !sameAddress(verifiedSeed, zeroAddress)
  )
    throw new Error(
      "Foreign, unavailable or inconsistent graduation Registry provenance.",
    );
  const discovered = {
    guard: address(guardValue, "Graduation Guard"),
    verifier: address(verifierValue, "Graduation Verifier"),
    executor: address(executorValue, "Graduation Executor"),
    hook: address(hookValue, "Graduation Hook"),
    poolManager: address(managerValue, "PoolManager"),
    positionManager: address(positionsValue, "PositionManager"),
    permit2: address(permitValue, "Permit2"),
    locker: address(lockerValue, "Launch Locker"),
  };
  const identities = [
    target,
    registry,
    partnerRegistry,
    ...Object.values(discovered),
  ].map((value) => value.toLowerCase());
  if (
    new Set(identities).size !== identities.length ||
    identities.includes(DEAD_OWNER.toLowerCase())
  )
    throw new Error(
      "Graduation components and permanent position owner must have distinct identities.",
    );
  if (
    !sameAddress(
      discovered.guard,
      getContractAddress({ from: registry, nonce: 1n }),
    ) ||
    !sameAddress(
      discovered.verifier,
      getContractAddress({ from: registry, nonce: 2n }),
    )
  )
    throw new Error(
      "Graduation Guard and Verifier must be genuine Registry CREATE children at nonces 1 and 2.",
    );
  if ((BigInt(discovered.hook) & 0x3fffn) !== 0x2000n)
    throw new Error(
      "Graduation Hook must have only the fixed beforeInitialize flag 0x2000.",
    );
  const pins = {
    guard: guardPin,
    verifier: verifierPin,
    executor: executorPin,
    hook: hookPin,
    poolManager: managerPin,
    positionManager: positionsPin,
    permit2: permitPin,
    locker: lockerPin,
  };
  const discoveredEntries = await Promise.all(
    (Object.keys(discovered) as (keyof typeof discovered)[]).map(
      async (name) => {
        const component = await attestCode(name, discovered[name]);
        if (hash(pins[name], name + " Registry pin") !== component.codeHash)
          throw new Error(
            name + " code differs from its immutable Registry pin.",
          );
        if (!aggregate && (await read(registry, "isInfrastructure", [component.address])) !== true)
          throw new Error(name + " is absent from fixed Registry infrastructure exclusions.");
        return [name, component] as const;
      },
    ),
  );
  const exclusions = aggregate ? await getters(discoveredEntries.map(([, component]) => [registry, "isInfrastructure", [component.address]])) : [];
  exclusions.forEach((value, index) => {
    if (value !== true) throw new Error(discoveredEntries[index][0] + " is absent from fixed Registry infrastructure exclusions.");
  });
  const components = Object.freeze({
    factory: factoryComponent,
    partnerRegistry: partnerComponent,
    registry: registryComponent,
    ...Object.fromEntries(discoveredEntries),
  }) as ProGraduationInfrastructureProof["components"];
  const {
    guard,
    verifier,
    executor,
    hook,
    poolManager,
    positionManager,
    permit2,
    locker,
  } = discovered;
  const wiring: readonly (readonly [
    component: Address,
    name: (typeof proGraduationInfrastructureAbi)[number]["name"],
    expected: unknown,
    args?: readonly Address[],
  ])[] = [
    [guard, "guardVersion", 1n],
    [verifier, "verifierVersion", 1n],
    [verifier, "registry", registry],
    [executor, "proTokenVersion", 1n],
    [executor, "factory", registry],
    [executor, "registryCodeHash", registryComponent.codeHash],
    [executor, "poolManager", poolManager],
    [executor, "positionManager", positionManager],
    [executor, "permit2", permit2],
    [executor, "locker", locker],
    [executor, "hook", hook],
    [executor, "validateWiring", true, [registry, poolManager, hook]],
    [hook, "proTokenVersion", 1n],
    [hook, "registry", registry],
    [hook, "registryCodeHash", registryComponent.codeHash],
    [hook, "poolManager", poolManager],
    [hook, "executor", executor],
    [hook, "REQUIRED_FLAGS", 0x2000n],
    [positionManager, "poolManager", poolManager],
    [positionManager, "permit2", permit2],
    [locker, "positionManager", positionManager],
    [locker, "executor", executor],
    [locker, "feeHook", hook],
    [locker, "positionOwner", DEAD_OWNER],
  ];
  const wiringValues = await getters(wiring.map(([component, name, , args]) => [component, name, args]));
  wiring.forEach(([component, name, expected, args], index) => {
      const actual = wiringValues[index];
      const matches =
        typeof expected === "string"
          ? typeof actual === "string" &&
            actual.toLowerCase() === expected.toLowerCase()
          : actual === expected;
      if (!matches)
        throw new Error("Graduation reciprocal wiring mismatch: " + name + ".");
    });
  const [after, finalChain] = await Promise.all([
    client.getBlock({ blockNumber }), client.getChainId(),
  ]);
  if (
    after.number !== blockNumber ||
    hash(after.hash, "Final graduation block hash") !== blockHash ||
    after.timestamp !== before.timestamp ||
    !Number.isSafeInteger(finalChain) ||
    BigInt(finalChain) !== chainId
  )
    throw new Error(
      "Canonical graduation block or chain changed during verification.",
    );
  const proof: ProGraduationInfrastructureProof = Object.freeze({
    schema: PRO_GRADUATION_PROOF_SCHEMA,
    version: 1,
    factoryVersion: 1,
    registryKind: 8,
    supportsGraduation: true,
    supportedBitmap,
    supportedGraduatingBitmap,
    poolFee: 0,
    tickSpacing: 200,
    positionOwner: DEAD_OWNER,
    chainId,
    blockNumber,
    blockHash,
    blockTimestamp: before.timestamp,
    sourceReview: Object.freeze({
      schema: PRO_GRADUATION_SOURCE_SCHEMA,
      version: 1,
      reviewId: reviewed.reviewId,
    }),
    components,
  });
  issuedProofs.add(proof);
  if (readScope && scopeKey) {
    let proofs = scopedProofs.get(readScope);
    if (!proofs) scopedProofs.set(readScope, proofs = new Map());
    if (proofs.size >= 8) throw new Error("Pro read scope exceeded its finite graduation source bound.");
    proofs.set(scopeKey, proof);
  }
  return proof;
}
