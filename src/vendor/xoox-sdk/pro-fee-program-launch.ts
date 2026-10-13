// Vendored from the XOOX SDK; only what the indexer uses.
import {
  concatHex,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  getAbiItem,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  zeroHash,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  assertProBootstrapProof,
  proBootstrapManifestFromProof,
  readProBootstrapInfrastructure,
  type ProBootstrapProof,
  type ProBootstrapSnapshotSelector,
  type ProBootstrapSourceManifest,
} from "./pro-bootstrap";
import {
  readProRegisteredToken,
  type ProDiscoveryToken,
} from "./pro-discovery";
import {
  PRO_FEE_PROGRAM_COUNT,
  proFeeProgramConfigHash,
  validateProFeeProgramConfig,
  type ProFeeProgramConfig,
} from "./pro-fee-programs";
import {
  assertProFeeProgramGraduationSnapshot,
  type ProFeeProgramGraduationInfrastructureProof,
} from "./pro-fee-program-graduation";
import { assertProFeeProgramHolderAssetPolicies } from "./pro-fee-program-claim-policy";

export const proFeeProgramLaunchAbi = parseAbi([
  "struct Metadata { string name; string symbol; string description; string image; string website; string twitter; string telegram; }",
  "struct CurveConfig { address quoteAsset; uint256 phantomQuote; uint256 graduationThreshold; uint16 baseFeeBps; uint16 buyTaxBps; uint16 sellTaxBps; bool perpetual; address feeRecipient; }",
  "struct RuleConfig { uint8 rule; bytes data; }",
  "struct LaunchRequest { Metadata metadata; uint256 supply; CurveConfig curve; RuleConfig[] rules; address[] walletExemptions; bytes32 salt; uint64 deadline; }",
  "struct OpeningBuy { uint256 quoteIn; uint256 minTokensOut; uint64 deadline; bytes32[] proof; }",
  "struct Recipient { address wallet; uint16 weightBps; }",
  "struct Program { uint8 moduleId; uint16 weightBps; uint32 intervalSeconds; address authority; address recipient; address asset; address adapter; bytes32 adapterCodeHash; address nftCollection; uint256 minHolding; uint256 maxHolding; uint16 count; uint16 burnBps; uint16 holderBps; uint16 maxCreatorBps; uint32 maxWaitSeconds; uint256 dailySalary; bytes32 rulesHash; address[] allowedAssets; Recipient[] recipients; }",
  "struct Config { uint16 poolFeeBps; uint32 snapshotMaxAge; Program[] programs; }",
  "struct Action { uint8 kind; uint256 amount; address outputAsset; uint256 minOut; bytes32 root; address[] beneficiaries; uint256 nftId; bytes data; }",
  "struct Cycle { uint64 id; uint64 observedAt; uint64 deadline; bytes32 evidence; Action[] actions; }",
  "function createProgramLaunch(LaunchRequest request,Config config,OpeningBuy opening) payable returns(address token,address curve,address policy,address vault)",
  "function feeProgramVersion() view returns(uint256)",
  "function programVaultOf(address token) view returns(address)",
  "function isProgramVault(address vault) view returns(bool)",
  "function configurationHashOf(address vault) view returns(bytes32)",
  "function configurationHash() view returns(bytes32)",
  "function launchConfigurationHash() view returns(bytes32)",
  "function factory() view returns(address)",
  "function router() view returns(address)",
  "function creator() view returns(address)",
  "function token() view returns(address)",
  "function curve() view returns(address)",
  "function quoteAsset() view returns(address)",
  "function feeRecipient() view returns(address)",
  "function factoryCodeHash() view returns(bytes32)",
  "function routerCodeHash() view returns(bytes32)",
  "function tokenCodeHash() view returns(bytes32)",
  "function curveCodeHash() view returns(bytes32)",
  "function claimProcessor() view returns(address)",
  "function claimProcessorCodeHash() view returns(bytes32)",
  "function poolHook() view returns(address)",
  "function poolHookCodeHash() view returns(bytes32)",
  "function poolFeeBps() view returns(uint16)",
  "function snapshotMaxAge() view returns(uint32)",
  "function programCount() view returns(uint256)",
  "function programAt(uint256 index) view returns(Program)",
  "function programBudget(uint256 index) view returns(uint256)",
  "function waitingSince(uint256 index) view returns(uint64)",
  "function holderCarryQuote(uint256 index) view returns(uint256)",
  "function salaryAvailable(uint256 index) view returns(uint256)",
  "function lastCycle(uint256 index) view returns(uint64)",
  "function lastCycleAt(uint256 index) view returns(uint64)",
  "function totalCurveFees() view returns(uint256)",
  "function totalPoolFees() view returns(uint256)",
  "function rewardRoots(uint256 index,uint64 cycle) view returns(bytes32 root,address asset,uint256 reserved,uint256 claimed,uint64 observedAt)",
  "function holderClaimed(uint256 index,uint64 cycle,address wallet) view returns(bool)",
  "function holderPublicationEvidence(uint256 index,uint64 cycle) view returns(bytes32)",
  "function claimable(address asset,address beneficiary) view returns(uint256)",
  "function totalLiabilities(address asset) view returns(uint256)",
  "function claimHolder(uint256 index,uint64 cycle,address wallet,uint256 amount,bytes32[] proof)",
  "function accrueHolder(uint256 index,uint64 cycle,address wallet,uint256 amount,bytes32[] proof)",
  "function claimHolderCredit(address asset,address beneficiary) returns(uint256 amount)",
  "struct HolderClaim { uint256 index; uint64 cycleId; uint256 amount; bytes32[] proof; }",
  "function claimHolderBatch(address asset,address beneficiary,HolderClaim[] claims)",
  "function holderCreditState(address asset,address wallet) view returns(uint256 balance,uint128 creditedThrough,uint128 paidThrough)",
  "function holderCreditSequence(uint256 index,uint64 cycle,address beneficiary) view returns(uint128)",
  "function claim(address asset) returns(uint256 amount)",
  "function claimFor(address asset,address beneficiary) returns(uint256 amount)",
  "function reclaimStaleContestCredit(uint256 index,address asset,address beneficiary) returns(uint256 amount)",
  "function collectCurveFees() returns(uint256 amount)",
  "function execute(uint256 index,Cycle cycle)",
  "function publishHolderRoot(uint256 index,uint64 cycle,bytes32 root,uint64 observedAt,uint64 deadline,bytes32 evidence)",
  "event ProgramLaunchCreated(address indexed creator,address indexed token,address indexed vault,bytes32 programConfigurationHash)",
  "event VaultDeployed(address indexed vault,address indexed creator,bytes32 indexed configurationHash,bytes32 salt)",
  "event LaunchBound(address indexed token,address indexed curve,bytes32 indexed launchHash)",
  "event HolderFundsReserved(uint256 indexed program,uint64 indexed cycle,address indexed asset,uint256 reserved,uint64 observedAt)",
  "event RewardRootPublished(uint256 indexed program,uint64 indexed cycle,address indexed asset,bytes32 root,uint256 reserved,uint64 observedAt)",
  "event HolderRootEvidence(uint256 indexed program,uint64 indexed cycle,bytes32 indexed evidence)",
  "event HolderShareCarried(uint256 indexed program,uint64 indexed cycle,uint256 amount,uint256 totalCarry)",
  "event RevenueCollected(uint8 indexed source,uint256 amount,uint256 total)",
  "event ProgramFunded(uint256 indexed program,uint256 amount,uint256 budget)",
  "event CycleExecuted(uint256 indexed program,uint64 indexed cycle,bytes32 indexed evidence,uint256 spent,uint256 remaining)",
  "event ActionExecuted(uint256 indexed program,uint64 indexed cycle,uint8 kind,address asset,uint256 spent,uint256 received)",
  "event ClaimCredited(address indexed asset,address indexed beneficiary,uint256 amount)",
  "event Claimed(address indexed asset,address indexed beneficiary,uint256 amount)",
  "event ContestCreditReturned(uint256 indexed program,address indexed asset,address indexed beneficiary,uint256 amount)",
  "event HolderClaimed(uint256 indexed program,uint64 indexed cycle,address indexed beneficiary,address asset,uint256 amount)",
  "event HolderCreditAccrued(uint256 indexed program,uint64 cycle,address indexed asset,address indexed beneficiary,uint256 amount,uint128 sequence,uint256 balance)",
  "event HolderCreditPaid(address indexed asset,address indexed beneficiary,uint256 amount,uint128 throughSequence)",
]);
type ReadName = Extract<
  (typeof proFeeProgramLaunchAbi)[number],
  { type: "function" }
>["name"];

export type ProFeeProgramSourceProof = ProBootstrapProof &
  Readonly<{
    programSource: NonNullable<ProBootstrapProof["programSource"]>;
  }>;
export function assertProFeeProgramSourceProof(
  value: unknown,
): asserts value is ProFeeProgramSourceProof {
  assertProBootstrapProof(value);
  ensure(
    value.sourceReview.version === 4 && value.programSource?.version === 4,
    "explicit reviewed fee program source 4 is required",
  );
}
export async function readProFeeProgramSource(
  client: PublicClient,
  factory: Address,
  manifest: ProBootstrapSourceManifest,
  selector?: ProBootstrapSnapshotSelector,
): Promise<ProFeeProgramSourceProof> {
  ensure(manifest.version === 4, "a legacy source cannot attest fee programs");
  const source = await readProBootstrapInfrastructure(
    client,
    factory,
    manifest,
    selector,
  );
  assertProFeeProgramSourceProof(source);
  return source;
}
export type ProFeeProgramActivity = Readonly<{
  budget: bigint;
  lastCycle: bigint;
  lastCycleAt: bigint;
  waitingSince: bigint;
  holderCarryQuote: bigint;
  salaryAvailable: bigint;
}>;
export type ProFeeProgramLaunch = Readonly<{
  schema: "xoox.pro-token.fee-program-launch";
  programSource: 4;
  policyVersion: 1;
  bootstrapInfrastructure: ProFeeProgramSourceProof;
  registeredToken: ProDiscoveryToken;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  factory: Address;
  router: Address;
  token: Address;
  curve: Address;
  policy: Address;
  creator: Address;
  quoteAsset: Address;
  vault: Address;
  vaultCodeHash: Hex;
  configurationHash: Hex;
  launchConfigurationHash: Hex;
  configuration: ProFeeProgramConfig;
  activity: readonly ProFeeProgramActivity[];
  totalCurveFees: bigint;
  totalPoolFees: bigint;
  /** Pool source attestation is a separate reviewed graduation proof. */
  poolHook: Address;
  graduationInfrastructure?: ProFeeProgramGraduationInfrastructureProof;
}>;
const issuedLaunches = new WeakSet<object>();
export function assertProFeeProgramLaunch(
  value: unknown,
): asserts value is ProFeeProgramLaunch {
  ensure(
    !!value && typeof value === "object" && issuedLaunches.has(value),
    "launch must come from the canonical fee program reader",
  );
}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error("Pro fee program source: " + message + ".");
}
const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
function eq(actual: unknown, expected: unknown, label: string) {
  ensure(same(actual, expected), label + " binding mismatch");
}
function address(value: unknown, label: string, allowZero = false): Address {
  ensure(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      (allowZero || !same(value, zeroAddress)),
    label + " must be a valid address",
  );
  return getAddress(value);
}
function hash(value: unknown, label: string): Hex {
  ensure(
    typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value),
    label + " must be bytes32",
  );
  return value.toLowerCase() as Hex;
}
function uint(value: unknown, label: string, bits = 256): bigint {
  ensure(
    typeof value === "bigint" && value >= 0n && value < 1n << BigInt(bits),
    label + " must be uint" + bits,
  );
  return value;
}
function canonicalEvent(
  abi: Abi,
  name: string,
  log: { data: Hex; topics: readonly Hex[] },
  args: Record<string, unknown>,
) {
  const event = getAbiItem({ abi, name }) as AbiEvent;
  const topics = encodeEventTopics({
    abi: [event],
    eventName: name,
    args: Object.fromEntries(
      event.inputs
        .filter((input) => input.indexed)
        .map((input) => [input.name!, args[input.name!]]),
    ),
  } as never);
  ensure(
    log.topics.length === topics.length,
    "event has noncanonical topic count",
  );
  topics.forEach((topic, index) =>
    eq(log.topics[index], topic, "canonical event topic"),
  );
  const fields = event.inputs.filter((input) => !input.indexed);
  eq(
    log.data,
    encodeAbiParameters(
      fields,
      fields.map((field) => args[field.name!]) as never,
    ),
    "canonical event data",
  );
}
function reader(client: PublicClient, source: ProBootstrapProof) {
  const pinned = {
    blockHash: source.blockHash,
    requireCanonical: true,
  } as const;
  return {
    async read(
      target: Address,
      functionName: ReadName,
      args: readonly unknown[] = [],
    ) {
      const data = encodeFunctionData({
        abi: proFeeProgramLaunchAbi,
        functionName,
        args,
      } as never);
      const raw = (await client.request({
        method: "eth_call",
        params: [{ to: target, data }, pinned],
      } as never)) as Hex;
      const result = decodeFunctionResult({
        abi: proFeeProgramLaunchAbi as Abi,
        functionName,
        data: raw,
      });
      eq(
        raw,
        encodeFunctionResult({
          abi: proFeeProgramLaunchAbi,
          functionName,
          result,
        } as never),
        functionName + " canonical ABI",
      );
      return result;
    },
    async code(target: Address) {
      const code = await client.request({
        method: "eth_getCode",
        params: [target, pinned],
      } as never);
      ensure(
        typeof code === "string" && /^0x([0-9a-fA-F]{2})+$/.test(code),
        "contract runtime is missing",
      );
      return code as Hex;
    },
  };
}
async function finish(client: PublicClient, source: ProBootstrapProof) {
  await readProBootstrapInfrastructure(
    client,
    source.factory,
    proBootstrapManifestFromProof(source),
    source,
  );
}

/** Authenticates Vault provenance from the independently pinned deployer and its
 * creation bytecode, not from an indexer or Vault's self-reported version alone.
 * Nonzero hooks require a separately issued compiled graduation source proof at
 * this exact snapshot. A Hook getter never establishes artifact approval. */
export async function readProFeeProgramLaunch(
  client: PublicClient,
  source: ProBootstrapProof,
  token: Address,
  graduationInfrastructure?: ProFeeProgramGraduationInfrastructureProof,
): Promise<ProFeeProgramLaunch> {
  assertProFeeProgramSourceProof(source);
  if (graduationInfrastructure)
    assertProFeeProgramGraduationSnapshot(graduationInfrastructure, source);
  const registered = await readProRegisteredToken(client, source, token);
  ensure(
    registered.programSource?.version === 4,
    "registered token has no fee program provenance",
  );
  const vault = registered.programSource.vault;
  const router = source.components.router.address;
  const deployer = source.programSource.programDeployer;
  const { read, code } = reader(client, source);
  const [created, deployedHash, vaultRuntime, tokenRuntime, curveRuntime] =
    await Promise.all([
      read(deployer, "isProgramVault", [vault]),
      read(deployer, "configurationHashOf", [vault]),
      code(vault),
      code(token),
      code(registered.curve),
    ]);
  eq(created, true, "genuine helper Vault provenance");
  const bindings: readonly [
    target: Address,
    name: ReadName,
    expected: unknown,
    args?: readonly unknown[],
  ][] = [
    [router, "programVaultOf", vault, [token]],
    [vault, "feeProgramVersion", 4n],
    [vault, "factory", source.factory],
    [vault, "router", router],
    [vault, "token", token],
    [vault, "curve", registered.curve],
    [vault, "creator", registered.creator],
    [registered.curve, "feeRecipient", vault],
    [vault, "factoryCodeHash", source.components.factory.codeHash],
    [vault, "routerCodeHash", source.components.router.codeHash],
    [vault, "tokenCodeHash", keccak256(tokenRuntime)],
    [vault, "curveCodeHash", keccak256(curveRuntime)],
    [vault, "claimProcessor", source.programSource.claimProcessor],
    [
      vault,
      "claimProcessorCodeHash",
      source.programSource.claimProcessorCodeHash,
    ],
    [vault, "launchConfigurationHash", registered.configurationHash],
  ];
  await Promise.all(
    bindings.map(async ([target, name, expected, args]) =>
      eq(await read(target, name, args), expected, name),
    ),
  );
  const [poolHookValue, poolHookPin] = await Promise.all([
    read(vault, "poolHook"),
    read(vault, "poolHookCodeHash"),
  ]);
  const poolHook = address(poolHookValue, "pool hook", true);
  if (same(poolHook, zeroAddress))
    eq(poolHookPin, zeroHash, "zero poolHookCodeHash");
  else {
    ensure(
      graduationInfrastructure,
      "poolHook requires an independently reviewed graduation source",
    );
    eq(
      poolHook,
      graduationInfrastructure.components.hook.address,
      "reviewed poolHook",
    );
    eq(
      poolHookPin,
      graduationInfrastructure.components.hook.codeHash,
      "reviewed poolHookCodeHash",
    );
  }
  const [
    quoteValue,
    curveQuote,
    configurationHash,
    poolFeeBps,
    snapshotMaxAge,
    countValue,
    totalCurveFees,
    totalPoolFees,
  ] = await Promise.all([
    read(vault, "quoteAsset"),
    read(registered.curve, "quoteAsset"),
    read(vault, "configurationHash"),
    read(vault, "poolFeeBps"),
    read(vault, "snapshotMaxAge"),
    read(vault, "programCount"),
    read(vault, "totalCurveFees"),
    read(vault, "totalPoolFees"),
  ]);
  const quoteAsset = address(quoteValue, "fee quote", true);
  eq(quoteAsset, curveQuote, "actual Curve fee quote");
  const count = uint(countValue, "program count");
  ensure(
    count >= 1n && count <= 30n,
    "program count is outside the complete catalogue",
  );
  const programs: unknown[] = [];
  const activity: ProFeeProgramActivity[] = [];
  for (let index = 0; index < Number(count); index++) {
    const [
      program,
      budget,
      lastCycle,
      lastCycleAt,
      waitingSince,
      holderCarryQuote,
      salaryAvailable,
    ] = await Promise.all([
      read(vault, "programAt", [BigInt(index)]),
      read(vault, "programBudget", [BigInt(index)]),
      read(vault, "lastCycle", [BigInt(index)]),
      read(vault, "lastCycleAt", [BigInt(index)]),
      read(vault, "waitingSince", [BigInt(index)]),
      read(vault, "holderCarryQuote", [BigInt(index)]),
      read(vault, "salaryAvailable", [BigInt(index)]),
    ]);
    programs.push(program);
    activity.push(
      Object.freeze({
        budget: uint(budget, "program budget"),
        lastCycle: uint(lastCycle, "cycle", 64),
        lastCycleAt: uint(lastCycleAt, "cycle time", 64),
        waitingSince: uint(waitingSince, "waiting since", 64),
        holderCarryQuote: uint(
          holderCarryQuote,
          "segregated holder carry quote",
        ),
        salaryAvailable: uint(salaryAvailable, "available salary"),
      }),
    );
  }
  // This is historical structural validation. Asset/service approval is a distinct
  // requirement for preparing a new launch, never inferred from an existing tuple.
  const configuration = validateProFeeProgramConfig({
    poolFeeBps,
    snapshotMaxAge,
    programs,
  });
  const computedHash = proFeeProgramConfigHash(configuration);
  assertProFeeProgramHolderAssetPolicies(
    source.programSource.claimPolicies,
    configuration.programs,
  );
  eq(computedHash, configurationHash, "complete Vault configuration");
  eq(computedHash, deployedHash, "helper configuration commitment");
  await finish(client, source);
  const launch: ProFeeProgramLaunch = Object.freeze({
    schema: "xoox.pro-token.fee-program-launch",
    programSource: 4,
    policyVersion: 1,
    bootstrapInfrastructure: source,
    registeredToken: registered,
    chainId: source.chainId,
    blockNumber: source.blockNumber,
    blockHash: source.blockHash,
    blockTimestamp: source.blockTimestamp,
    factory: source.factory,
    router,
    token: registered.token,
    curve: registered.curve,
    policy: registered.policy,
    creator: registered.creator,
    quoteAsset,
    vault,
    vaultCodeHash: keccak256(vaultRuntime),
    configurationHash: computedHash,
    launchConfigurationHash: registered.configurationHash,
    configuration,
    activity: Object.freeze(activity),
    totalCurveFees: uint(totalCurveFees, "Curve fee total"),
    totalPoolFees: uint(totalPoolFees, "pool fee total"),
    poolHook,
    ...(graduationInfrastructure ? { graduationInfrastructure } : {}),
  });
  issuedLaunches.add(launch);
  return launch;
}

const requestParameter = getAbiItem({
  abi: proFeeProgramLaunchAbi,
  name: "createProgramLaunch",
}).inputs[0];

export type ProFeeProgramVerifiedReceipt = Readonly<{
  transactionHash: Hex;
  launch: ProFeeProgramLaunch;
}>;

/** Standard double-hashed OpenZeppelin leaf, with both Vault and cycle domain. */
export function proFeeProgramHolderLeaf(
  vault: Address,
  programIndex: number,
  cycleId: bigint,
  asset: Address,
  wallet: Address,
  amount: bigint,
): Hex {
  ensure(
    Number.isInteger(programIndex) &&
      programIndex >= 0 &&
      programIndex < PRO_FEE_PROGRAM_COUNT,
    "invalid program index",
  );
  const inner = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address vault,uint256 program,uint64 cycle,address asset,address wallet,uint256 amount",
      ),
      [
        address(vault, "Vault"),
        BigInt(programIndex),
        uint(cycleId, "cycle", 64),
        address(asset, "asset", true),
        address(wallet, "wallet"),
        uint(amount, "claim amount"),
      ],
    ),
  );
  return keccak256(inner);
}
export type ProFeeProgramHolderClaimInput = Readonly<{
  programIndex: number;
  cycleId: bigint;
  wallet: Address;
  amount: bigint;
  proof: readonly Hex[];
}>;
export type ProFeeProgramHolderClaim = Readonly<{
  vault: Address;
  programIndex: number;
  cycleId: bigint;
  asset: Address;
  wallet: Address;
  amount: bigint;
  root: Hex;
  reserved: bigint;
  claimed: bigint;
  observedAt: bigint;
  alreadyClaimed: boolean;
  publication: "unfunded" | "funded-unpublished" | "published";
  canClaim: boolean;
  proofValid: boolean;
  creditSequence: bigint;
  credit: ProFeeProgramHolderCredit;
  paymentStatus: "unconsumed" | "credited" | "paid" | "unverified";
  payoutAfterClaim: boolean;
}>;
export type ProFeeProgramHolderCredit = Readonly<{
  launch: ProFeeProgramLaunch;
  vault: Address;
  asset: Address;
  wallet: Address;
  balance: bigint;
  creditedThrough: bigint;
  paidThrough: bigint;
  minimumClaim: bigint;
  decimals: number;
  canPayout: boolean;
}>;
const holderCreditProofs = new WeakSet<object>();
export function assertProFeeProgramHolderCredit(
  value: unknown,
): asserts value is ProFeeProgramHolderCredit {
  ensure(
    !!value && typeof value === "object" && holderCreditProofs.has(value),
    "a reader-issued holder credit is required",
  );
}
export async function readProFeeProgramHolderCredit(
  client: PublicClient,
  launch: ProFeeProgramLaunch,
  asset: Address,
  wallet: Address,
): Promise<ProFeeProgramHolderCredit> {
  assertProFeeProgramLaunch(launch);
  asset = address(asset, "holder credit asset", true);
  wallet = address(wallet, "holder credit wallet");
  const policy =
    launch.bootstrapInfrastructure.programSource.claimPolicies.find((item) =>
      same(item.asset, asset),
    );
  ensure(
    policy,
    "holder credit asset has no independently reviewed payout policy",
  );
  const { read } = reader(client, launch.bootstrapInfrastructure);
  const values = await read(launch.vault, "holderCreditState", [asset, wallet]);
  ensure(
    Array.isArray(values) && values.length === 3,
    "invalid holder credit state",
  );
  const balance = uint(values[0], "holder credit balance"),
    creditedThrough = uint(values[1], "holder credits through", 128),
    paidThrough = uint(values[2], "holder paid through", 128);
  ensure(
    paidThrough <= creditedThrough &&
      (balance === 0n
        ? paidThrough === creditedThrough
        : paidThrough < creditedThrough),
    "holder credit balance and payment sequence disagree",
  );
  await finish(client, launch.bootstrapInfrastructure);
  const result: ProFeeProgramHolderCredit = Object.freeze({
    launch,
    vault: launch.vault,
    asset,
    wallet,
    balance,
    creditedThrough,
    paidThrough,
    minimumClaim: policy.minimumClaim,
    decimals: policy.decimals,
    canPayout: balance >= policy.minimumClaim,
  });
  holderCreditProofs.add(result);
  return result;
}
export async function readProFeeProgramHolderClaim(
  client: PublicClient,
  launch: ProFeeProgramLaunch,
  rawInput: ProFeeProgramHolderClaimInput,
): Promise<ProFeeProgramHolderClaim> {
  assertProFeeProgramLaunch(launch);
  ensure(
    Array.isArray(rawInput.proof) && rawInput.proof.length <= 64,
    "holder proof is too long",
  );
  const input = Object.freeze({
    ...rawInput,
    wallet: address(rawInput.wallet, "claim wallet"),
    proof: Object.freeze(
      rawInput.proof.map((node) => hash(node, "proof node")),
    ),
  });
  ensure(
    Number.isInteger(input.programIndex) &&
      input.programIndex >= 0 &&
      input.programIndex < launch.configuration.programs.length,
    "unknown program index",
  );
  uint(input.cycleId, "cycle", 64);
  uint(input.amount, "claim amount");
  address(input.wallet, "claim wallet");
  ensure(input.proof.length <= 64, "holder proof is too long");
  const { read } = reader(client, launch.bootstrapInfrastructure);
  const [value, alreadyClaimed, sequenceValue] = await Promise.all([
    read(launch.vault, "rewardRoots", [
      BigInt(input.programIndex),
      input.cycleId,
    ]),
    read(launch.vault, "holderClaimed", [
      BigInt(input.programIndex),
      input.cycleId,
      input.wallet,
    ]),
    read(launch.vault, "holderCreditSequence", [
      BigInt(input.programIndex),
      input.cycleId,
      input.wallet,
    ]),
  ]);
  ensure(
    Array.isArray(value) &&
      value.length === 5 &&
      typeof alreadyClaimed === "boolean",
    "invalid holder root result",
  );
  const root = hash(value[0], "holder root"),
    asset = address(value[1], "reward asset", true);
  const reserved = uint(value[2], "reserved rewards"),
    claimed = uint(value[3], "claimed rewards"),
    observedAt = uint(value[4], "observed time", 64);
  ensure(
    claimed <= reserved,
    "holder claimed amount exceeds its funded reservation",
  );
  let leaf = proFeeProgramHolderLeaf(
    launch.vault,
    input.programIndex,
    input.cycleId,
    asset,
    input.wallet,
    input.amount,
  );
  for (const item of input.proof) {
    const node = hash(item, "proof node");
    leaf = keccak256(concatHex(leaf < node ? [leaf, node] : [node, leaf]));
  }
  const publication =
    root !== zeroHash
      ? "published"
      : reserved > 0n
        ? "funded-unpublished"
        : "unfunded";
  const proofValid =
    publication === "published" &&
    input.amount > 0n &&
    input.amount <= reserved &&
    same(leaf, root);
  const canClaim =
    publication === "published" &&
    !alreadyClaimed &&
    input.amount > 0n &&
    input.amount <= reserved - claimed &&
    proofValid;
  const creditSequence = uint(
    sequenceValue,
    "holder leaf credit sequence",
    128,
  );
  const credit = await readProFeeProgramHolderCredit(
    client,
    launch,
    asset,
    input.wallet,
  );
  ensure(
    alreadyClaimed
      ? creditSequence > 0n && creditSequence <= credit.creditedThrough
      : creditSequence === 0n,
    "holder consumed proof and credit sequence disagree",
  );
  const paymentStatus = !proofValid
    ? "unverified"
    : !alreadyClaimed
      ? "unconsumed"
      : creditSequence <= credit.paidThrough
        ? "paid"
        : "credited";
  await finish(client, launch.bootstrapInfrastructure);
  return Object.freeze({
    vault: launch.vault,
    programIndex: input.programIndex,
    cycleId: input.cycleId,
    asset,
    wallet: getAddress(input.wallet),
    amount: input.amount,
    root,
    reserved,
    claimed,
    observedAt,
    alreadyClaimed,
    publication,
    canClaim,
    proofValid,
    creditSequence,
    credit,
    paymentStatus,
    payoutAfterClaim:
      canClaim && credit.balance + input.amount >= credit.minimumClaim,
  });
}
