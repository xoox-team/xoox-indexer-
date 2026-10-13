// Vendored from the XOOX SDK; only what the indexer uses.
import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  recoverTypedDataAddress,
  zeroAddress,
  zeroHash,
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
} from "./pro-bootstrap";
import {
  assertProGraduationInfrastructureProof,
  proGraduationManifestFromProof,
  readProGraduationInfrastructure,
  type ProGraduationInfrastructureProof,
} from "./pro-graduation";
import {
  assertProFeeProgramGraduationInfrastructureProof,
  proFeeProgramGraduationManifestFromProof,
  readProFeeProgramGraduationInfrastructure,
  type ProFeeProgramGraduationInfrastructureProof,
} from "./pro-fee-program-graduation";
type ParticipantGraduation =
  | ProGraduationInfrastructureProof
  | ProFeeProgramGraduationInfrastructureProof;
import {
  readProRegisteredToken,
  type ProDiscoveryToken,
} from "./pro-discovery";
import { type ProTokenCapabilities } from "./pro-token";
import {
  proReactiveConsentAbi,
  deriveProReactiveConsentPairId,
  encodeProReactiveConsentTypedData,
  hashProReactiveConsent,
  PRO_REACTIVE_PARTICIPANT_DOMAIN,
  PRO_REACTIVE_CONSENT_PAIR_DOMAIN,
  proReactiveConsentTypes,
  type ProReactiveParticipantConsent,
} from "./pro-reactive-consent";

export const proReactiveParticipantAbi = [
  ...proReactiveConsentAbi,
  ...parseAbi([
    "struct Metadata { string name; string symbol; string description; string image; string website; string twitter; string telegram; }",
    "struct CurveConfig { address quoteAsset; uint256 phantomQuote; uint256 graduationThreshold; uint16 baseFeeBps; uint16 buyTaxBps; uint16 sellTaxBps; bool perpetual; address feeRecipient; }",
    "struct RuleConfig { uint8 rule; bytes data; }",
    "struct LaunchRequest { Metadata metadata; uint256 supply; CurveConfig curve; RuleConfig[] rules; address[] walletExemptions; bytes32 salt; uint64 deadline; }",
    "function createReactiveParticipant(LaunchRequest request,bytes32 participantSalt) returns(address token,address curve,address policy)",
    "function proTokenVersion() view returns(uint256)",
    "function factory() view returns(address)",
    "function factoryCodeHash() view returns(bytes32)",
    "function controller() view returns(address)",
    "function token() view returns(address)",
    "function supply() view returns(uint256)",
    "function registry() view returns(address)",
    "function registryCodeHash() view returns(bytes32)",
    "function activityRegistry() view returns(address)",
    "function activityRegistryCodeHash() view returns(bytes32)",
    "function linkId() view returns(bytes32)",
    "function role() view returns(uint8)",
    "function baseBuyPPM() view returns(uint32)",
    "function sensitivityPPM() view returns(uint32)",
    "function ruleData(uint8 rule) view returns(bytes)",
    "function hasRule(uint8 rule) view returns(bool)",
    "function reactive() view returns(address)",
    "function rulesActive() view returns(bool)",
    "function contextPending() view returns(bool)",
    "function migrationPending() view returns(bool)",
    "function isReactiveModule(address module) view returns(bool)",
    "function linkOfToken(address token) view returns(bytes32)",
    "function resolveReactive(bytes32 id,uint8 role,address token) view returns(address partner,uint256 baseline)",
    "function activity(address token) view returns(uint64 sequence,uint256 netTokensOut,uint256 boughtVolume,uint256 soldVolume)",
    "function volumeHighWords(address token) view returns(uint256 boughtHigh,uint256 soldHigh)",
    "function tokenReserve() view returns(uint256)",
    "function realQuoteReserve() view returns(uint256)",
    "function accruedFees() view returns(uint256)",
    "function settledTradeCount() view returns(uint64)",
    "function readyToGraduate() view returns(bool)",
    "function graduated() view returns(bool)",
    "function balanceOf(address account) view returns(uint256)",
    "function decimals() view returns(uint8)",
    "function isValidSignature(bytes32 hash,bytes signature) view returns(bytes4)",
    "function quoteAsset() view returns(address)",
    "function phantomQuote() view returns(uint256)",
    "function graduationThreshold() view returns(uint256)",
    "function baseFeeBps() view returns(uint16)",
    "function buyTaxBps() view returns(uint16)",
    "function sellTaxBps() view returns(uint16)",
    "function feeRecipient() view returns(address)",
    "function launch(address token) view returns((address curve,address policy,address creator,address quoteAsset,bytes32 configurationHash,uint256 supply,uint256 phantomQuote,uint256 graduationThreshold,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bytes32 poolId,uint256 positionId,uint8 phase,bool exists))",
    "function poolKey(address token) view returns((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
    "function poolIds(address token) view returns(bytes32)",
    "function positionIds(address token) view returns(uint256)",
    "function completed(address token) view returns(bool)",
    "event LaunchCreated(address indexed creator,address indexed token,address indexed curveAddress,address policy,uint256 supply,bytes32 configurationHash,bytes32 launchSalt,Metadata metadata,CurveConfig curveConfig,RuleConfig[] rules,address[] walletExemptions,bytes32 requestedSalt,uint64 deadline)",
    "event Transfer(address indexed from,address indexed to,uint256 value)",
  ]),
] as const;

export type ProReactiveParticipantSource = Readonly<{
  bootstrapInfrastructure: ProBootstrapProof;
  graduationInfrastructure?: ParticipantGraduation;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  factory: Address;
  registry: Address;
  helper: Address;
  activityRegistry: Address;
}>;
export type ProReactiveParticipantLeg = Readonly<{
  registered: ProDiscoveryToken;
  participantId: Hex;
  token: Address;
  curve: Address;
  policy: Address;
  creator: Address;
  configurationHash: Hex;
  supply: bigint;
  role: 0 | 1;
  module: Address;
  moduleCodeHash: Hex;
  baseBuyPPM: number;
  sensitivityPPM: number;
  nonce: bigint;
  partnerId: Hex;
  finalPairId: Hex;
  finalized: boolean;
  ruleData: Hex;
  activity: Readonly<{
    sequence: bigint;
    netBought: bigint;
    boughtVolume: bigint;
    soldVolume: bigint;
    boughtVolumeHigh: bigint;
    soldVolumeHigh: bigint;
  }>;
  curveState: Readonly<{
    tokenReserve: bigint;
    realQuoteReserve: bigint;
    accruedFees: bigint;
    settledTradeCount: bigint;
    graduationReady: boolean;
    reservesSwept: boolean;
  }>;
  rulesActive: boolean;
}>;
export type ProReactiveParticipantSnapshot = Readonly<{
  source: ProReactiveParticipantSource;
  status: "pending" | "finalized";
  own: ProReactiveParticipantLeg;
  partner?: ProReactiveParticipantLeg;
  finalPairId?: Hex;
}>;
export type ProReactiveParticipantContext = Readonly<{
  account: Address;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
}>;
export type ProReactiveParticipantCreationContext =
  ProReactiveParticipantContext &
    Readonly<{
      launchSalt: Hex;
      deadline: bigint;
      quoteDecimals: number;
    }>;
export type ProReactiveParticipantRequest = Readonly<{
  chainId: bigint;
  address: Address;
  account: Address;
  abi: typeof proReactiveParticipantAbi;
  functionName:
    | "createReactiveParticipant"
    | "revokeConsent"
    | "finalizeConsent";
  args: readonly unknown[];
  value: 0n;
}>;
export type ProReactiveParticipantCreationAcceptance = Readonly<{
  transactionHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  participant: ProReactiveParticipantSnapshot;
}>;

const sources = new WeakSet<object>(),
  snapshots = new WeakSet<object>();
const creations = new WeakSet<object>(),
  creationSimulations = new WeakSet<object>();
const creationAcceptances = new WeakSet<object>();
const histories = new WeakMap<
  object,
  readonly ProReactiveParticipantSource[]
>();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const R20 = 1n << 20n;
function require_(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error("Reactive participant " + message + ".");
}
function equal(a: unknown, b: unknown, label: string) {
  require_(
    typeof a === "string" && typeof b === "string" ? same(a, b) : a === b,
    label + " mismatch",
  );
}
function addr(v: unknown, label: string, allowZero = false): Address {
  require_(
    typeof v === "string" &&
      isAddress(v, { strict: true }) &&
      (allowZero || !same(v, zeroAddress)),
    label + " requires an address",
  );
  return getAddress(v);
}
function word(v: unknown, label: string, allowZero = false): Hex {
  require_(
    typeof v === "string" &&
      /^0x[\da-fA-F]{64}$/.test(v) &&
      (allowZero || !same(v, zeroHash)),
    label + " requires bytes32",
  );
  return v.toLowerCase() as Hex;
}
function uint(v: unknown, label: string, bits = 256): bigint {
  require_(
    typeof v === "bigint" && v >= 0n && v < 1n << BigInt(bits),
    label + " requires an exact integer",
  );
  return v;
}
function bytes(v: unknown, label: string): Hex {
  require_(
    typeof v === "string" && /^0x(?:[\da-fA-F]{2})*$/.test(v),
    label + " requires bytes",
  );
  return v.toLowerCase() as Hex;
}
function obj(v: unknown, label: string): Record<string, unknown> {
  require_(
    v !== null && typeof v === "object" && !Array.isArray(v),
    label + " requires an object",
  );
  return v as Record<string, unknown>;
}
function issued<T extends object>(
  set: WeakSet<object>,
  value: T,
  label: string,
): asserts value is T {
  require_(
    value !== null && typeof value === "object" && set.has(value),
    label + " must be reader-issued",
  );
}
export function assertProReactiveParticipantSource(
  value: ProReactiveParticipantSource,
): void {
  issued(sources, value, "source");
}
export function assertProReactiveParticipantSnapshot(
  value: ProReactiveParticipantSnapshot,
): void {
  issued(snapshots, value, "snapshot");
}
export function assertProReactiveParticipantCreationAcceptance(
  value: ProReactiveParticipantCreationAcceptance,
): void {
  issued(creationAcceptances, value, "creation acceptance");
}

async function canonical(
  client: PublicClient,
  source: Pick<
    ProReactiveParticipantSource,
    "chainId" | "blockNumber" | "blockHash" | "blockTimestamp"
  >,
) {
  equal(BigInt(await client.getChainId()), source.chainId, "canonical chain");
  const h = await client.getBlock({ blockNumber: source.blockNumber });
  equal(h.number, source.blockNumber, "canonical height");
  equal(h.hash, source.blockHash, "canonical hash");
  equal(h.timestamp, source.blockTimestamp, "canonical time");
}
async function code(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  target: Address,
): Promise<Hex> {
  return bytes(
    await client.request({
      method: "eth_getCode",
      params: [target, { blockHash: source.blockHash, requireCanonical: true }],
    } as never),
    "canonical runtime",
  );
}
async function read(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  target: Address,
  name: string,
  args: readonly unknown[] = [],
): Promise<unknown> {
  const data = encodeFunctionData({
    abi: proReactiveParticipantAbi,
    functionName: name,
    args,
  } as never);
  const raw = bytes(
    await client.request({
      method: "eth_call",
      params: [
        { to: target, data },
        { blockHash: source.blockHash, requireCanonical: true },
      ],
    } as never),
    "canonical return",
  );
  const value = decodeFunctionResult({
    abi: proReactiveParticipantAbi,
    functionName: name,
    data: raw,
  } as never);
  equal(
    raw,
    encodeFunctionResult({
      abi: proReactiveParticipantAbi,
      functionName: name,
      result: value,
    } as never),
    "canonical ABI return",
  );
  return value;
}
function context(
  source: ProReactiveParticipantSource,
  raw: ProReactiveParticipantContext,
): ProReactiveParticipantContext {
  const captured = Object.freeze({
    account: addr(raw.account, "wallet"),
    chainId: uint(raw.chainId, "chain"),
    blockNumber: uint(raw.blockNumber, "height"),
    blockHash: word(raw.blockHash, "block"),
  });
  equal(captured.chainId, source.chainId, "wallet chain");
  equal(captured.blockNumber, source.blockNumber, "wallet height");
  equal(captured.blockHash, source.blockHash, "wallet snapshot");
  require_(
    !Object.values(source.bootstrapInfrastructure.components).some(
      (c) => c && same(c.address, captured.account),
    ),
    "wallet aliases infrastructure",
  );
  return captured;
}
/** Reissues the reviewed v3 source at its original canonical snapshot. A saved draft cannot supply this capability. */
export type ProLegacyReactiveParticipantSource = Omit<
  ProReactiveParticipantSource,
  "graduationInfrastructure"
> &
  Readonly<{
    graduationInfrastructure?: ProGraduationInfrastructureProof;
  }>;
function assertLegacyParticipantSource(
  value: ProReactiveParticipantSource,
): asserts value is ProLegacyReactiveParticipantSource {
  require_(
    value.bootstrapInfrastructure.sourceReview.version === 3 &&
      (!value.graduationInfrastructure ||
        value.graduationInfrastructure.version === 1),
    "legacy participant source profile changed",
  );
}
export async function readProReactiveParticipantSource(
  client: PublicClient,
  bootstrap: ProBootstrapProof,
  graduation?: ProGraduationInfrastructureProof,
): Promise<ProLegacyReactiveParticipantSource> {
  require_(
    bootstrap.sourceReview.version === 3,
    "legacy participant source requires reviewed v3",
  );
  const result = await readParticipantSource(client, bootstrap, graduation, 3);
  assertLegacyParticipantSource(result);
  return result;
}
/** Read-only source4 participant admission; legacy participant creation stays v3. */
export async function readProFeeProgramReactiveParticipantSource(
  client: PublicClient,
  bootstrap: ProBootstrapProof,
  graduation?: ProFeeProgramGraduationInfrastructureProof,
): Promise<ProReactiveParticipantSource> {
  require_(
    bootstrap.sourceReview.version === 4,
    "fee-program participant source requires reviewed v4",
  );
  return readParticipantSource(client, bootstrap, graduation, 4);
}
async function readParticipantSource(
  client: PublicClient,
  bootstrap: ProBootstrapProof,
  graduation: ParticipantGraduation | undefined,
  profile: 3 | 4,
): Promise<ProReactiveParticipantSource> {
  assertProBootstrapProof(bootstrap);
  require_(
    bootstrap.sourceReview.version === profile &&
      bootstrap.configuration.reactive &&
      bootstrap.reactiveConsentProfile === "pending-participant-v2",
    "requires reviewed v3 pending-participant source",
  );
  if (graduation) {
    if (profile === 4) {
      require_(
        graduation.version === 4,
        "fee-program participant requires v4 graduation",
      );
      assertProFeeProgramGraduationInfrastructureProof(graduation);
    } else {
      require_(
        graduation.version === 1,
        "legacy participant requires legacy graduation",
      );
      assertProGraduationInfrastructureProof(graduation);
    }
    equal(graduation.chainId, bootstrap.chainId, "graduation chain");
    equal(
      graduation.components.factory.address,
      bootstrap.factory,
      "graduation Factory",
    );
    equal(graduation.blockNumber, bootstrap.blockNumber, "graduation height");
    equal(graduation.blockHash, bootstrap.blockHash, "graduation snapshot");
    equal(
      graduation.blockTimestamp,
      bootstrap.blockTimestamp,
      "graduation time",
    );
  }
  const selector = {
    blockNumber: bootstrap.blockNumber,
    blockHash: bootstrap.blockHash,
  };
  const b = await readProBootstrapInfrastructure(
    client,
    bootstrap.factory,
    proBootstrapManifestFromProof(bootstrap),
    selector,
  );
  require_(
    b.sourceReview.version === profile &&
      b.configuration.reactive &&
      b.reactiveConsentProfile === "pending-participant-v2",
    "fresh source lacks participant profile",
  );
  const g =
    graduation?.version === 4
      ? await readProFeeProgramGraduationInfrastructure(
          client,
          b,
          proFeeProgramGraduationManifestFromProof(graduation),
        )
      : graduation
        ? await readProGraduationInfrastructure(
            client,
            b.factory,
            proGraduationManifestFromProof(graduation),
            selector,
          )
        : undefined;
  const result: ProReactiveParticipantSource = Object.freeze({
    bootstrapInfrastructure: b,
    ...(g ? { graduationInfrastructure: g } : {}),
    chainId: b.chainId,
    blockNumber: b.blockNumber,
    blockHash: b.blockHash,
    blockTimestamp: b.blockTimestamp,
    factory: b.factory,
    registry: b.components.linkRegistry!.address,
    helper: b.components.reactiveDeployer!.address,
    activityRegistry: b.partnerRegistry,
  });
  equal(
    await read(client, result, result.factory, "reactiveParticipantVersion"),
    2n,
    "Factory participant version",
  );
  for (const target of [result.registry, result.helper])
    equal(
      await read(client, result, target, "reactiveConsentVersion"),
      2n,
      "consent version",
    );
  equal(
    await read(client, result, result.registry, "factoryCodeHash"),
    b.components.factory!.codeHash,
    "Registry Factory code hash",
  );
  equal(
    await read(client, result, result.registry, "PARTICIPANT_DOMAIN"),
    PRO_REACTIVE_PARTICIPANT_DOMAIN,
    "participant domain",
  );
  equal(
    await read(client, result, result.registry, "FINAL_PAIR_DOMAIN"),
    PRO_REACTIVE_CONSENT_PAIR_DOMAIN,
    "pair domain",
  );
  const expectedTypeHash = keccak256(
    new TextEncoder().encode(
      "ParticipantConsent(" +
        proReactiveConsentTypes.ParticipantConsent.map(
          (f) => f.type + " " + f.name,
        ).join(",") +
        ")",
    ),
  );
  equal(
    await read(client, result, result.registry, "CONSENT_TYPEHASH"),
    expectedTypeHash,
    "consent type hash",
  );
  await canonical(client, result);
  sources.add(result);
  return result;
}

async function graduationState(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  leg: ProReactiveParticipantLeg,
  pristine: boolean,
) {
  const g = source.graduationInfrastructure;
  require_(
    g !== undefined,
    "graduating participant requires issued graduation source",
  );
  require_(
    (g.supportedGraduatingBitmap & R20) !== 0n,
    "graduating participant rule is unsupported",
  );
  const registry = g.components.registry.address;
  const record = obj(
    await read(client, source, registry, "launch", [leg.token]),
    "graduation registration",
  );
  for (const [key, value] of Object.entries({
    curve: leg.curve,
    policy: leg.policy,
    creator: leg.creator,
    configurationHash: leg.configurationHash,
    supply: leg.supply,
    exists: true,
  }))
    equal(record[key], value, "graduation " + key);
  const quote = addr(
    await read(client, source, leg.curve, "quoteAsset"),
    "quote asset",
    true,
  );
  equal(record.quoteAsset, quote, "graduation quote");
  equal(
    record.phantomQuote,
    await read(client, source, leg.curve, "phantomQuote"),
    "graduation phantom quote",
  );
  equal(
    record.graduationThreshold,
    await read(client, source, leg.curve, "graduationThreshold"),
    "graduation threshold",
  );
  const poolId = word(record.poolId, "registered pool ID");
  equal(
    await read(client, source, registry, "poolIds", [leg.token]),
    poolId,
    "planned pool ID",
  );
  const key = obj(
    await read(client, source, registry, "poolKey", [leg.token]),
    "planned pool key",
  );
  const ordered = [leg.token, quote].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  equal(key.currency0, ordered[0], "pool currency0");
  equal(key.currency1, ordered[1], "pool currency1");
  equal(key.fee, 0, "pool fee");
  equal(key.tickSpacing, 200, "pool spacing");
  equal(key.hooks, g.components.hook.address, "pool hook");
  equal(
    keccak256(
      encodeAbiParameters(
        parseAbiParameters("address,address,uint24,int24,address"),
        [ordered[0], ordered[1], 0, 200, g.components.hook.address],
      ),
    ),
    poolId,
    "pool key commitment",
  );
  const phase = Number(record.phase),
    position = uint(record.positionId, "position");
  equal(
    await read(client, source, registry, "positionIds", [leg.token]),
    position,
    "position mapping",
  );
  require_(
    phase === 0 || phase === 2 || phase === 4,
    "unsupported physical lifecycle phase",
  );
  equal(
    await read(client, source, g.components.executor.address, "completed", [
      leg.token,
    ]),
    phase === 4,
    "completed lifecycle",
  );
  if (pristine) {
    equal(phase, 0, "pristine Trading phase");
    equal(position, 0n, "pristine position");
    for (const k of ["sweptQuote", "sweptTokens", "sweptAt"])
      equal(record[k], 0n, "pristine " + k);
  } else {
    equal(
      leg.curveState.reservesSwept,
      phase === 2 || phase === 4,
      "physical reserve sweep",
    );
    equal(leg.rulesActive, phase !== 4, "physical Policy state");
    require_(
      phase === 4 ? position > 0n : position === 0n,
      "physical position phase mismatch",
    );
    if (phase !== 0)
      require_(
        leg.curveState.graduationReady,
        "terminal Curve lacks readiness",
      );
  }
}

async function readLeg(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  token: Address,
): Promise<ProReactiveParticipantLeg> {
  const registered = await readProRegisteredToken(
    client,
    source.bootstrapInfrastructure,
    token,
  );
  equal(registered.rulesBitmap, R20, "single R20 participant bitmap");
  const participantId = word(
    await read(client, source, source.registry, "participantOfToken", [token]),
    "registered participant ID",
  );
  const p = obj(
    await read(client, source, source.registry, "participant", [participantId]),
    "participant record",
  );
  for (const [key, value] of Object.entries({
    token,
    creator: registered.creator,
    configurationHash: registered.configurationHash,
  }))
    equal(p[key], value, "participant " + key);
  require_(p.role === 0 || p.role === 1, "participant role invalid");
  require_(
    typeof p.finalized === "boolean",
    "participant finalization invalid",
  );
  const role = p.role as 0 | 1,
    nonce = uint(p.nonce, "consent nonce"),
    partnerId = word(p.partnerId, "partner ID", true),
    finalPairId = word(p.finalPairId, "final pair ID", true);
  const payload = bytes(
    await read(client, source, registered.policy, "ruleData", [20]),
    "R20 payload",
  );
  const params = parseAbiParameters("bytes32,uint256,uint256,uint256"),
    decoded = decodeAbiParameters(params, payload);
  equal(payload, encodeAbiParameters(params, decoded), "canonical R20 payload");
  equal(decoded[0], participantId, "immutable participant payload ID");
  equal(decoded[1], BigInt(role), "immutable role");
  require_(
    decoded[2] > 0n && decoded[2] <= 1_000_000n && decoded[3] <= 1_000_000n,
    "R20 percentages invalid",
  );
  equal(
    await read(client, source, registered.policy, "hasRule", [20]),
    true,
    "Policy rule registration",
  );
  equal(
    await read(client, source, registered.policy, "contextPending"),
    false,
    "idle trade context",
  );
  equal(
    await read(client, source, registered.policy, "migrationPending"),
    false,
    "idle migration context",
  );
  const module = addr(
    await read(client, source, registered.policy, "reactive"),
    "Reactive module",
  );
  require_(
    ![
      token,
      registered.curve,
      registered.policy,
      registered.creator,
      ...Object.values(source.bootstrapInfrastructure.components)
        .filter(Boolean)
        .map((c) => c!.address),
    ].some((a) => same(a, module)),
    "module aliases captured identity",
  );
  equal(
    await read(client, source, source.helper, "isReactiveModule", [module]),
    true,
    "genuine helper module registration",
  );
  const runtime = await code(client, source, module);
  require_(runtime !== "0x", "module runtime absent");
  const bindings = {
    controller: registered.policy,
    factory: source.factory,
    token,
    supply: registered.supply,
    registry: source.registry,
    registryCodeHash:
      source.bootstrapInfrastructure.components.linkRegistry!.codeHash,
    activityRegistry: source.activityRegistry,
    activityRegistryCodeHash:
      source.bootstrapInfrastructure.components.partnerRegistry!.codeHash,
    linkId: participantId,
    role,
    baseBuyPPM: Number(decoded[2]),
    sensitivityPPM: Number(decoded[3]),
  };
  for (const [key, value] of Object.entries(bindings))
    equal(await read(client, source, module, key), value, "module " + key);
  const activityRaw = await read(
    client,
    source,
    source.activityRegistry,
    "activity",
    [token],
  );
  const highRaw = await read(
    client,
    source,
    source.activityRegistry,
    "volumeHighWords",
    [token],
  );
  require_(
    Array.isArray(activityRaw) &&
      activityRaw.length === 4 &&
      Array.isArray(highRaw) &&
      highRaw.length === 2,
    "authentic activity tuple invalid",
  );
  const activity = Object.freeze({
    sequence: uint(activityRaw[0], "sequence", 64),
    netBought: uint(activityRaw[1], "net bought"),
    boughtVolume: uint(activityRaw[2], "bought volume"),
    soldVolume: uint(activityRaw[3], "sold volume"),
    boughtVolumeHigh: uint(highRaw[0], "bought high"),
    soldVolumeHigh: uint(highRaw[1], "sold high"),
  });
  const grossBought =
      (activity.boughtVolumeHigh << 256n) + activity.boughtVolume,
    grossSold = (activity.soldVolumeHigh << 256n) + activity.soldVolume;
  require_(
    grossBought >= grossSold &&
      grossBought - grossSold === activity.netBought &&
      activity.netBought <= registered.supply,
    "authentic net and gross activity disagree",
  );
  require_(
    grossBought + grossSold <= activity.sequence * registered.supply,
    "authentic volume exceeds settled activity bound",
  );
  const reserveNames = [
    "tokenReserve",
    "realQuoteReserve",
    "accruedFees",
    "settledTradeCount",
  ] as const;
  const amounts = await Promise.all(
    reserveNames.map((n) => read(client, source, registered.curve, n)),
  );
  const ready = await read(client, source, registered.curve, "readyToGraduate"),
    swept = await read(client, source, registered.curve, "graduated"),
    active = await read(client, source, registered.policy, "rulesActive");
  require_(
    typeof ready === "boolean" &&
      typeof swept === "boolean" &&
      typeof active === "boolean",
    "Curve/Policy flags invalid",
  );
  const curveState = Object.freeze({
    tokenReserve: uint(amounts[0], "token reserve"),
    realQuoteReserve: uint(amounts[1], "quote reserve"),
    accruedFees: uint(amounts[2], "fees"),
    settledTradeCount: uint(amounts[3], "trade count", 64),
    graduationReady: ready,
    reservesSwept: swept,
  });
  equal(
    activity.sequence,
    curveState.settledTradeCount,
    "authentic trade sequence",
  );
  equal(
    await read(client, source, source.registry, "finalPairIdOfParticipant", [
      participantId,
    ]),
    finalPairId,
    "final pair mapping",
  );
  const leg: ProReactiveParticipantLeg = Object.freeze({
    registered,
    participantId,
    token,
    curve: registered.curve,
    policy: registered.policy,
    creator: registered.creator,
    configurationHash: registered.configurationHash,
    supply: registered.supply,
    role,
    module,
    moduleCodeHash: keccak256(runtime),
    baseBuyPPM: Number(decoded[2]),
    sensitivityPPM: Number(decoded[3]),
    nonce,
    partnerId,
    finalPairId,
    finalized: p.finalized,
    ruleData: payload,
    activity,
    curveState,
    rulesActive: active,
  });
  if (!leg.finalized) {
    equal(partnerId, zeroHash, "pending partner");
    equal(finalPairId, zeroHash, "pending final pair");
    equal(
      await read(client, source, source.registry, "linkOfToken", [token]),
      zeroHash,
      "pending legacy link mapping",
    );
    for (const v of Object.values(activity))
      equal(v, 0n, "pristine authentic activity");
    equal(
      curveState.tokenReserve,
      registered.supply,
      "pristine accounted custody",
    );
    equal(
      await read(client, source, token, "balanceOf", [registered.curve]),
      registered.supply,
      "pristine actual custody",
    );
    for (const n of [
      "realQuoteReserve",
      "accruedFees",
      "settledTradeCount",
    ] as const)
      equal(curveState[n], 0n, "pristine " + n);
    equal(ready, false, "pristine readiness");
    equal(swept, false, "pristine sweep");
    equal(active, true, "pristine active Policy");
  } else {
    require_(
      partnerId !== zeroHash && finalPairId !== zeroHash && nonce > 0n,
      "finalized participant lacks reciprocal commitment",
    );
    equal(
      await read(client, source, source.registry, "linkOfToken", [token]),
      participantId,
      "finalized own link mapping",
    );
    if (swept) {
      equal(curveState.tokenReserve, 0n, "swept token reserve");
      equal(curveState.realQuoteReserve, 0n, "swept quote reserve");
    } else
      equal(
        curveState.tokenReserve + activity.netBought,
        registered.supply,
        "live reserve activity accounting",
      );
  }
  if (!registered.perpetual)
    await graduationState(client, source, leg, !leg.finalized);
  else {
    equal(swept, false, "permanent reserve sweep");
    equal(ready, false, "permanent readiness");
    equal(active, true, "permanent active Policy");
  }
  return leg;
}

/** Pending identity is a registration proof only; it does not authorize a cap, swap, or price publication. */
export async function readProReactiveParticipant(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  tokenInput: Address,
): Promise<ProReactiveParticipantSnapshot> {
  assertProReactiveParticipantSource(source);
  const token = addr(tokenInput, "participant token");
  await canonical(client, source);
  const own = await readLeg(client, source, token);
  let partner: ProReactiveParticipantLeg | undefined;
  if (own.finalized) {
    const raw = obj(
      await read(client, source, source.registry, "participant", [
        own.partnerId,
      ]),
      "partner record",
    );
    partner = await readLeg(client, source, addr(raw.token, "partner token"));
    require_(
      partner.finalized && partner.role !== own.role,
      "partner lacks complementary finalized role",
    );
    equal(partner.participantId, own.partnerId, "reciprocal partner identity");
    equal(partner.partnerId, own.participantId, "reciprocal own identity");
    equal(partner.finalPairId, own.finalPairId, "reciprocal final pair");
    for (const key of [
      "participantId",
      "token",
      "curve",
      "policy",
      "module",
    ] as const)
      require_(
        !same(own[key], partner[key]),
        "distinct participant " + key + " required",
      );
    const first = own.role === 0 ? own : partner,
      second = own.role === 1 ? own : partner;
    const id = deriveProReactiveConsentPairId(source, first, second);
    equal(id, own.finalPairId, "shared pair commitment");
    equal(
      await read(client, source, source.registry, "deriveFinalPairId", [
        first.participantId,
        second.participantId,
      ]),
      id,
      "onchain pair commitment",
    );
    const pair = obj(
      await read(client, source, source.registry, "finalPair", [id]),
      "ordered final pair record",
    );
    for (const [key, value] of Object.entries({
      participantId0: first.participantId,
      participantId1: second.participantId,
      token0: first.token,
      token1: second.token,
      configurationHash0: first.configurationHash,
      configurationHash1: second.configurationHash,
      creator0: first.creator,
      creator1: second.creator,
    }))
      equal(pair[key], value, "final pair " + key);
    for (const [leg, other] of [
      [own, partner],
      [partner, own],
    ] as const) {
      const resolved = await read(
        client,
        source,
        source.registry,
        "resolveReactive",
        [leg.participantId, leg.role, leg.token],
      );
      require_(
        Array.isArray(resolved) && resolved.length === 2,
        "resolved participant tuple invalid",
      );
      equal(resolved[0], other.token, "resolved partner");
      equal(resolved[1], 0n, "genesis baseline");
    }
  }
  await canonical(client, source);
  const result: ProReactiveParticipantSnapshot = Object.freeze({
    source,
    status: own.finalized ? "finalized" : "pending",
    own,
    ...(partner ? { partner, finalPairId: own.finalPairId } : {}),
  });
  snapshots.add(result);
  return result;
}

/** Reissues the same reviewed source at a newly selected canonical block, never a saved input proof. */
export async function refreshProReactiveParticipantSource(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  selector?: Readonly<{ blockNumber: bigint; blockHash: Hex }>,
): Promise<ProReactiveParticipantSource> {
  assertProReactiveParticipantSource(source);
  const capturedSelector = selector
    ? Object.freeze({
        blockNumber: uint(selector.blockNumber, "selected source height"),
        blockHash: word(selector.blockHash, "selected source hash"),
      })
    : undefined;
  await canonical(client, source);
  const header = capturedSelector ? undefined : await client.getBlock();
  const selected = capturedSelector ?? {
    blockNumber: uint(header!.number, "fresh source height"),
    blockHash: word(header!.hash, "fresh source hash"),
  };
  const b = await readProBootstrapInfrastructure(
    client,
    source.factory,
    proBootstrapManifestFromProof(source.bootstrapInfrastructure),
    selected,
  );
  const originalGraduation = source.graduationInfrastructure;
  const g =
    originalGraduation?.version === 4
      ? await readProFeeProgramGraduationInfrastructure(
          client,
          b,
          proFeeProgramGraduationManifestFromProof(originalGraduation),
        )
      : originalGraduation
        ? await readProGraduationInfrastructure(
            client,
            source.factory,
            proGraduationManifestFromProof(originalGraduation),
            selected,
          )
        : undefined;
  if (b.sourceReview.version === 4) {
    require_(
      !g || g.version === 4,
      "fee-program participant refresh changed profile",
    );
    return readProFeeProgramReactiveParticipantSource(
      client,
      b,
      g?.version === 4 ? g : undefined,
    );
  }
  require_(!g || g.version === 1, "legacy participant refresh changed profile");
  return readProReactiveParticipantSource(
    client,
    b,
    g?.version === 1 ? g : undefined,
  );
}
function capabilities(
  source: ProReactiveParticipantSource,
): ProTokenCapabilities {
  const b = source.bootstrapInfrastructure,
    g = source.graduationInfrastructure;
  require_(
    b.sourceReview.version === 3 && (!g || g.version === 1),
    "legacy participant creation requires v3; source4 trading uses the fee-program launch path",
  );
  const legacyGraduation = g?.version === 1 ? g : undefined;
  return Object.freeze({
    version: 1,
    supportedBitmap: b.supportedBitmap,
    factory: b.factory,
    partnerRegistry: b.partnerRegistry,
    supportsGraduation: g !== undefined,
    chainId: b.chainId,
    blockNumber: b.blockNumber,
    blockHash: b.blockHash,
    blockTimestamp: b.blockTimestamp,
    ...(legacyGraduation
      ? {
          supportedGraduatingBitmap: legacyGraduation.supportedGraduatingBitmap,
          graduationInfrastructure: legacyGraduation,
        }
      : {}),
    reactiveInfrastructure: Object.freeze({
      helper: source.helper,
      linkRegistry: source.registry,
      helperCodeHash: b.components.reactiveDeployer!.codeHash,
      linkRegistryCodeHash: b.components.linkRegistry!.codeHash,
    }),
  });
}
function request(
  source: ProReactiveParticipantSource,
  wallet: ProReactiveParticipantContext,
  name: ProReactiveParticipantRequest["functionName"],
  args: readonly unknown[],
): ProReactiveParticipantRequest {
  return Object.freeze({
    chainId: source.chainId,
    address:
      name === "createReactiveParticipant" ? source.factory : source.registry,
    account: wallet.account,
    abi: proReactiveParticipantAbi,
    functionName: name,
    args: Object.freeze(args),
    value: 0n,
  });
}
function assertRequest(
  raw: unknown,
  expected: ProReactiveParticipantRequest,
  data: Hex,
  wallet: Address,
  chainId: bigint,
) {
  const r = obj(raw, "transaction request");
  const allowed = new Set([
    "chainId",
    "chain",
    "address",
    "account",
    "abi",
    "functionName",
    "args",
    "value",
    "data",
    "dataSuffix",
    "blockNumber",
    "blockHash",
    "requireCanonical",
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
    "accessList",
  ]);
  require_(
    Reflect.ownKeys(r).every((k) => typeof k === "string" && allowed.has(k)),
    "transaction request has unsupported fields",
  );
  equal(wallet, expected.account, "request wallet");
  equal(chainId, expected.chainId, "request chain");
  equal(r.address, expected.address, "request destination");
  equal(r.functionName, expected.functionName, "request entry point");
  equal(r.value ?? 0n, 0n, "nonpayable request");
  const a =
    typeof r.account === "string"
      ? r.account
      : obj(r.account, "request account").address;
  equal(a, wallet, "request account");
  if (r.chainId !== undefined)
    equal(BigInt(r.chainId as number | bigint), chainId, "request chain ID");
  if (r.chain !== undefined)
    equal(
      BigInt(obj(r.chain, "request chain").id as number | bigint),
      chainId,
      "request chain object",
    );
  require_(
    r.dataSuffix === undefined || r.dataSuffix === "0x",
    "request suffix must be empty",
  );
  equal(
    encodeFunctionData({
      abi: r.abi,
      functionName: r.functionName,
      args: r.args,
    } as never),
    data,
    "request encoded calldata",
  );
  if (r.data !== undefined) equal(r.data, data, "request raw calldata");
}
async function callSimulation(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  r: ProReactiveParticipantRequest,
  data: Hex,
) {
  await canonical(client, source);
  const raw = bytes(
    await client.request({
      method: "eth_call",
      params: [
        { from: r.account, to: r.address, data, value: "0x0" },
        { blockHash: source.blockHash, requireCanonical: true },
      ],
    } as never),
    "simulation return",
  );
  const result = decodeFunctionResult({
    abi: proReactiveParticipantAbi,
    functionName: r.functionName,
    data: raw,
  } as never);
  equal(
    raw,
    encodeFunctionResult({
      abi: proReactiveParticipantAbi,
      functionName: r.functionName,
      result,
    } as never),
    "canonical simulation return",
  );
  return result;
}
type Receipt = Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
function events(receipt: Receipt, name: string, emitter: Address) {
  const event = getAbiItem({
    abi: proReactiveParticipantAbi,
    name,
  } as never) as AbiEvent;
  const topic = encodeEventTopics({
    abi: [event],
    eventName: name,
  } as never)[0];
  return receipt.logs
    .filter(
      (log) =>
        same(log.address, emitter) && same(log.topics[0] ?? "0x", topic!),
    )
    .map((log) => ({
      log,
      args: decodeEventLog({
        abi: [event],
        data: log.data,
        topics: log.topics,
        strict: true,
      }).args as Record<string, unknown>,
    }));
}
async function mined(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  r: ProReactiveParticipantRequest,
  data: Hex,
  hashInput: Hex,
  history: readonly ProReactiveParticipantSource[],
) {
  const hash = word(hashInput, "submitted transaction hash");
  for (const h of history) await canonical(client, h);
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ]);
  equal(receipt.status, "success", "receipt status");
  equal(receipt.transactionHash, hash, "receipt hash");
  equal(tx.hash, hash, "mined hash");
  for (const v of [receipt.from, tx.from]) equal(v, r.account, "mined sender");
  for (const v of [receipt.to, tx.to]) equal(v, r.address, "mined destination");
  equal(tx.chainId, Number(source.chainId), "mined chain");
  equal(tx.value, 0n, "mined nonpayable value");
  equal(tx.input, data, "mined exact calldata");
  const blockNumber = uint(receipt.blockNumber, "mined height"),
    blockHash = word(receipt.blockHash, "mined block");
  equal(tx.blockNumber, blockNumber, "transaction height");
  equal(tx.blockHash, blockHash, "transaction block");
  require_(
    Number.isSafeInteger(receipt.transactionIndex) &&
      receipt.transactionIndex >= 0,
    "receipt index invalid",
  );
  equal(tx.transactionIndex, receipt.transactionIndex, "transaction index");
  require_(blockNumber >= source.blockNumber, "receipt predates source");
  const h = await client.getBlock({ blockNumber });
  equal(h.hash, blockHash, "mined canonical block");
  equal(h.number, blockNumber, "mined canonical height");
  const blockTimestamp = uint(h.timestamp, "mined time", 64);
  require_(
    blockTimestamp >= source.blockTimestamp,
    "receipt predates source time",
  );
  for (const log of receipt.logs) {
    equal(log.transactionHash, hash, "log transaction");
    equal(log.blockHash, blockHash, "log block");
    equal(log.blockNumber, blockNumber, "log height");
    equal(
      log.transactionIndex,
      receipt.transactionIndex,
      "log transaction index",
    );
    equal(log.removed, false, "canonical log");
    require_(
      Number.isSafeInteger(log.logIndex) && log.logIndex >= 0,
      "log index invalid",
    );
  }
  require_(
    new Set(receipt.logs.map((l) => l.logIndex)).size === receipt.logs.length,
    "duplicate receipt log index",
  );
  const fresh = await refreshProReactiveParticipantSource(client, source, {
    blockNumber,
    blockHash,
  });
  return { receipt, hash, blockNumber, blockHash, blockTimestamp, fresh };
}

export type ProReactiveParticipantPreparedConsent = Readonly<{
  source: ProReactiveParticipantSource;
  first: ProReactiveParticipantSnapshot;
  second: ProReactiveParticipantSnapshot;
  message: ProReactiveParticipantConsent;
  typedData: ReturnType<typeof encodeProReactiveConsentTypedData>;
  digest: Hex;
}>;
export type ProReactiveParticipantVerifiedConsent = Readonly<{
  prepared: ProReactiveParticipantPreparedConsent;
  signature0: Hex;
  signature1: Hex;
}>;
export type ProReactiveParticipantActionIntent = Readonly<{
  kind: "revocation" | "finalization";
  source: ProReactiveParticipantSource;
  context: ProReactiveParticipantContext;
  participant: ProReactiveParticipantSnapshot;
  consent?: ProReactiveParticipantVerifiedConsent;
  request: ProReactiveParticipantRequest;
  data: Hex;
}>;
export type ProReactiveParticipantActionSimulation = Readonly<{
  intent: ProReactiveParticipantActionIntent;
}>;
export type ProReactiveParticipantActionAcceptance = Readonly<{
  kind: "revocation" | "finalization";
  transactionHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  participant: ProReactiveParticipantSnapshot;
}>;
const preparedConsents = new WeakSet<object>(),
  verifiedConsents = new WeakSet<object>(),
  actions = new WeakSet<object>(),
  actionSimulations = new WeakSet<object>(),
  actionAcceptances = new WeakSet<object>();
export function assertProReactiveParticipantPreparedConsent(
  value: ProReactiveParticipantPreparedConsent,
): void {
  issued(preparedConsents, value, "prepared consent");
}
export function assertProReactiveParticipantVerifiedConsent(
  value: ProReactiveParticipantVerifiedConsent,
): void {
  issued(verifiedConsents, value, "verified consent");
}
export function assertProReactiveParticipantActionIntent(
  value: ProReactiveParticipantActionIntent,
): void {
  issued(actions, value, "action intent");
}
export function assertProReactiveParticipantActionSimulation(
  value: ProReactiveParticipantActionSimulation,
): void {
  issued(actionSimulations, value, "action simulation");
}
export function assertProReactiveParticipantActionAcceptance(
  value: ProReactiveParticipantActionAcceptance,
): void {
  issued(actionAcceptances, value, "action acceptance");
}
function consentMessage(
  source: ProReactiveParticipantSource,
  first: ProReactiveParticipantLeg,
  second: ProReactiveParticipantLeg,
  deadline: bigint,
): ProReactiveParticipantConsent {
  return Object.freeze({
    factory: source.factory,
    protocolVersion: 2n,
    participantId0: first.participantId,
    participantId1: second.participantId,
    token0: first.token,
    token1: second.token,
    configurationHash0: first.configurationHash,
    configurationHash1: second.configurationHash,
    creator0: first.creator,
    creator1: second.creator,
    nonce0: first.nonce,
    nonce1: second.nonce,
    deadline,
    finalPairId: deriveProReactiveConsentPairId(source, first, second),
  });
}
/** Reads both pristine registrations and binds their current nonces to the exact ordered EIP-712 message. */
export async function prepareProReactiveParticipantConsent(
  client: PublicClient,
  source: ProReactiveParticipantSource,
  firstToken: Address,
  secondToken: Address,
  deadlineInput: bigint,
): Promise<ProReactiveParticipantPreparedConsent> {
  assertProReactiveParticipantSource(source);
  const a = addr(firstToken, "first participant"),
    b = addr(secondToken, "second participant"),
    deadline = uint(deadlineInput, "consent deadline", 64);
  require_(
    !same(a, b) && deadline > 0n && deadline >= source.blockTimestamp,
    "consent tokens or deadline invalid",
  );
  const [sa, sb] = await Promise.all([
    readProReactiveParticipant(client, source, a),
    readProReactiveParticipant(client, source, b),
  ]);
  require_(
    sa.status === "pending" &&
      sb.status === "pending" &&
      sa.own.role !== sb.own.role,
    "consent requires complementary pending registrations",
  );
  const first = sa.own.role === 0 ? sa : sb,
    second = sa.own.role === 1 ? sa : sb;
  for (const key of [
    "participantId",
    "token",
    "curve",
    "policy",
    "module",
  ] as const)
    require_(
      !same(first.own[key], second.own[key]),
      "consent participant " + key + " aliases",
    );
  const message = consentMessage(source, first.own, second.own, deadline),
    typedData = encodeProReactiveConsentTypedData(source, message),
    digest = hashProReactiveConsent(source, message);
  equal(
    await read(client, source, source.registry, "consentDigest", [message]),
    digest,
    "onchain consent digest",
  );
  await canonical(client, source);
  const result = Object.freeze({
    source,
    first,
    second,
    message,
    typedData,
    digest,
  });
  preparedConsents.add(result);
  histories.set(result, [source]);
  return result;
}
/** Rechecks the same immutable message; a changed nonce or deadline never silently requests another signature. */
export async function refreshProReactiveParticipantConsent(
  client: PublicClient,
  original: ProReactiveParticipantPreparedConsent,
  freshSource: ProReactiveParticipantSource,
): Promise<ProReactiveParticipantPreparedConsent> {
  assertProReactiveParticipantPreparedConsent(original);
  assertProReactiveParticipantSource(freshSource);
  equal(
    freshSource.factory,
    original.source.factory,
    "consent refresh Factory",
  );
  equal(
    freshSource.registry,
    original.source.registry,
    "consent refresh Registry",
  );
  equal(freshSource.chainId, original.source.chainId, "consent refresh chain");
  require_(
    freshSource.blockNumber >= original.source.blockNumber,
    "consent refresh predates source",
  );
  for (const h of histories.get(original)!) await canonical(client, h);
  const result = await prepareProReactiveParticipantConsent(
    client,
    freshSource,
    original.message.token0,
    original.message.token1,
    original.message.deadline,
  );
  equal(result.digest, original.digest, "unchanged consent/nonces");
  histories.set(result, [...histories.get(original)!, freshSource]);
  return result;
}
export async function verifyProReactiveParticipantConsent(
  client: PublicClient,
  prepared: ProReactiveParticipantPreparedConsent,
  signature0Input: Hex,
  signature1Input: Hex,
): Promise<ProReactiveParticipantVerifiedConsent> {
  assertProReactiveParticipantPreparedConsent(prepared);
  const signature0 = bytes(signature0Input, "role 0 signature"),
    signature1 = bytes(signature1Input, "role 1 signature");
  require_(
    signature0 !== "0x" &&
      signature1 !== "0x" &&
      signature0.length <= 131074 &&
      signature1.length <= 131074,
    "consent signature is empty or oversized",
  );
  const checked = await refreshProReactiveParticipantConsent(
    client,
    prepared,
    prepared.source,
  );
  for (const [address, signature] of [
    [checked.message.creator0, signature0],
    [checked.message.creator1, signature1],
  ] as const) {
    if ((await code(client, checked.source, address)) === "0x") {
      // Match the reviewed OpenZeppelin ECDSA(bytes) path: 65 bytes, low s, v=27/28.
      require_(
        signature.length === 132,
        "EOA consent requires a 65-byte signature",
      );
      const s = BigInt("0x" + signature.slice(66, 130)),
        v = Number.parseInt(signature.slice(130, 132), 16);
      require_(
        s > 0n &&
          s <=
            0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n &&
          (v === 27 || v === 28),
        "EOA consent signature is noncanonical",
      );
      equal(
        await recoverTypedDataAddress({ ...checked.typedData, signature }),
        address,
        "creator consent signature",
      );
    } else {
      // SignatureChecker uses an already deployed creator's ERC-1271 at this exact source block.
      const data = encodeFunctionData({
        abi: proReactiveParticipantAbi,
        functionName: "isValidSignature",
        args: [checked.digest, signature],
      });
      const raw = bytes(
        await client.request({
          method: "eth_call",
          params: [
            { to: address, data },
            { blockHash: checked.source.blockHash, requireCanonical: true },
          ],
        } as never),
        "contract consent signature return",
      );
      require_(
        raw.length >= 66 && raw.slice(0, 66) === "0x1626ba7e" + "00".repeat(28),
        "contract creator consent signature invalid",
      );
    }
    await canonical(client, checked.source);
  }
  const result = Object.freeze({ prepared: checked, signature0, signature1 });
  verifiedConsents.add(result);
  return result;
}
export async function readProReactiveParticipantRevocationIntent(
  client: PublicClient,
  participant: ProReactiveParticipantSnapshot,
  raw: ProReactiveParticipantContext,
): Promise<ProReactiveParticipantActionIntent> {
  assertProReactiveParticipantSnapshot(participant);
  const wallet = context(participant.source, raw);
  equal(wallet.account, participant.own.creator, "revocation creator");
  require_(
    participant.status === "pending",
    "finalized participant cannot revoke",
  );
  const fresh = await readProReactiveParticipant(
    client,
    participant.source,
    participant.own.token,
  );
  equal(fresh.own.nonce, participant.own.nonce, "revocation captured nonce");
  require_(
    fresh.status === "pending",
    "revocation registration already finalized",
  );
  const r = request(participant.source, wallet, "revokeConsent", [
    participant.own.participantId,
  ]);
  const result: ProReactiveParticipantActionIntent = Object.freeze({
    kind: "revocation",
    source: participant.source,
    context: wallet,
    participant: fresh,
    request: r,
    data: encodeFunctionData(r as never),
  });
  actions.add(result);
  histories.set(result, [participant.source]);
  return result;
}
export async function prepareProReactiveParticipantFinalizationIntent(
  client: PublicClient,
  consent: ProReactiveParticipantVerifiedConsent,
  raw: ProReactiveParticipantContext,
): Promise<ProReactiveParticipantActionIntent> {
  assertProReactiveParticipantVerifiedConsent(consent);
  const wallet = context(consent.prepared.source, raw);
  const checked = await verifyProReactiveParticipantConsent(
    client,
    consent.prepared,
    consent.signature0,
    consent.signature1,
  );
  const r = request(checked.prepared.source, wallet, "finalizeConsent", [
    checked.prepared.message,
    checked.signature0,
    checked.signature1,
  ]);
  const result: ProReactiveParticipantActionIntent = Object.freeze({
    kind: "finalization",
    source: checked.prepared.source,
    context: wallet,
    participant: checked.prepared.first,
    consent: checked,
    request: r,
    data: encodeFunctionData(r as never),
  });
  actions.add(result);
  histories.set(result, [...histories.get(consent.prepared)!]);
  return result;
}
export async function refreshProReactiveParticipantActionIntent(
  client: PublicClient,
  original: ProReactiveParticipantActionIntent,
  freshSource: ProReactiveParticipantSource,
  raw: ProReactiveParticipantContext,
): Promise<ProReactiveParticipantActionIntent> {
  assertProReactiveParticipantActionIntent(original);
  assertProReactiveParticipantSource(freshSource);
  const wallet = context(freshSource, raw);
  equal(wallet.account, original.context.account, "action refresh wallet");
  equal(freshSource.factory, original.source.factory, "action refresh Factory");
  equal(
    freshSource.registry,
    original.source.registry,
    "action refresh Registry",
  );
  equal(freshSource.chainId, original.source.chainId, "action refresh chain");
  require_(
    freshSource.blockNumber >= original.source.blockNumber,
    "action refresh predates source",
  );
  for (const h of histories.get(original)!) await canonical(client, h);
  let result: ProReactiveParticipantActionIntent;
  if (original.kind === "revocation") {
    const participant = await readProReactiveParticipant(
      client,
      freshSource,
      original.participant.own.token,
    );
    equal(
      participant.own.nonce,
      original.participant.own.nonce,
      "unchanged revocation nonce",
    );
    result = await readProReactiveParticipantRevocationIntent(
      client,
      participant,
      wallet,
    );
  } else {
    const prepared = await refreshProReactiveParticipantConsent(
        client,
        original.consent!.prepared,
        freshSource,
      ),
      verified = await verifyProReactiveParticipantConsent(
        client,
        prepared,
        original.consent!.signature0,
        original.consent!.signature1,
      );
    result = await prepareProReactiveParticipantFinalizationIntent(
      client,
      verified,
      wallet,
    );
  }
  equal(result.data, original.data, "unchanged action calldata");
  histories.set(result, [...histories.get(original)!, freshSource]);
  return result;
}
export function assertProReactiveParticipantActionRequest(
  raw: unknown,
  intent: ProReactiveParticipantActionIntent,
  account: Address = intent.context.account,
  chainId: bigint = intent.context.chainId,
): void {
  assertProReactiveParticipantActionIntent(intent);
  assertRequest(raw, intent.request, intent.data, account, chainId);
}
export function verifyProReactiveParticipantActionSimulation(
  intent: ProReactiveParticipantActionIntent,
  simulation: unknown,
  account: Address = intent.context.account,
  chainId: bigint = intent.context.chainId,
): ProReactiveParticipantActionSimulation {
  assertProReactiveParticipantActionIntent(intent);
  const s = obj(simulation, "action simulation");
  assertProReactiveParticipantActionRequest(
    s.request,
    intent,
    account,
    chainId,
  );
  require_(s.result === undefined, "void action returned unexpected data");
  const result = Object.freeze({ intent });
  actionSimulations.add(result);
  return result;
}
export async function simulateProReactiveParticipantAction(
  client: PublicClient,
  intent: ProReactiveParticipantActionIntent,
): Promise<ProReactiveParticipantActionSimulation> {
  assertProReactiveParticipantActionIntent(intent);
  const fresh = await refreshProReactiveParticipantActionIntent(
    client,
    intent,
    intent.source,
    intent.context,
  );
  const simulation = verifyProReactiveParticipantActionSimulation(fresh, {
    request: fresh.request,
    result: await callSimulation(
      client,
      fresh.source,
      fresh.request,
      fresh.data,
    ),
  });
  await canonical(client, intent.source);
  return simulation;
}
export async function completeProReactiveParticipantAction(
  client: PublicClient,
  simulation: ProReactiveParticipantActionSimulation,
  transactionHash: Hex,
): Promise<ProReactiveParticipantActionAcceptance> {
  assertProReactiveParticipantActionSimulation(simulation);
  const intent = simulation.intent,
    state = await mined(
      client,
      intent.source,
      intent.request,
      intent.data,
      transactionHash,
      histories.get(intent)!,
    );
  const participant = await readProReactiveParticipant(
    client,
    state.fresh,
    intent.participant.own.token,
  );
  if (intent.kind === "revocation") {
    const advanced = events(
      state.receipt,
      "ParticipantNonceAdvanced",
      intent.source.registry,
    );
    equal(advanced.length, 1, "revocation event count");
    for (const [key, value] of Object.entries({
      participantId: intent.participant.own.participantId,
      creator: intent.participant.own.creator,
      nonce: intent.participant.own.nonce + 1n,
    }))
      equal(advanced[0].args[key], value, "revoked " + key);
    require_(
      participant.own.nonce >= intent.participant.own.nonce + 1n,
      "accepted nonce has not advanced",
    );
  } else {
    const message = intent.consent!.prepared.message;
    require_(
      state.blockTimestamp <= message.deadline,
      "finalization mined after deadline",
    );
    const finalized = events(
      state.receipt,
      "ReactiveConsentFinalized",
      intent.source.registry,
    );
    equal(finalized.length, 1, "finalization event count");
    for (const [key, value] of Object.entries({
      finalPairId: message.finalPairId,
      participantId0: message.participantId0,
      participantId1: message.participantId1,
      token0: message.token0,
      token1: message.token1,
      creator0: message.creator0,
      creator1: message.creator1,
      nonce0: message.nonce0,
      nonce1: message.nonce1,
    }))
      equal(finalized[0].args[key], value, "finalized " + key);
    require_(
      participant.status === "finalized" && participant.partner !== undefined,
      "accepted relationship is not finalized",
    );
    equal(participant.finalPairId, message.finalPairId, "accepted final pair");
    for (const [leg, id, nonce] of [
      [participant.own, message.participantId0, message.nonce0],
      [participant.partner, message.participantId1, message.nonce1],
    ] as const) {
      equal(leg.participantId, id, "accepted participant ID");
      require_(leg.nonce >= nonce + 1n, "consumed consent nonce absent");
    }
  }
  for (const h of histories.get(intent)!) await canonical(client, h);
  await canonical(client, state.fresh);
  const result = Object.freeze({
    kind: intent.kind,
    transactionHash: state.hash,
    blockNumber: state.blockNumber,
    blockHash: state.blockHash,
    participant,
  });
  actionAcceptances.add(result);
  return result;
}
