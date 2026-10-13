// Vendored from the XOOX SDK; only what the indexer uses.
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  isAddress,
  parseAbi,
  zeroAddress,
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
} from "./pro-bootstrap";
import {
  assertProGraduationInfrastructureProof,
  proGraduationManifestFromProof,
  readProGraduationInfrastructure,
  type ProGraduationInfrastructureProof,
} from "./pro-graduation";

export const proOpeningBuyAbi = parseAbi([
  "struct Metadata { string name; string symbol; string description; string image; string website; string twitter; string telegram; }",
  "struct CurveConfig { address quoteAsset; uint256 phantomQuote; uint256 graduationThreshold; uint16 baseFeeBps; uint16 buyTaxBps; uint16 sellTaxBps; bool perpetual; address feeRecipient; }",
  "struct RuleConfig { uint8 rule; bytes data; }",
  "struct LaunchRequest { Metadata metadata; uint256 supply; CurveConfig curve; RuleConfig[] rules; address[] walletExemptions; bytes32 salt; uint64 deadline; }",
  "struct OpeningBuy { uint256 quoteIn; uint256 minTokensOut; uint64 deadline; bytes32[] proof; }",
  "function openingBuyVersion() view returns(uint256)",
  "function routerCreationVersion() view returns(uint256)",
  "function factory() view returns(address)",
  "function router() view returns(address)",
  "function createLaunchAndBuy(LaunchRequest launch,OpeningBuy opening) payable returns(address token,address curve,address policy)",
  "function createReactivePairAndBuy(LaunchRequest first,LaunchRequest second,bytes32 linkSalt,OpeningBuy[2] openings) payable returns(address token0,address token1)",
  "function createPeakPairAndBuy(LaunchRequest signal,LaunchRequest target,bytes32 linkSalt,OpeningBuy[2] openings) payable returns(address signalToken,address targetToken)",
  "function createTargetReferenceAndBuy(LaunchRequest target,address beacon,bytes32 linkSalt,OpeningBuy opening) payable returns(address targetToken)",
  "function allowance(address owner,address spender) view returns(uint256)",
  "function balanceOf(address owner) view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function approve(address spender,uint256 amount) returns(bool)",
  "function hasObservation(address token) view returns(bool)",
  "function readPeak(address token) view returns(uint256 marketCapUsd18,uint64 observedAt)",
  "event OpeningBuyExecuted(address indexed creator,address indexed token,uint8 indexed legIndex,uint256 quoteIn,uint256 minTokensOut,uint256 tokensOut,uint256 spent,uint256 refund)",
  "event RoutedBuy(address indexed buyer,address indexed curve,address indexed recipient,bytes32 routeId,uint256 tokensOut,uint256 spent,uint256 refund)",
  "event ProBuy(address indexed buyer,address indexed recipient,uint256 tokensOut,uint256 spent,uint256 refund,uint256 fees)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event FirstPurchaseRecorded(address indexed buyer,uint256 timestamp)",
  "event PurchaseVested(address indexed buyer,uint256 amount,uint256 boughtAt,bool merged)",
  "event ContributionAccrued(address indexed payer,uint256 amount)",
  "event LaunchCreated(address indexed creator,address indexed token,address indexed curveAddress,address policy,uint256 supply,bytes32 configurationHash,bytes32 launchSalt,Metadata metadata,CurveConfig curveConfig,RuleConfig[] rules,address[] walletExemptions,bytes32 requestedSalt,uint64 deadline)",
  "event ReactivePairCreated(address indexed creator,bytes32 indexed linkId,address indexed token0,address token1)",
  "event PeakPairCreated(address indexed creator,bytes32 indexed linkId,address indexed beaconToken,address targetToken)",
  "event TargetReferenceCreated(address indexed creator,bytes32 indexed linkId,address indexed beaconToken,address targetToken)",
]);
export type ProOpeningBuy = Readonly<{
  quoteIn: bigint;
  minTokensOut: bigint;
  deadline: bigint;
  proof: readonly Hex[];
}>;
export type ProOpeningBuyCreationRequest = Readonly<{
  address: Address;
  account: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}>;
export type ProOpeningBuySource = Readonly<{
  bootstrapInfrastructure: ProBootstrapProof;
  graduationInfrastructure?: ProGraduationInfrastructureProof;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  factory: Address;
  router: Address;
  openingBuyVersion: 1;
  routerCreationVersion: 1;
}>;
export type ProOpeningBuyRequest = Readonly<{
  chainId: bigint;
  address: Address;
  account: Address;
  abi: typeof proOpeningBuyAbi;
  functionName:
    | "createLaunchAndBuy"
    | "createReactivePairAndBuy"
    | "createPeakPairAndBuy"
    | "createTargetReferenceAndBuy";
  args: readonly unknown[];
  value: bigint;
}>;
export type ProOpeningBuyApproval = Readonly<{
  asset: Address;
  spender: Address;
  amount: bigint;
  kind: "erc20";
  request: Readonly<{
    address: Address;
    abi: typeof proOpeningBuyAbi;
    functionName: "approve";
    args: readonly [Address, bigint];
    account: Address;
    value: 0n;
  }>;
}>;
export type ProOpeningBuySettled = Readonly<{
  legIndex: number;
  token: Address;
  curve: Address;
  quoteIn: bigint;
  minTokensOut: bigint;
  tokensOut: bigint;
  spent: bigint;
  refund: bigint;
  fees: bigint;
}>;
const sources = new WeakSet<object>(),
  intents = new WeakSet<object>(),
  simulations = new WeakSet<object>(),
  acceptances = new WeakSet<object>();
const histories = new WeakMap<object, readonly ProOpeningBuySource[]>();
export class ProOpeningBuyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProOpeningBuyError";
  }
}
function require_(value: unknown, message: string): asserts value {
  if (!value) throw new ProOpeningBuyError(message);
}
function equal(a: unknown, b: unknown, label: string) {
  require_(
    typeof a === "string" && typeof b === "string"
      ? a.toLowerCase() === b.toLowerCase()
      : a === b,
    label + " differs from the captured opening intent or reviewed source.",
  );
}
function uint(value: unknown, label: string, bits = 256): bigint {
  require_(
    typeof value === "bigint" && value >= 0n && value < 1n << BigInt(bits),
    label + " requires a bounded unsigned bigint.",
  );
  return value;
}
function addr(value: unknown, label: string, allowZero = false): Address {
  require_(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      (allowZero || value.toLowerCase() !== zeroAddress),
    label + " requires a valid address.",
  );
  return getAddress(value);
}
function hex(
  value: unknown,
  label: string,
  word = false,
  nonzero = false,
): Hex {
  require_(
    typeof value === "string" &&
      (word ? /^0x[\da-fA-F]{64}$/ : /^0x(?:[\da-fA-F]{2})*$/).test(value) &&
      (!nonzero || !/^0x0*$/.test(value)),
    label + " requires canonical hex bytes.",
  );
  return value.toLowerCase() as Hex;
}
function object(value: unknown, label: string): Record<string, unknown> {
  require_(
    !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    label + " requires a plain object.",
  );
  return value as Record<string, unknown>;
}
function exact(
  value: Record<string, unknown>,
  names: readonly string[],
  label: string,
) {
  require_(
    Reflect.ownKeys(value).length === names.length &&
      names.every((n) => Object.hasOwn(value, n)),
    label + " requires exact fields.",
  );
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function assertProOpeningBuySource(
  value: unknown,
): asserts value is ProOpeningBuySource {
  require_(
    !!value && typeof value === "object" && sources.has(value),
    "Opening source must come from the canonical reviewed reader.",
  );
}
type Snapshot = Pick<
  ProOpeningBuySource,
  "chainId" | "blockNumber" | "blockHash" | "blockTimestamp"
>;
async function canonical(client: PublicClient, source: Snapshot) {
  equal(BigInt(await client.getChainId()), source.chainId, "RPC chain");
  const block = await client.getBlock({ blockNumber: source.blockNumber });
  equal(block.number, source.blockNumber, "Canonical height");
  equal(block.hash, source.blockHash, "Canonical block");
  equal(block.timestamp, source.blockTimestamp, "Canonical time");
}
async function read(
  client: PublicClient,
  source: Snapshot,
  address: Address,
  name: string,
  args: readonly unknown[] = [],
  from?: Address,
) {
  const data = encodeFunctionData({
    abi: proOpeningBuyAbi,
    functionName: name,
    args,
  } as never);
  const raw = hex(
    await client.request({
      method: "eth_call",
      params: [
        { to: address, data, ...(from ? { from } : {}) },
        { blockHash: source.blockHash, requireCanonical: true },
      ],
    } as never),
    "Canonical call response",
  );
  const result = decodeFunctionResult({
    abi: proOpeningBuyAbi,
    functionName: name,
    data: raw,
  } as never);
  equal(
    raw,
    encodeFunctionResult({
      abi: proOpeningBuyAbi,
      functionName: name,
      result,
    } as never),
    "Canonical decoded response",
  );
  return result;
}
async function code(
  client: PublicClient,
  source: Snapshot,
  address: Address,
): Promise<Hex> {
  return hex(
    await client.request({
      method: "eth_getCode",
      params: [
        address,
        { blockHash: source.blockHash, requireCanonical: true },
      ],
    } as never),
    "Canonical code",
  );
}

/** Bootstrap source version is necessary but never sufficient: both reviewed source getters must prove opening support. */
export async function readProOpeningBuySource(
  client: PublicClient,
  bootstrap: ProBootstrapProof,
  graduation?: ProGraduationInfrastructureProof,
): Promise<ProOpeningBuySource> {
  assertProBootstrapProof(bootstrap);
  require_(
    bootstrap.sourceReview.version === 2 ||
      bootstrap.sourceReview.version === 3,
    "Opening buy requires the explicit reviewed source v2 or v3 profile.",
  );
  require_(
    bootstrap.chainId <= BigInt(Number.MAX_SAFE_INTEGER),
    "Opening chain exceeds exact viem chain representation.",
  );
  if (graduation) {
    assertProGraduationInfrastructureProof(graduation);
    for (const name of [
      "chainId",
      "blockNumber",
      "blockHash",
      "blockTimestamp",
    ] as const)
      equal(graduation[name], bootstrap[name], "Graduation " + name);
    equal(
      graduation.components.factory.address,
      bootstrap.factory,
      "Graduation Factory",
    );
    equal(
      graduation.components.factory.codeHash,
      bootstrap.components.factory.codeHash,
      "Graduation Factory code",
    );
  }
  const selected = {
    blockNumber: bootstrap.blockNumber,
    blockHash: bootstrap.blockHash,
  };
  const reissued = await readProBootstrapInfrastructure(
    client,
    bootstrap.factory,
    proBootstrapManifestFromProof(bootstrap),
    selected,
  );
  const infrastructure = graduation
    ? await readProGraduationInfrastructure(
        client,
        bootstrap.factory,
        proGraduationManifestFromProof(graduation),
        selected,
      )
    : undefined;
  const router = reissued.components.router.address;
  equal(
    await read(client, reissued, reissued.factory, "routerCreationVersion"),
    1n,
    "Factory opening callback version",
  );
  equal(
    await read(client, reissued, router, "openingBuyVersion"),
    1n,
    "Router opening version",
  );
  equal(
    await read(client, reissued, reissued.factory, "router"),
    router,
    "Installed Router",
  );
  equal(
    await read(client, reissued, router, "factory"),
    reissued.factory,
    "Router Factory",
  );
  await canonical(client, reissued);
  const result: ProOpeningBuySource = Object.freeze({
    bootstrapInfrastructure: reissued,
    ...(infrastructure ? { graduationInfrastructure: infrastructure } : {}),
    chainId: reissued.chainId,
    blockNumber: reissued.blockNumber,
    blockHash: reissued.blockHash,
    blockTimestamp: reissued.blockTimestamp,
    factory: reissued.factory,
    router,
    openingBuyVersion: 1,
    routerCreationVersion: 1,
  });
  sources.add(result);
  return result;
}

function captureOpenings(
  value: readonly ProOpeningBuy[],
  count: number,
): readonly ProOpeningBuy[] {
  require_(
    Array.isArray(value) && value.length === count,
    "Opening count must equal the canonical leg count.",
  );
  const result = value.map((raw, index) => {
    const o = object(raw, "Opening " + index);
    exact(
      o,
      ["quoteIn", "minTokensOut", "deadline", "proof"],
      "Opening " + index,
    );
    const quoteIn = uint(o.quoteIn, "Quote input"),
      minTokensOut = uint(o.minTokensOut, "Absolute output floor"),
      deadline = uint(o.deadline, "Opening deadline", 64);
    require_(
      Array.isArray(o.proof) && o.proof.length <= 64,
      "Receiver proof exceeds its bounded size.",
    );
    const proof = Object.freeze(
      o.proof.map((v) => hex(v, "Receiver proof", true)),
    );
    require_(
      quoteIn > 0n
        ? minTokensOut > 0n
        : minTokensOut === 0n && deadline === 0n && proof.length === 0,
      "Zero openings require zero floor/deadline and empty proof; positive openings require an absolute floor.",
    );
    return Object.freeze({ quoteIn, minTokensOut, deadline, proof });
  });
  require_(
    result.some((o) => o.quoteIn > 0n),
    "All-zero openings must use the existing creation entries.",
  );
  return Object.freeze(result);
}

type ReceiptLog = Awaited<
  ReturnType<PublicClient["getTransactionReceipt"]>
>["logs"][number];
type Receipt = Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>;
function receiptEvents(receipt: Receipt, name: string, emitter?: Address) {
  const abi = getAbiItem({ abi: proOpeningBuyAbi, name } as never) as AbiEvent;
  const topic = encodeEventTopics({ abi: [abi], eventName: name } as never)[0];
  return receipt.logs
    .filter(
      (log) =>
        log.topics[0]?.toLowerCase() === topic?.toLowerCase() &&
        (!emitter || log.address.toLowerCase() === emitter.toLowerCase()),
    )
    .map((log) => {
      equal(log.removed, false, "Event removal flag");
      equal(log.blockNumber, receipt.blockNumber, "Event height");
      equal(log.blockHash, receipt.blockHash, "Event block");
      equal(log.transactionHash, receipt.transactionHash, "Event transaction");
      equal(
        log.transactionIndex,
        receipt.transactionIndex,
        "Event transaction index",
      );
      require_(
        Number.isSafeInteger(log.logIndex) && log.logIndex! >= 0,
        "Event log index is invalid.",
      );
      const args = decodeEventLog({
        abi: [abi],
        eventName: name,
        topics: log.topics,
        data: log.data,
        strict: true,
      } as never).args as Record<string, unknown>;
      const indexed = Object.fromEntries(
        abi.inputs
          .filter((i) => i.indexed)
          .map((i) => [i.name!, args[i.name!]]),
      );
      const topics = encodeEventTopics({
        abi: [abi],
        eventName: name,
        args: indexed,
      } as never);
      equal(log.topics.length, topics.length, "Event topic count");
      log.topics.forEach((v, i) =>
        equal(v, topics[i], "Canonical event topic"),
      );
      const inputs = abi.inputs.filter((i) => !i.indexed);
      equal(
        log.data,
        encodeAbiParameters(inputs, inputs.map((i) => args[i.name!]) as never),
        "Canonical event data",
      );
      return { log, args };
    });
}

