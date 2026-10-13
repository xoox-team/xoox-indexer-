// Vendored from the XOOX SDK; only what the indexer uses.
import {
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  getContractAddress,
  isAddress,
  keccak256,
  parseAbi,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  assertProBootstrapProof,
  proBootstrapManifestFromProof,
  readProBootstrapInfrastructure,
  type ProBootstrapProof,
} from "./pro-bootstrap";
import { proGraduationInfrastructureAbi } from "./pro-graduation";

export const PRO_FEE_PROGRAM_GRADUATION_SOURCE_SCHEMA =
  "xoox.pro-token.fee-program-graduation.reviewed-artifacts" as const;
export const PRO_FEE_PROGRAM_GRADUATION_PROOF_SCHEMA =
  "xoox.pro-token.fee-program-graduation.infrastructure" as const;
export const PRO_FEE_PROGRAM_GRADUATION_COMPONENT_ARTIFACTS = Object.freeze({
  factory:
    "packages/contracts/src/pro/programs/ProFeeProgramFactory.sol:ProFeeProgramFactory",
  partnerRegistry:
    "packages/contracts/src/pro/programs/ProFeeProgramPartnerRegistry.sol:ProFeeProgramPartnerRegistry",
  registry:
    "packages/contracts/src/pro/programs/v4/ProFeeProgramGraduationRegistry.sol:ProFeeProgramGraduationRegistry",
  guard: "packages/contracts/src/GraduationGuard.sol:GraduationGuard",
  verifier:
    "packages/contracts/src/pro/programs/v4/ProFeeProgramGraduationVerifier.sol:ProFeeProgramGraduationVerifier",
  executor:
    "packages/contracts/src/pro/programs/v4/ProFeeProgramGraduationExecutor.sol:ProFeeProgramGraduationExecutor",
  hook: "packages/contracts/src/pro/programs/v4/ProFeeProgramGraduationHook.sol:ProFeeProgramGraduationHook",
  poolManager: "v4-core/src/PoolManager.sol:PoolManager",
  positionManager: "v4-periphery/src/PositionManager.sol:PositionManager",
  permit2: "permit2/src/Permit2.sol:Permit2",
  locker: "packages/contracts/src/LaunchLocker.sol:LaunchLocker",
  swapRouter:
    "packages/contracts/src/pro/programs/v4/ProFeeProgramSwapRouter.sol:ProFeeProgramSwapRouter",
} as const);
export const PRO_FEE_PROGRAM_GRADUATION_ARTIFACTS =
  PRO_FEE_PROGRAM_GRADUATION_COMPONENT_ARTIFACTS;
export type ProFeeProgramGraduationComponent =
  keyof typeof PRO_FEE_PROGRAM_GRADUATION_ARTIFACTS;
/** Trusted deployment input, never RPC or a user draft. Runtime hashes must come
 * from independently compiled reviewed sources with exact deployment immutables.
 * A self-reported code hash is not an attestation of reviewed Solidity source. */
export type ProFeeProgramGraduationSourceManifest = Readonly<{
  schema: typeof PRO_FEE_PROGRAM_GRADUATION_SOURCE_SCHEMA;
  version: 4;
  reviewId: string;
  chainId: bigint;
  factory: Address;
  artifacts: Readonly<{
    [Role in ProFeeProgramGraduationComponent]: Readonly<{
      artifact: (typeof PRO_FEE_PROGRAM_GRADUATION_ARTIFACTS)[Role];
      address: Address;
      runtimeCodeHash: Hex;
    }>;
  }>;
}>;
export type ProFeeProgramGraduationInfrastructureProof = Readonly<{
  schema: typeof PRO_FEE_PROGRAM_GRADUATION_PROOF_SCHEMA;
  version: 4;
  policyVersion: 1;
  registryKind: 8;
  hookFlags: 0x20cc;
  poolFee: 0;
  tickSpacing: 200;
  positionOwner: Address;
  supportsGraduation: true;
  supportedBitmap: bigint;
  supportedGraduatingBitmap: bigint;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  components: Readonly<
    Record<
      ProFeeProgramGraduationComponent,
      Readonly<{ address: Address; codeHash: Hex }>
    >
  >;
  sourceReview: Readonly<{
    schema: typeof PRO_FEE_PROGRAM_GRADUATION_SOURCE_SCHEMA;
    version: 4;
    reviewId: string;
  }>;
}>;
export const proFeeProgramGraduationAbi = [
  ...proGraduationInfrastructureAbi,
  ...parseAbi([
    "function feeProgramVersion() view returns(uint256)",
    "function verifier() view returns(address)",
    "function verifierCodeHash() view returns(bytes32)",
  ]),
] as const;
type Name = (typeof proFeeProgramGraduationAbi)[number]["name"];
const roles = Object.keys(
  PRO_FEE_PROGRAM_GRADUATION_ARTIFACTS,
) as ProFeeProgramGraduationComponent[];
const DEAD = getAddress("0x000000000000000000000000000000000000dead");
const ALL = (1n << 23n) - 1n;
const LINKED = (1n << 20n) | (1n << 21n) | (1n << 22n);
const issued = new WeakMap<object, ProFeeProgramGraduationSourceManifest>();
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new Error("Pro fee program graduation: " + message + ".");
}
const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
function address(value: unknown, label: string): Address {
  ensure(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      !same(value, zeroAddress),
    label + " must be a nonzero address",
  );
  return getAddress(value);
}
function hash(value: unknown, label: string): Hex {
  ensure(
    typeof value === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(value) &&
      !/^0x0{64}$/.test(value),
    label + " must be nonzero bytes32",
  );
  return value.toLowerCase() as Hex;
}
function exact(
  input: unknown,
  names: readonly string[],
  label: string,
): Record<string, unknown> {
  ensure(
    !!input &&
      typeof input === "object" &&
      Object.getPrototypeOf(input) === Object.prototype,
    label + " must be a plain record",
  );
  const fields = Object.getOwnPropertyDescriptors(input);
  ensure(
    Reflect.ownKeys(input).length === names.length &&
      names.every((name) => fields[name] && "value" in fields[name]),
    label + " must contain exactly its own data fields",
  );
  return input as Record<string, unknown>;
}
function capture(
  input: ProFeeProgramGraduationSourceManifest,
  source: ProBootstrapProof,
): ProFeeProgramGraduationSourceManifest {
  const value = exact(
    input,
    ["schema", "version", "reviewId", "chainId", "factory", "artifacts"],
    "reviewed manifest",
  );
  ensure(
    value.schema === PRO_FEE_PROGRAM_GRADUATION_SOURCE_SCHEMA &&
      value.version === 4 &&
      typeof value.reviewId === "string" &&
      value.reviewId.trim().length > 0 &&
      value.reviewId.length <= 256 &&
      value.chainId === source.chainId &&
      same(value.factory, source.factory),
    "explicit source4 reviewed manifest for this Factory and chain is required",
  );
  const raw = exact(value.artifacts, roles, "reviewed artifacts");
  const artifacts = Object.fromEntries(
    roles.map((role) => {
      const entry = exact(
        raw[role],
        ["artifact", "address", "runtimeCodeHash"],
        role + " review",
      );
      ensure(
        entry.artifact === PRO_FEE_PROGRAM_GRADUATION_ARTIFACTS[role],
        "unexpected reviewed source artifact for " + role,
      );
      const artifact = Object.freeze({
        artifact: entry.artifact,
        address: address(entry.address, role),
        runtimeCodeHash: hash(
          entry.runtimeCodeHash,
          role + " reviewed runtime hash",
        ),
      });
      if (role === "factory" || role === "partnerRegistry")
        ensure(
          same(artifact.address, source.components[role].address) &&
            same(artifact.runtimeCodeHash, source.components[role].codeHash),
          role + " differs from the independently reviewed bootstrap",
        );
      return [role, artifact];
    }),
  ) as ProFeeProgramGraduationSourceManifest["artifacts"];
  const identities = roles.map((role) => artifacts[role].address.toLowerCase());
  ensure(
    new Set(identities).size === roles.length &&
      !identities.includes(DEAD.toLowerCase()),
    "all reviewed components and the permanent LP owner must have distinct identities",
  );
  return Object.freeze({
    schema: PRO_FEE_PROGRAM_GRADUATION_SOURCE_SCHEMA,
    version: 4,
    reviewId: value.reviewId as string,
    chainId: source.chainId,
    factory: source.factory,
    artifacts: Object.freeze(artifacts),
  });
}
export function assertProFeeProgramGraduationInfrastructureProof(
  value: unknown,
): asserts value is ProFeeProgramGraduationInfrastructureProof {
  ensure(
    !!value && typeof value === "object" && issued.has(value),
    "proof must come from the canonical source4 graduation reader",
  );
}
export function proFeeProgramGraduationManifestFromProof(
  proof: ProFeeProgramGraduationInfrastructureProof,
): ProFeeProgramGraduationSourceManifest {
  assertProFeeProgramGraduationInfrastructureProof(proof);
  return issued.get(proof)!;
}
export function assertProFeeProgramGraduationSnapshot(
  proof: ProFeeProgramGraduationInfrastructureProof,
  source: ProBootstrapProof,
) {
  assertProFeeProgramGraduationInfrastructureProof(proof);
  assertProBootstrapProof(source);
  ensure(
    source.sourceReview.version === 4 &&
      source.programSource?.version === 4 &&
      proof.chainId === source.chainId &&
      proof.blockNumber === source.blockNumber &&
      same(proof.blockHash, source.blockHash) &&
      proof.blockTimestamp === source.blockTimestamp &&
      same(proof.components.factory.address, source.factory) &&
      same(
        proof.components.factory.codeHash,
        source.components.factory.codeHash,
      ) &&
      same(
        proof.components.partnerRegistry.address,
        source.components.partnerRegistry.address,
      ) &&
      same(
        proof.components.partnerRegistry.codeHash,
        source.components.partnerRegistry.codeHash,
      ),
    "proof must match the exact issued source4 bootstrap snapshot",
  );
}

/** An infrastructure proof, not a completed LP receipt or service approval.
 * All code and reciprocal bindings are checked at the issued bootstrap's exact
 * canonical block. No latest-state fallback or getter-only source acceptance. */
export async function readProFeeProgramGraduationInfrastructure(
  client: PublicClient,
  source: ProBootstrapProof,
  manifest: ProFeeProgramGraduationSourceManifest,
): Promise<ProFeeProgramGraduationInfrastructureProof> {
  assertProBootstrapProof(source);
  ensure(
    source.sourceReview.version === 4 && source.programSource?.version === 4,
    "explicit issued fee program profile4 is required",
  );
  const reviewed = capture(manifest, source);
  const pinned = {
    blockHash: source.blockHash,
    requireCanonical: true,
  } as const;
  const read = async (
    target: Address,
    name: Name,
    args: readonly Address[] = [],
  ) => {
    const data = encodeFunctionData({
      abi: proFeeProgramGraduationAbi,
      functionName: name,
      args,
    } as never);
    const raw = (await client.request({
      method: "eth_call",
      params: [{ to: target, data }, pinned],
    } as never)) as Hex;
    const result = decodeFunctionResult({
      abi: proFeeProgramGraduationAbi as Abi,
      functionName: name,
      data: raw,
    });
    ensure(
      same(
        raw,
        encodeFunctionResult({
          abi: proFeeProgramGraduationAbi,
          functionName: name,
          result,
        } as never),
      ),
      name + " has noncanonical ABI data",
    );
    return result;
  };
  const components = Object.freeze(
    Object.fromEntries(
      await Promise.all(
        roles.map(async (role) => {
          const record = reviewed.artifacts[role];
          const code = await client.request({
            method: "eth_getCode",
            params: [record.address, pinned],
          } as never);
          ensure(
            typeof code === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(code),
            role + " reviewed runtime is missing",
          );
          const codeHash = keccak256(code as Hex);
          ensure(
            same(codeHash, record.runtimeCodeHash),
            role + " runtime differs from independently reviewed source",
          );
          return [role, Object.freeze({ address: record.address, codeHash })];
        }),
      ),
    ),
  ) as ProFeeProgramGraduationInfrastructureProof["components"];
  const a = (role: ProFeeProgramGraduationComponent) =>
    components[role].address;
  const h = (role: ProFeeProgramGraduationComponent) =>
    components[role].codeHash;
  const factory = a("factory"),
    registry = a("registry"),
    hook = a("hook");
  ensure(
    same(a("guard"), getContractAddress({ from: registry, nonce: 1n })) &&
      same(a("verifier"), getContractAddress({ from: registry, nonce: 2n })),
    "Guard and Verifier must be Registry CREATE children1 and2",
  );
  ensure(
    (BigInt(hook) & 0x3fffn) === 0x20ccn,
    "Hook must carry exactly the reviewed flags0x20cc",
  );
  const [supportedBitmap, supportedGraduatingBitmap] = await Promise.all([
    read(factory, "supportedRules"),
    read(factory, "supportedGraduatingRules"),
  ]);
  ensure(
    typeof supportedBitmap === "bigint" &&
      supportedBitmap >= 0n &&
      supportedBitmap <= ALL &&
      supportedBitmap === source.supportedBitmap &&
      typeof supportedGraduatingBitmap === "bigint" &&
      supportedGraduatingBitmap >= 0n &&
      (supportedGraduatingBitmap === supportedBitmap ||
        supportedGraduatingBitmap === (supportedBitmap & ~LINKED)),
    "unsupported graduating policy bitmap",
  );
  const wiring: [Address, Name, unknown, (readonly Address[])?][] = [
    [factory, "proTokenVersion", 1n],
    [factory, "feeProgramVersion", 4n],
    [factory, "deploymentReady", true],
    [factory, "supportsGraduation", true],
    [factory, "partnerRegistry", a("partnerRegistry")],
    [factory, "graduationRegistry", registry],
    [factory, "graduationRegistryCodeHash", h("registry")],
    [factory, "isSystemAddress", true, [registry]],
    [factory, "isSystemAddress", true, [a("partnerRegistry")]],
    [registry, "proTokenVersion", 1n],
    [registry, "feeProgramVersion", 4n],
    [registry, "deployerKind", 8n],
    [registry, "factory", factory],
    [registry, "factoryCodeHash", h("factory")],
    [registry, "partnerRegistry", a("partnerRegistry")],
    [registry, "partnerRegistryCodeHash", h("partnerRegistry")],
    [registry, "available", true],
    [registry, "validateFactoryInstallation", true, [factory]],
    [registry, "pendingSweepToken", zeroAddress],
    [registry, "activeSeedToken", zeroAddress],
    [registry, "verifiedSeedToken", zeroAddress],
    [a("partnerRegistry"), "factory", factory],
    [a("partnerRegistry"), "registryVersion", 1n],
    [a("partnerRegistry"), "feeProgramVersion", 4n],
    [a("guard"), "guardVersion", 1n],
    [a("verifier"), "verifierVersion", 1n],
    [a("verifier"), "feeProgramVersion", 4n],
    [a("verifier"), "registry", registry],
    [a("executor"), "proTokenVersion", 1n],
    [a("executor"), "feeProgramVersion", 4n],
    [a("executor"), "factory", registry],
    [a("executor"), "registryCodeHash", h("registry")],
    [a("executor"), "poolManager", a("poolManager")],
    [a("executor"), "positionManager", a("positionManager")],
    [a("executor"), "permit2", a("permit2")],
    [a("executor"), "locker", a("locker")],
    [a("executor"), "hook", hook],
    [a("executor"), "validateWiring", true, [registry, a("poolManager"), hook]],
    [hook, "proTokenVersion", 1n],
    [hook, "feeProgramVersion", 4n],
    [hook, "registry", registry],
    [hook, "registryCodeHash", h("registry")],
    [hook, "poolManager", a("poolManager")],
    [hook, "executor", a("executor")],
    [hook, "REQUIRED_FLAGS", 0x20ccn],
    [a("positionManager"), "poolManager", a("poolManager")],
    [a("positionManager"), "permit2", a("permit2")],
    [a("locker"), "positionManager", a("positionManager")],
    [a("locker"), "executor", a("executor")],
    [a("locker"), "feeHook", hook],
    [a("locker"), "positionOwner", DEAD],
    [a("swapRouter"), "proTokenVersion", 1n],
    [a("swapRouter"), "feeProgramVersion", 4n],
  ];
  for (const [role, getter] of [
    ["guard", "graduationGuard"],
    ["verifier", "graduationVerifier"],
    ["executor", "executor"],
    ["hook", "hook"],
    ["poolManager", "poolManager"],
    ["positionManager", "positionManager"],
    ["permit2", "permit2"],
    ["locker", "locker"],
  ] as const) {
    wiring.push(
      [registry, getter, a(role)],
      [registry, (getter + "CodeHash") as Name, h(role)],
      [registry, "isInfrastructure", true, [a(role)]],
    );
  }
  for (const role of [
    "registry",
    "factory",
    "partnerRegistry",
    "poolManager",
    "hook",
    "executor",
    "verifier",
  ] as const)
    wiring.push(
      [a("swapRouter"), role, a(role)],
      [a("swapRouter"), (role + "CodeHash") as Name, h(role)],
    );
  await Promise.all(
    wiring.map(async ([target, name, expected, args]) =>
      ensure(
        same(await read(target, name, args), expected),
        "reciprocal version or wiring mismatch: " + name,
      ),
    ),
  );
  await readProBootstrapInfrastructure(
    client,
    source.factory,
    proBootstrapManifestFromProof(source),
    source,
  );
  const proof: ProFeeProgramGraduationInfrastructureProof = Object.freeze({
    schema: PRO_FEE_PROGRAM_GRADUATION_PROOF_SCHEMA,
    version: 4,
    policyVersion: 1,
    registryKind: 8,
    hookFlags: 0x20cc,
    poolFee: 0,
    tickSpacing: 200,
    positionOwner: DEAD,
    supportsGraduation: true,
    supportedBitmap,
    supportedGraduatingBitmap,
    chainId: source.chainId,
    blockNumber: source.blockNumber,
    blockHash: source.blockHash,
    blockTimestamp: source.blockTimestamp,
    components,
    sourceReview: Object.freeze({
      schema: PRO_FEE_PROGRAM_GRADUATION_SOURCE_SCHEMA,
      version: 4,
      reviewId: reviewed.reviewId,
    }),
  });
  issued.set(proof, reviewed);
  return proof;
}
