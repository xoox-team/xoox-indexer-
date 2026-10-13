// Vendored from the XOOX SDK; only what the indexer uses.
import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  assertProFeeProgramHolderAssetPolicies,
  assertProFeeProgramMonadClaimPolicies,
  captureProFeeProgramClaimPolicies,
  type ProFeeProgramClaimPolicy,
} from "./pro-fee-program-claim-policy";
import { ProRule } from "./pro-token";

/** Revenue programs are an additive source family. Original R0–R22 policy IDs
 * and the retired programmable movement pack are separate namespaces. */
export const PRO_FEE_PROGRAM_SOURCE_VERSION = 4 as const;
export const PRO_FEE_PROGRAM_POLICY_VERSION = 1 as const;
export const PRO_FEE_PROGRAM_COUNT = 26;
export const PRO_FEE_PROGRAM_MONAD_COUNT = 22;
/** Stable IDs are reserved, never reassigned to substitute assets. */
export const PRO_FEE_PROGRAM_CANCELED_MONAD_MODULES = Object.freeze([
  3, 12, 13, 14,
] as const);
export const PRO_FEE_PROGRAM_CANCELED_MONAD_ASSETS = Object.freeze([
  "ZEC",
  "JUP",
  "BONK",
  "WIF",
] as const);
export const PRO_FEE_PROGRAM_MONAD_HOLDER_ASSETS = Object.freeze([
  "MON",
  "BTC",
  "ETH",
  "USDC",
] as const);
export const PRO_FEE_PROGRAM_MONAD_PURCHASE_ASSETS = Object.freeze([
  "BTC",
  "USDC",
  "ETH",
] as const);
const canceledMonadAssets = new Set<string>(
  PRO_FEE_PROGRAM_CANCELED_MONAD_ASSETS,
);
export function assertProFeeProgramMonadModule(moduleId: number): void {
  uint(moduleId, 1, PRO_FEE_PROGRAM_COUNT, "module ID");
  if (
    (PRO_FEE_PROGRAM_CANCELED_MONAD_MODULES as readonly number[]).includes(
      moduleId,
    )
  )
    fail(
      `M-${String(moduleId).padStart(2, "0")} is canceled for new Monad drafts and launches; no verified Monad pair is approved`,
    );
}
export function assertProFeeProgramMonadAsset(assetId: string): void {
  if (canceledMonadAssets.has(assetId.toUpperCase()))
    fail(
      `${assetId} is canceled for new Monad programs; no verified Monad pair is approved`,
    );
}
export const PRO_FEE_PROGRAM_BPS = 10_000;
export const PRO_FEE_PROGRAM_TOKEN_DECIMALS = 18;
export const PRO_FEE_PROGRAM_DRAFT_SCHEMA =
  "xoox.pro-token.fee-programs" as const;
export const PRO_FEE_PROGRAM_DRAFT_VERSION = 1 as const;
export const PRO_FEE_PROGRAM_DRAFT_MAX_BYTES = 262_144;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const TOKEN_UNIT = 10n ** 18n;
const MAX_HOLDING = 50_000_000n * TOKEN_UNIT;
const MAX_UINT256 = (1n << 256n) - 1n;

export enum ProFeeProgramModule {
  EarnMON = 1,
  EarnBTC,
  EarnZEC,
  EarnUSDC,
  BuyAndBurn,
  NFTSweep,
  DCA,
  HolderLottery,
  CreatorFeeSplit,
  TreasuryBuilder,
  EarnETH,
  EarnJUP,
  EarnBONK,
  EarnWIF,
  WhaleClub,
  MultiRaffle,
  FeeStream,
  BurnAndEarn,
  FlatDividend,
  ShrimpFund,
  BiggestBuyer,
  LastBuyerWins,
  BuybackVault,
  CrossBurn,
  IndexFund,
  CreatorSalary,
}

/** Stable Solidity wire IDs. HolderCarry is an appended M18 action. */
export enum ProFeeProgramActionKind {
  Keep = 0,
  Direct,
  HolderRoot,
  SwapAndSend,
  BuyAndBurn,
  BuyAndHold,
  NftPurchase,
  ContestPayout,
  HolderCarry,
}
export type ProFeeProgramAction = Readonly<{
  kind: ProFeeProgramActionKind;
  /** Maximum approved quote allocation; only actual input spent is debited. */
  amount: bigint;
  outputAsset: Address;
  minOut: bigint;
  root: Hex;
  beneficiaries: readonly Address[];
  nftId: bigint;
  data: Hex;
}>;
export type ProFeeProgramCycle = Readonly<{
  id: bigint;
  observedAt: bigint;
  deadline: bigint;
  evidence: Hex;
  actions: readonly ProFeeProgramAction[];
}>;
export const PRO_FEE_PROGRAM_CYCLE_ABI = parseAbiParameters(
  "(uint64 id,uint64 observedAt,uint64 deadline,bytes32 evidence,(uint8 kind,uint256 amount,address outputAsset,uint256 minOut,bytes32 root,address[] beneficiaries,uint256 nftId,bytes data)[] actions) cycle",
);

/** Wire validation only. The immutable module, authority, budgets and on-chain
 * timer determine whether an encoded cycle can execute. This is not service proof. */
export function validateProFeeProgramCycle(input: unknown): ProFeeProgramCycle {
  const raw = record(input, "cycle");
  keys(raw, ["id", "observedAt", "deadline", "evidence", "actions"], "cycle");
  if (
    !Array.isArray(raw.actions) ||
    raw.actions.length < 1 ||
    raw.actions.length > 8
  )
    fail("cycle must contain 1 through 8 actions");
  const actions = raw.actions.map((inputAction, index) => {
    const action = record(inputAction, `action ${index}`);
    keys(
      action,
      [
        "kind",
        "amount",
        "outputAsset",
        "minOut",
        "root",
        "beneficiaries",
        "nftId",
        "data",
      ],
      "action",
    );
    if (
      !Array.isArray(action.beneficiaries) ||
      action.beneficiaries.length > 10
    )
      fail("action beneficiaries must contain at most 10 addresses");
    if (
      typeof action.data !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(action.data) ||
      action.data.length > 131_074
    )
      fail("action data must be hex bytes of at most 65536 bytes");
    const result: ProFeeProgramAction = Object.freeze({
      kind: uint(action.kind, 0, 8, "action kind"),
      amount: biguint(action.amount, 0n, MAX_UINT256, "action amount"),
      outputAsset: address(action.outputAsset, "action output asset"),
      minOut: biguint(action.minOut, 0n, MAX_UINT256, "action minimum output"),
      root: hash(action.root, "action root"),
      beneficiaries: Object.freeze(
        action.beneficiaries.map((wallet) =>
          address(wallet, "beneficiary", true),
        ),
      ),
      nftId: biguint(action.nftId, 0n, MAX_UINT256, "NFT id"),
      data: action.data.toLowerCase() as Hex,
    });
    if (
      result.kind === ProFeeProgramActionKind.HolderCarry &&
      (result.minOut !== 0n ||
        result.root !== ZERO_HASH ||
        result.beneficiaries.length !== 0 ||
        result.nftId !== 0n ||
        result.data !== "0x")
    )
      fail(
        "holder carry requires empty minimum output, root, beneficiaries, NFT id and data",
      );
    return result;
  });
  return Object.freeze({
    id: biguint(raw.id, 1n, (1n << 64n) - 1n, "cycle id"),
    observedAt: biguint(
      raw.observedAt,
      0n,
      (1n << 64n) - 1n,
      "observed timestamp",
    ),
    deadline: biguint(raw.deadline, 0n, (1n << 64n) - 1n, "cycle deadline"),
    evidence: hash(raw.evidence, "cycle evidence"),
    actions: Object.freeze(actions),
  });
}
export function encodeProFeeProgramCycle(input: unknown): Hex {
  return encodeAbiParameters(PRO_FEE_PROGRAM_CYCLE_ABI, [
    validateProFeeProgramCycle(input),
  ]);
}
export function decodeProFeeProgramCycle(encoded: Hex): ProFeeProgramCycle {
  const result = validateProFeeProgramCycle(
    decodeAbiParameters(PRO_FEE_PROGRAM_CYCLE_ABI, encoded)[0],
  );
  if (!equal(encoded, encodeProFeeProgramCycle(result)))
    fail("cycle encoding must be canonical ABI");
  return result;
}
export type ProFeeProgramServiceKind =
  | "execution"
  | "holder-snapshot"
  | "randomness"
  | "canonical-trades"
  | "nft-marketplace";
export type ProFeeProgramDraftRecipient = Readonly<{
  wallet: string;
  weightBps: string;
}>;
export type ProFeeProgramDraftValue =
  | string
  | readonly string[]
  | readonly ProFeeProgramDraftRecipient[];
export type ProFeeProgramParameter = Readonly<{
  key: string;
  label: string;
  unit:
    | "basis-points"
    | "seconds"
    | "token-base-units"
    | "quote-base-units"
    | "count"
    | "address"
    | "asset-id"
    | "recipients";
  defaultValue: ProFeeProgramDraftValue;
  min?: string;
  max?: string;
  maxCharacters?: number;
  required?: boolean;
}>;
export type ProFeeProgramDefinition = Readonly<{
  id: ProFeeProgramModule;
  code: string;
  name: string;
  category: "Rewards" | "Games" | "Supply" | "Allocation" | "Hybrid";
  description: string;
  parameters: readonly ProFeeProgramParameter[];
  requiredServices: readonly ProFeeProgramServiceKind[];
  /** Symbol identity is a requirement, not a target-chain token approval. */
  fixedAsset?: string;
  notes: string;
}>;

const parameter = (
  key: string,
  label: string,
  unit: ProFeeProgramParameter["unit"],
  defaultValue: ProFeeProgramDraftValue,
  bounds: Partial<ProFeeProgramParameter> = {},
): ProFeeProgramParameter => ({ key, label, unit, defaultValue, ...bounds });
const minimum = (tokens = 100_000) =>
  parameter(
    "minHolding",
    "Minimum holding",
    "token-base-units",
    String(BigInt(tokens) * TOKEN_UNIT),
    { min: "0", max: String(MAX_HOLDING) },
  );
const interval = (seconds = 3600, min = 60, max = 604_800) =>
  parameter(
    "intervalSeconds",
    "Cycle or contest interval",
    "seconds",
    String(seconds),
    { min: String(min), max: String(max) },
  );
const destination = (required = false) =>
  parameter("recipient", "Destination", "address", "", { required });
const earn = (
  id: ProFeeProgramModule,
  asset: string,
): ProFeeProgramDefinition => ({
  id,
  name: `Earn ${asset}`,
  code: `M-${String(id).padStart(2, "0")}`,
  category: "Rewards",
  description: `Proportional ${asset} credits for eligible current holders.`,
  parameters: [minimum(), interval()],
  requiredServices: ["execution", "holder-snapshot"],
  fixedAsset: asset,
  notes:
    asset === "MON"
      ? "Unpaid native MON credits remain reserved."
      : "Requires an approved Monad representation and a usable route. Use the verified payout asset decimals.",
});
function definition(
  id: ProFeeProgramModule,
  name: string,
  category: ProFeeProgramDefinition["category"],
  description: string,
  parameters: readonly ProFeeProgramParameter[],
  services: readonly ProFeeProgramServiceKind[],
  notes = "",
): ProFeeProgramDefinition {
  return {
    id,
    name,
    category,
    description,
    parameters,
    requiredServices: ["execution", ...services],
    notes,
    code: `M-${String(id).padStart(2, "0")}`,
  };
}
const indexAssets = ["MON", "BTC", "ETH", "USDC"] as const;
const purchaseAssets = PRO_FEE_PROGRAM_MONAD_PURCHASE_ASSETS;
/** Actual representation symbols; this list never approves an address or pool. */
const representationSymbols: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    BTC: Object.freeze(["BTC", "WBTC", "cbBTC", "BTC.b"]),
    ETH: Object.freeze(["ETH", "WETH"]),
    USDC: Object.freeze(["USDC"]),
  });
const definitions: ProFeeProgramDefinition[] = [
  earn(1, "MON"),
  earn(2, "BTC"),
  earn(3, "ZEC"),
  earn(4, "USDC"),
  definition(
    5,
    "Buy & Burn",
    "Supply",
    "Buy the launch token and reduce its supply by the exact acquired amount.",
    [
      parameter("burnBps", "Buyback share", "basis-points", "10000", {
        min: "1000",
        max: "10000",
      }),
      interval(),
    ],
    [],
    "Remainder belongs to the creator. Dead-address transfers are not a supply burn.",
  ),
  definition(
    6,
    "NFT Sweep",
    "Supply",
    "Buy a validated listing from one immutable collection and retain custody.",
    [
      parameter("nftCollection", "Monad collection contract", "address", "", {
        required: true,
      }),
      interval(),
    ],
    ["nft-marketplace"],
    "Uses a fixed Monad collection contract and an approved OpenSea marketplace adapter.",
  ),
  definition(
    7,
    "DCA",
    "Allocation",
    "Buy a chosen approved asset each cycle and send it to the fixed destination.",
    [
      parameter("asset", "Purchase asset", "asset-id", "BTC"),
      destination(),
      interval(),
    ],
    [],
    "Native MON is excluded from this purchase selector; destination defaults to creator.",
  ),
  definition(
    8,
    "Holder Lottery",
    "Games",
    "Pay the pot to one balance-weighted eligible holder.",
    [minimum(), interval(86_400, 300, 604_800)],
    ["holder-snapshot", "randomness"],
    "The approved randomness service and participant snapshot must be disclosed.",
  ),
  definition(
    9,
    "Creator Fee Split",
    "Allocation",
    "Credit immutable recipients independently in the actual fee quote asset.",
    [
      parameter("recipients", "Fixed recipients and shares", "recipients", [], {
        required: true,
      }),
      interval(),
    ],
    [],
    "One to ten distinct nonzero wallets; positive shares sum to 10,000 bps.",
  ),
  definition(
    10,
    "Treasury Builder",
    "Allocation",
    "Allocate trading fees between approved USDC and native MON credits to one fixed treasury.",
    [
      destination(true),
      parameter("holderBps", "Fee budget for USDC", "basis-points", "5000", {
        min: "0",
        max: "10000",
      }),
      interval(),
    ],
    [],
    "The percentage divides the fee budget before conversion. USDC and native MON credits use up to two approved routes; an asset already matching the fee quote is credited directly. Unused fee budget stays reserved for a later cycle.",
  ),
  earn(11, "ETH"),
  earn(12, "JUP"),
  earn(13, "BONK"),
  earn(14, "WIF"),
  definition(
    15,
    "Whale Club",
    "Rewards",
    "Allocate native credits proportionally to the largest N eligible holders.",
    [
      parameter("count", "Top holders", "count", "50", {
        min: "3",
        max: "500",
      }),
      interval(),
    ],
    ["holder-snapshot"],
    "Snapshot ranking must define deterministic ties and custody exclusions.",
  ),
  definition(
    16,
    "Multi-Raffle",
    "Games",
    "Sample distinct eligible holders by balance and share the pot equally.",
    [
      minimum(),
      parameter("count", "Distinct winners", "count", "5", {
        min: "2",
        max: "10",
      }),
      interval(43_200, 300, 604_800),
    ],
    ["holder-snapshot", "randomness"],
    "Sampling is without replacement; insufficient entrants and remainder need a published service rule.",
  ),
  definition(
    17,
    "Fee Stream",
    "Allocation",
    "Send each cycle's fee revenue to a fixed destination in native MON.",
    [destination(true), interval()],
    [],
    "A non-native fee quote requires an approved conversion route to MON.",
  ),
  definition(
    18,
    "Burn + Earn",
    "Hybrid",
    "Split fees between exact self-token burn, native holder credits and creator remainder.",
    [
      parameter("burnBps", "Burn share", "basis-points", "5000", {
        min: "0",
        max: "10000",
      }),
      parameter("holderBps", "Holder share", "basis-points", "5000", {
        min: "0",
        max: "10000",
      }),
      minimum(),
      interval(),
    ],
    ["holder-snapshot"],
    "The positive inner sum must be at most 10,000 bps. Empty cohorts retain the assigned holder budget.",
  ),
  definition(
    19,
    "Flat Dividend",
    "Rewards",
    "Credit each qualifying wallet equally in native MON.",
    [minimum(50_000), interval()],
    ["holder-snapshot"],
    "A wallet rule does not identify unique people.",
  ),
  definition(
    20,
    "Shrimp Fund",
    "Rewards",
    "Credit eligible wallets equally within an immutable balance band.",
    [
      minimum(10_000),
      parameter(
        "maxHolding",
        "Maximum holding",
        "token-base-units",
        String(5_000_000n * TOKEN_UNIT),
        { min: String(100_000n * TOKEN_UNIT), max: String(MAX_HOLDING) },
      ),
      interval(),
    ],
    ["holder-snapshot"],
    "The upper bound must be strictly above the minimum.",
  ),
  definition(
    21,
    "Biggest Buyer",
    "Games",
    "Pay the pot to the largest canonical buyer over the complete window.",
    [interval(21_600, 300, 86_400)],
    ["canonical-trades"],
    "Needs exhaustive Curve and v4 trade accounting with deterministic ties.",
  ),
  definition(
    22,
    "Last Buyer Wins",
    "Games",
    "Pay the last canonical buyer after a quiet interval.",
    [interval(21_600, 300, 172_800)],
    ["canonical-trades"],
    "Each winning purchase may be used once.",
  ),
  definition(
    23,
    "Buyback Vault",
    "Supply",
    "Buy launch tokens and retain them permanently without a release path.",
    [interval()],
    [],
    "Acquired launch tokens remain in the vault permanently.",
  ),
  definition(
    24,
    "Cross Burn",
    "Supply",
    "Buy an approved burn-capable target token and reduce its actual supply.",
    [
      parameter("asset", "Verified burn target", "asset-id", "", {
        required: true,
      }),
      interval(),
    ],
    [],
    "Native currency and unverified ERC20 burn interfaces are refused.",
  ),
  definition(
    25,
    "Index Fund",
    "Allocation",
    "Send four equal MON/BTC/ETH/USDC purchase legs to one fixed destination.",
    [destination(), interval()],
    [],
    "All four Monad representations and routes are required; remainder is assigned to the last leg.",
  ),
  definition(
    26,
    "Creator Salary",
    "Allocation",
    "Pay a rolling 24-hour creator salary in fee quote units and burn excess revenue.",
    [
      parameter(
        "dailySalary",
        "Daily salary in fee quote base units",
        "quote-base-units",
        String(TOKEN_UNIT),
        { min: "100000000000000000", max: "50000000000000000000" },
      ),
      interval(3600, 3600),
    ],
    [],
    "Native default is 1 MON/day, range 0.1–50 MON. For an ERC20 quote use its verified decimals and explicit quote label.",
  ),
];
export const PRO_FEE_PROGRAMS: readonly ProFeeProgramDefinition[] =
  Object.freeze(
    definitions.map((entry) =>
      Object.freeze({
        ...entry,
        parameters: Object.freeze(
          entry.parameters.map((param) =>
            Object.freeze({
              ...param,
              defaultValue: Array.isArray(param.defaultValue)
                ? Object.freeze([...param.defaultValue])
                : param.defaultValue,
            }),
          ),
        ),
        requiredServices: Object.freeze([...entry.requiredServices]),
      }),
    ),
  );
/** Creator catalogue for the current Monad scope. The full catalogue preserves
 * stable IDs for authentic historical configurations. */
export const PRO_FEE_PROGRAM_MONAD_PROGRAMS: readonly ProFeeProgramDefinition[] =
  Object.freeze(
    PRO_FEE_PROGRAMS.filter(
      (entry) =>
        !(PRO_FEE_PROGRAM_CANCELED_MONAD_MODULES as readonly number[]).includes(
          entry.id,
        ),
    ),
  );

export type ProFeeProgramRecipient = Readonly<{
  wallet: Address;
  weightBps: number;
}>;
export type ProFeeProgram = Readonly<{
  moduleId: ProFeeProgramModule;
  weightBps: number;
  intervalSeconds: number;
  authority: Address;
  recipient: Address;
  /** Zero is native MON, never an alias for an ERC20 fee quote. */
  asset: Address;
  adapter: Address;
  adapterCodeHash: Hex;
  nftCollection: Address;
  minHolding: bigint;
  maxHolding: bigint;
  count: number;
  burnBps: number;
  holderBps: number;
  /** Reserved wire slots, zero for every supported module. */
  maxCreatorBps: number;
  maxWaitSeconds: number;
  dailySalary: bigint;
  rulesHash: Hex;
  allowedAssets: readonly Address[];
  recipients: readonly ProFeeProgramRecipient[];
}>;
export type ProFeeProgramConfig = Readonly<{
  poolFeeBps: number;
  snapshotMaxAge: number;
  programs: readonly ProFeeProgram[];
}>;
/** Exact ProFeeProgramTypes.Config tuple; the version is proved by the source
 * family, not inserted into abi.encode(config). */
export const PRO_FEE_PROGRAM_CONFIG_ABI = parseAbiParameters(
  "(uint16 poolFeeBps,uint32 snapshotMaxAge,(uint8 moduleId,uint16 weightBps,uint32 intervalSeconds,address authority,address recipient,address asset,address adapter,bytes32 adapterCodeHash,address nftCollection,uint256 minHolding,uint256 maxHolding,uint16 count,uint16 burnBps,uint16 holderBps,uint16 maxCreatorBps,uint32 maxWaitSeconds,uint256 dailySalary,bytes32 rulesHash,address[] allowedAssets,(address wallet,uint16 weightBps)[] recipients)[] programs) config",
);
export type ProFeeProgramSelectionDraft = Readonly<{
  moduleId: ProFeeProgramModule;
  weightBps: string;
  values: Readonly<Record<string, ProFeeProgramDraftValue>>;
}>;
export type ProFeeProgramDraft = Readonly<{
  schema: typeof PRO_FEE_PROGRAM_DRAFT_SCHEMA;
  version: typeof PRO_FEE_PROGRAM_DRAFT_VERSION;
  programSource: typeof PRO_FEE_PROGRAM_SOURCE_VERSION;
  poolFeeBps: string;
  snapshotMaxAge: string;
  programs: readonly ProFeeProgramSelectionDraft[];
}>;
/** This is an explicitly supplied, trusted deployment/service manifest, not a
 * source proof. Network readers must verify it against accepted profile 4 before
 * offering a launch. No approved Monad assets or services are built in. */
export type ProFeeProgramAvailabilityContext = Readonly<{
  chainId: number;
  /** Local rehearsals retain their real chain ID and require an explicit declaration. */
  environment?: "local" | "testnet" | "mainnet";
  programSourceVersion: number;
  enabledModules: readonly ProFeeProgramModule[];
  creator: Address;
  quoteAsset: Address;
  quoteDecimals: number;
  /** Exact constructor review, supplied by authenticated source4 deployment UI. */
  claimPolicies?: readonly ProFeeProgramClaimPolicy[];
  /** Rules of the launch these programs belong to. A Release Schedule launch admits a purchase of its token only when
   * the program's own adapter delivers it straight to the fee vault, so a program that buys this token there needs a
   * direct Curve route and cannot use a combined route that also converts the fee asset (a Composite adapter). */
  launchRules?: readonly ProRule[];
  assets: readonly Readonly<{
    id: string;
    symbol: string;
    chainId: number;
    address: Address;
    decimals: number;
    approved: boolean;
    /** Proven burn(uint256) that reduces totalSupply by the acquired amount. */
    burnVerified?: boolean;
  }>[];
  adapters: readonly Readonly<{
    address: Address;
    chainId: number;
    codeHash: Hex;
    kind: "swap" | "nft";
    approved: boolean;
    inputAssets: readonly Address[];
    outputAssets?: readonly Address[];
    supportsLaunchToken?: boolean;
    collections?: readonly Address[];
  }>[];
  services: readonly Readonly<{
    kind: ProFeeProgramServiceKind;
    chainId: number;
    authority: Address;
    approved: boolean;
    modules?: readonly ProFeeProgramModule[];
    /** Published snapshot/ranking/contest policy commitment, not a credential. */
    rulesHash?: Hex;
  }>[];
}>;
export type ProFeeProgramAvailability = Readonly<{
  available: boolean;
  reasons: readonly string[];
}>;

function fail(message: string): never {
  throw new Error(`Pro fee programs: ${message}`);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${label} has unknown setting ${key}`);
}
function uint(value: unknown, min: number, max: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(`${label} must be a whole number from ${min} through ${max}`);
  return value;
}
function biguint(
  value: unknown,
  min: bigint,
  max: bigint,
  label: string,
): bigint {
  if (typeof value !== "bigint" || value < min || value > max)
    fail(`${label} is out of range`);
  return value;
}
function integer(
  value: unknown,
  min: bigint,
  max: bigint,
  label: string,
): bigint {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    value.length > 78
  )
    fail(`${label} must use whole, unsigned base units`);
  return biguint(BigInt(value), min, max, label);
}
function address(value: unknown, label: string, nonzero = false): Address {
  if (typeof value !== "string" || !isAddress(value))
    fail(`${label} must be an EVM address`);
  const normalized = getAddress(value);
  if (nonzero && normalized === zeroAddress) fail(`${label} cannot be zero`);
  return normalized;
}
function hash(value: unknown, label: string, nonzero = false): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))
    fail(`${label} must be bytes32`);
  const normalized = value.toLowerCase() as Hex;
  if (nonzero && normalized === ZERO_HASH) fail(`${label} cannot be zero`);
  return normalized;
}
function equal(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
function moduleDefinition(value: unknown): ProFeeProgramDefinition {
  const id = uint(value, 1, PRO_FEE_PROGRAM_COUNT, "module ID");
  return PRO_FEE_PROGRAMS[id - 1];
}
/** Input is a percent string; output always uses actual basis points. */
export function parseProFeeProgramPercentToBps(value: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value) || value.length > 6)
    fail("percent must use at most two decimal places");
  const [whole, fraction = ""] = value.split(".");
  return uint(
    Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
    0,
    10_000,
    "percent in basis points",
  );
}

export function createProFeeProgramDraft(): ProFeeProgramDraft {
  return {
    schema: PRO_FEE_PROGRAM_DRAFT_SCHEMA,
    version: 1,
    programSource: 4,
    poolFeeBps: "50",
    snapshotMaxAge: "3600",
    programs: [],
  };
}
export function createProFeeProgramSelectionDraft(
  moduleId: ProFeeProgramModule,
  quoteDecimals = 18,
): ProFeeProgramSelectionDraft {
  const definition = moduleDefinition(moduleId);
  assertProFeeProgramMonadModule(definition.id);
  uint(quoteDecimals, 1, 36, "quote decimals");
  return {
    moduleId,
    weightBps: "10000",
    values: Object.fromEntries(
      definition.parameters.map((param) => [
        param.key,
        param.key === "dailySalary"
          ? String(10n ** BigInt(quoteDecimals))
          : Array.isArray(param.defaultValue)
            ? [...param.defaultValue]
            : param.defaultValue,
      ]),
    ),
  };
}

function selectionDraft(input: unknown): ProFeeProgramSelectionDraft {
  const raw = record(input, "program draft");
  keys(raw, ["moduleId", "weightBps", "values"], "program draft");
  const definition = moduleDefinition(raw.moduleId);
  assertProFeeProgramMonadModule(definition.id);
  integer(raw.weightBps, 1n, 10_000n, "program weightBps");
  const values = record(raw.values, "program values");
  keys(
    values,
    definition.parameters.map((param) => param.key),
    `${definition.code} values`,
  );
  for (const param of definition.parameters) {
    const value = values[param.key];
    if (value === undefined) fail(`${definition.code} missing ${param.key}`);
    if (
      ["seconds", "count", "basis-points", "token-base-units"].includes(
        param.unit,
      )
    )
      integer(
        value,
        BigInt(param.min ?? "0"),
        BigInt(param.max ?? String(MAX_UINT256)),
        param.key,
      );
    else if (param.unit === "quote-base-units")
      integer(value, 1n, MAX_UINT256, param.key);
    else if (param.unit === "address") {
      if (value !== "") address(value, param.key, true);
    } else if (param.unit === "asset-id") {
      if (
        value !== "" &&
        (typeof value !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value))
      )
        fail(`${param.key} must be an approved asset ID`);
      if (value !== "") assertProFeeProgramMonadAsset(value as string);
    } else if (param.unit === "recipients") {
      if (!Array.isArray(value) || value.length > 10)
        fail("recipients must contain at most ten wallets");
      for (const recipient of value) {
        const item = record(recipient, "recipient");
        keys(item, ["wallet", "weightBps"], "recipient");
        address(item.wallet, "recipient wallet", true);
        integer(item.weightBps, 1n, 10_000n, "recipient weightBps");
      }
    }
  }
  if (definition.id === 18) {
    const sum =
      BigInt(values.burnBps as string) + BigInt(values.holderBps as string);
    if (sum === 0n || sum > 10_000n)
      fail("burn/holder shares must have positive sum at most 10000 bps");
  }
  if (
    definition.id === 20 &&
    BigInt(values.maxHolding as string) <= BigInt(values.minHolding as string)
  )
    fail("balance-band maximum must exceed minimum");
  return {
    moduleId: definition.id,
    weightBps: raw.weightBps as string,
    values: values as Record<string, ProFeeProgramDraftValue>,
  };
}
function normalizeDraft(input: unknown): ProFeeProgramDraft {
  const raw = record(input, "draft");
  keys(
    raw,
    [
      "schema",
      "version",
      "programSource",
      "poolFeeBps",
      "snapshotMaxAge",
      "programs",
    ],
    "draft",
  );
  if (
    raw.schema !== PRO_FEE_PROGRAM_DRAFT_SCHEMA ||
    raw.version !== 1 ||
    raw.programSource !== 4
  )
    fail("unsupported draft schema/version/programSource");
  integer(raw.poolFeeBps, 0n, 1000n, "poolFeeBps");
  integer(raw.snapshotMaxAge, 1n, 86_400n, "snapshotMaxAge");
  if (
    !Array.isArray(raw.programs) ||
    raw.programs.length > PRO_FEE_PROGRAM_COUNT
  )
    fail("draft may contain at most twenty-six programs");
  const programs = raw.programs.map(selectionDraft);
  if (
    new Set(programs.map((program) => program.moduleId)).size !==
    programs.length
  )
    fail("duplicate program module");
  return {
    schema: PRO_FEE_PROGRAM_DRAFT_SCHEMA,
    version: 1,
    programSource: 4,
    poolFeeBps: raw.poolFeeBps as string,
    snapshotMaxAge: raw.snapshotMaxAge as string,
    programs,
  };
}
export function exportProFeeProgramDraft(draft: ProFeeProgramDraft): string {
  const result = JSON.stringify(normalizeDraft(draft));
  if (new TextEncoder().encode(result).length > PRO_FEE_PROGRAM_DRAFT_MAX_BYTES)
    fail("draft is too large");
  return result;
}
export function importProFeeProgramDraft(
  serialized: string,
): ProFeeProgramDraft {
  if (
    typeof serialized !== "string" ||
    new TextEncoder().encode(serialized).length >
      PRO_FEE_PROGRAM_DRAFT_MAX_BYTES
  )
    fail("draft is too large");
  return normalizeDraft(JSON.parse(serialized));
}

const holderModules = new Set<number>([
  1, 2, 3, 4, 8, 11, 12, 13, 14, 15, 16, 18, 19, 20,
]);
const contestModules = new Set<number>([8, 16, 21, 22]);
const serviceCommitmentModules = new Set<number>([8, 15, 16, 19, 20, 21, 22]);
const selfBuyModules = new Set<number>([5, 18, 23, 26]);
const assetByModule: Readonly<Record<number, string>> = {
  1: "MON",
  2: "BTC",
  3: "ZEC",
  4: "USDC",
  10: "USDC",
  11: "ETH",
  12: "JUP",
  13: "BONK",
  14: "WIF",
};

/** ProRule ids (ProTypes.Rule) that the Vault's purchase can never satisfy: it cannot be pre-listed or hold a gate
 * token, is neither the required app nor route, and every buy pays the Tithe. The Router refuses the same set. */
const VAULT_UNSATISFIABLE_LAUNCH_RULES = new Map<number, string>([
  [0, "Allowlist"],
  [1, "Holder gate"],
  [14, "Fomo-only buys"],
  [15, "Pump app only"],
  [17, "Wallet Relay"],
  [19, "Tithe"],
]);
const VAULT_BUYING_PROGRAMS = new Set<number>([5, 18, 23, 26]);
function resolveSelection(
  input: ProFeeProgramSelectionDraft,
  context: ProFeeProgramAvailabilityContext,
  reasons: string[],
): ProFeeProgram {
  const draft = selectionDraft(input);
  const definition = moduleDefinition(draft.moduleId);
  const id = draft.moduleId;
  const values = draft.values;
  const number = (key: string) =>
    values[key] === undefined ? 0 : Number(values[key]);
  const amount = (key: string) =>
    values[key] === undefined ? 0n : BigInt(values[key] as string);
  const missing = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  uint(context.chainId, 1, Number.MAX_SAFE_INTEGER, "chain ID");
  const chainSupported =
    context.environment === "local"
      ? [31337, 1337].includes(context.chainId)
      : context.environment === "mainnet"
        ? context.chainId === 143
        : context.environment === "testnet"
          ? context.chainId === 10143
          : context.environment === undefined &&
            [143, 10143].includes(context.chainId);
  if (!chainSupported)
    missing("The catalogue requires an explicitly supported Monad chain.");
  if (context.programSourceVersion !== 4)
    missing("Accepted fee program source version 4 is required.");
  if (!context.enabledModules.includes(id))
    missing(
      `${definition.code} is not enabled in the accepted deployment profile.`,
    );
  if (VAULT_BUYING_PROGRAMS.has(id)) {
    const blocking = [
      ...new Set(
        (context.launchRules ?? []).filter((rule) =>
          VAULT_UNSATISFIABLE_LAUNCH_RULES.has(rule),
        ),
      ),
    ].map((rule) => VAULT_UNSATISFIABLE_LAUNCH_RULES.get(rule)!);
    if (blocking.length)
      missing(
        `${definition.code} buys the launch token with its Vault, which the ${blocking.join(", ")} launch rule would refuse; remove the rule or the program.`,
      );
  }
  const creator = address(context.creator, "creator", true);
  const quote = address(context.quoteAsset, "quote asset");
  uint(context.quoteDecimals, 0, 36, "quote decimals");
  if (quote === zeroAddress && context.quoteDecimals !== 18)
    missing("Native MON has 18 decimals.");
  const activeAssets = context.assets.filter(
    (entry) => entry.chainId === context.chainId && entry.approved,
  );
  if (
    new Set(activeAssets.map((entry) => entry.id)).size !==
      activeAssets.length ||
    new Set(activeAssets.map((entry) => entry.address.toLowerCase())).size !==
      activeAssets.length
  )
    missing(
      "The approved asset manifest has duplicate identities or representations.",
    );
  function assetFor(assetId: string): Address {
    if (assetId === "MON") return zeroAddress;
    if (canceledMonadAssets.has(assetId.toUpperCase())) {
      missing(
        `${assetId} is canceled for new Monad programs; no verified Monad pair is approved.`,
      );
      return zeroAddress;
    }
    const entry = activeAssets.find((asset) => asset.id === assetId);
    if (!entry) {
      missing(
        `${assetId || "Target asset"} requires an approved representation on this Monad chain.`,
      );
      return zeroAddress;
    }
    const asset = address(entry.address, `${assetId} representation`, true);
    uint(entry.decimals, 0, 36, `${assetId} decimals`);
    if (
      (purchaseAssets as readonly string[]).includes(assetId) &&
      !representationSymbols[assetId]!.includes(entry.symbol)
    )
      missing(
        `${assetId} cannot be represented by an asset with a different approved identity.`,
      );
    return asset;
  }
  if (quote !== zeroAddress) {
    const approvedQuote = activeAssets.find((entry) =>
      equal(entry.address, quote),
    );
    if (!approvedQuote || approvedQuote.decimals !== context.quoteDecimals)
      missing(
        "The fee quote representation and its actual decimals require approval.",
      );
  }

  let outputAsset = assetByModule[id]
    ? assetFor(assetByModule[id])
    : zeroAddress;
  if (id === 7 || id === 24) {
    const assetId = values.asset as string;
    outputAsset = assetFor(assetId);
    if (
      id === 7 &&
      (!(purchaseAssets as readonly string[]).includes(assetId) ||
        outputAsset === quote)
    )
      missing(
        "DCA requires a supported non-native purchase asset different from the fee quote.",
      );
    if (
      id === 24 &&
      (assetId === "MON" ||
        !activeAssets.find((entry) => entry.id === assetId)?.burnVerified)
    )
      missing(
        "Cross Burn requires an approved target with a verified supply-reducing burn interface.",
      );
  }
  if (id === 9 || id === 26) outputAsset = quote;
  if (id === 10) {
    if (outputAsset === zeroAddress)
      missing(
        "Treasury Builder requires a real approved non-native USDC asset.",
      );
  }
  const allowedAssets = (id === 25 ? indexAssets : []).map(assetFor);
  if (
    new Set(allowedAssets.map((asset) => asset.toLowerCase())).size !==
    allowedAssets.length
  )
    missing(
      "Every configured payout/index asset needs a distinct approved chain representation.",
    );

  const services = new Map<
    ProFeeProgramServiceKind,
    ProFeeProgramAvailabilityContext["services"][number]
  >();
  for (const kind of definition.requiredServices) {
    const service = context.services.find(
      (entry) =>
        entry.kind === kind &&
        entry.chainId === context.chainId &&
        entry.approved &&
        (!entry.modules || entry.modules.includes(id)),
    );
    if (!service) {
      missing(`${kind} service requires approval on this chain.`);
    } else {
      address(service.authority, `${kind} authority`, true);
      services.set(kind, service);
    }
  }
  const primaryKind: ProFeeProgramServiceKind | undefined =
    id === 8 || id === 16
      ? "randomness"
      : id === 21 || id === 22
        ? "canonical-trades"
        : holderModules.has(id)
          ? "holder-snapshot"
          : id === 6
            ? "nft-marketplace"
            : undefined;
  const primary = primaryKind ? services.get(primaryKind) : undefined;
  let programAuthority = primary
    ? address(primary.authority, "program authority", true)
    : zeroAddress;
  let rulesHash = ZERO_HASH;
  if (serviceCommitmentModules.has(id)) {
    if (!primary?.rulesHash)
      missing(
        `${primaryKind} requires a published immutable snapshot/contest rules hash.`,
      );
    else rulesHash = hash(primary.rulesHash, "service rules hash", true);
  }

  const nftCollection =
    id === 6 && values.nftCollection
      ? address(values.nftCollection, "NFT collection", true)
      : zeroAddress;
  if (id === 6 && nftCollection === zeroAddress)
    missing("NFT Sweep requires a real collection contract on this chain.");
  let recipient = [5, 18, 26].includes(id) ? creator : zeroAddress;
  if ([7, 10, 17, 25].includes(id)) {
    if (values.recipient)
      recipient = address(values.recipient, "destination", true);
    else if (id === 7 || id === 25) recipient = creator;
    else missing("A fixed nonzero destination is required.");
  }
  let recipients: ProFeeProgramRecipient[] = [];
  if (id === 9) {
    recipients = (
      values.recipients as readonly ProFeeProgramDraftRecipient[]
    ).map((item) => ({
      wallet: address(item.wallet, "recipient wallet", true),
      weightBps: Number(item.weightBps),
    }));
    validateRecipients(recipients);
  }
  const selfBuy = selfBuyModules.has(id);
  const outputs =
    id === 10
      ? [
          ...(number("holderBps") > 0 ? [outputAsset] : []),
          ...(number("holderBps") < 10000 ? [zeroAddress] : []),
        ]
      : id === 25
        ? allowedAssets
        : id === 6
          ? []
          : [
                1, 2, 3, 4, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
                21, 22, 24,
              ].includes(id)
            ? [outputAsset]
            : [];
  const exchangeOutputs = outputs.filter((asset) => !equal(asset, quote));
  const requiresAdapter =
    id === 6 || selfBuy || id === 24 || id === 25 || exchangeOutputs.length > 0;
  let selectedAdapter:
    | ProFeeProgramAvailabilityContext["adapters"][number]
    | undefined;
  if (requiresAdapter) {
    const releaseSchedule =
      selfBuy && (context.launchRules ?? []).includes(ProRule.HolderVesting);
    const sorted = [...context.adapters].sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    );
    const fits = (
      entry: ProFeeProgramAvailabilityContext["adapters"][number],
      allowCombined: boolean,
    ) => {
      if (
        !entry.approved ||
        entry.chainId !== context.chainId ||
        entry.kind !== (id === 6 ? "nft" : "swap") ||
        !entry.inputAssets.some((asset) => equal(asset, quote))
      )
        return false;
      if (
        !/^0x[0-9a-fA-F]{64}$/.test(entry.codeHash) ||
        equal(entry.codeHash, ZERO_HASH)
      )
        return false;
      if (id === 6)
        return entry.collections?.some((collection) =>
          equal(collection, nftCollection),
        );
      // A route that lists conversion outputs combines the Curve with asset conversion.
      if (!allowCombined && (entry.outputAssets?.length ?? 0) > 0) return false;
      return (
        (!selfBuy || entry.supportsLaunchToken === true) &&
        exchangeOutputs.every((output) =>
          entry.outputAssets?.some((asset) => equal(asset, output)),
        )
      );
    };
    selectedAdapter = sorted.find((entry) => fits(entry, !releaseSchedule));
    if (!selectedAdapter)
      missing(
        id === 6
          ? "NFT marketplace adapter, collection and payment route require approval."
          : releaseSchedule && sorted.some((entry) => fits(entry, true))
            ? "A Release Schedule launch only accepts this program's purchases through a direct Curve route, and the reviewed route also converts the fee asset. Remove Release Schedule, or choose a quote the direct route covers."
            : "An approved swap adapter with a pinned code hash and every required input/output route is missing.",
      );
  }
  if (selectedAdapter && programAuthority === zeroAddress) {
    const execution = services.get("execution");
    if (execution)
      programAuthority = address(
        execution.authority,
        "adapter execution authority",
        true,
      );
    else missing("Approved adapter execution authority is required.");
  }
  const salary = amount("dailySalary");
  if (id === 26) {
    if (context.quoteDecimals === 0)
      missing("Salary quote requires fractional units for its 0.1 minimum.");
    else
      biguint(
        salary,
        10n ** BigInt(context.quoteDecimals - 1),
        50n * 10n ** BigInt(context.quoteDecimals),
        "daily salary in quote base units",
      );
  }
  const program: ProFeeProgram = {
    moduleId: id,
    weightBps: Number(draft.weightBps),
    intervalSeconds: number("intervalSeconds"),
    authority: programAuthority,
    recipient,
    asset: outputAsset,
    adapter: selectedAdapter
      ? address(selectedAdapter.address, "adapter", true)
      : zeroAddress,
    adapterCodeHash: selectedAdapter
      ? hash(selectedAdapter.codeHash, "adapter code hash", true)
      : ZERO_HASH,
    nftCollection,
    minHolding: amount("minHolding"),
    maxHolding: amount("maxHolding"),
    count: id === 25 ? 4 : number("count"),
    burnBps: number("burnBps"),
    holderBps: number("holderBps"),
    maxCreatorBps: number("maxCreatorBps"),
    maxWaitSeconds: number("maxWaitSeconds"),
    dailySalary: salary,
    rulesHash,
    allowedAssets,
    recipients,
  };
  if (context.claimPolicies) {
    try {
      assertProFeeProgramHolderAssetPolicies(
        captureProFeeProgramClaimPolicies(context.claimPolicies),
        [program],
      );
      assertProFeeProgramMonadClaimPolicies(
        captureProFeeProgramClaimPolicies(context.claimPolicies),
      );
    } catch (error) {
      missing(
        error instanceof Error
          ? error.message
          : "Reviewed holder payout policy is unavailable.",
      );
    }
  }
  return program;
}

/** Availability is explicit and local to the supplied manifest. It is not proof
 * of live contract deployment, complete execution services, or successful launch. */
export function getProFeeProgramAvailability(
  selection: ProFeeProgramSelectionDraft,
  context: ProFeeProgramAvailabilityContext,
): ProFeeProgramAvailability {
  const reasons: string[] = [];
  try {
    const program = resolveSelection(selection, context, reasons);
    if (reasons.length === 0) {
      const config = validateProFeeProgramConfig(
        {
          poolFeeBps: 0,
          snapshotMaxAge: 3600,
          programs: [{ ...program, weightBps: 10_000 }],
        },
        context,
      );
      if (context.claimPolicies)
        assertProFeeProgramMonadConfiguration(config, context.claimPolicies);
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }
  return Object.freeze({
    available: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

export function proFeeProgramConfigFromDraft(
  input: ProFeeProgramDraft,
  context: ProFeeProgramAvailabilityContext,
): ProFeeProgramConfig {
  const draft = normalizeDraft(input);
  if (context.claimPolicies)
    assertProFeeProgramMonadClaimPolicies(
      captureProFeeProgramClaimPolicies(context.claimPolicies),
    );
  if (draft.programs.length === 0) fail("select at least one program");
  const reasons: string[] = [];
  const programs = [...draft.programs]
    .sort((a, b) => a.moduleId - b.moduleId)
    .map((entry) => resolveSelection(entry, context, reasons));
  if (reasons.length) fail(reasons.join(" "));
  const config = validateProFeeProgramConfig(
    {
      poolFeeBps: Number(draft.poolFeeBps),
      snapshotMaxAge: Number(draft.snapshotMaxAge),
      programs,
    },
    context,
  );
  if (context.claimPolicies)
    assertProFeeProgramMonadConfiguration(config, context.claimPolicies);
  return config;
}

function validateRecipients(input: readonly ProFeeProgramRecipient[]) {
  if (input.length < 1 || input.length > 10)
    fail("one to ten split recipients are required");
  const seen = new Set<string>();
  let sum = 0;
  for (const item of input) {
    const wallet = address(item.wallet, "split recipient", true).toLowerCase();
    if (seen.has(wallet)) fail("duplicate split recipient");
    seen.add(wallet);
    sum += uint(item.weightBps, 1, 10_000, "split share");
  }
  if (sum !== 10_000) fail("split shares must sum to exactly 10000 bps");
}

const programKeys = [
  "moduleId",
  "weightBps",
  "intervalSeconds",
  "authority",
  "recipient",
  "asset",
  "adapter",
  "adapterCodeHash",
  "nftCollection",
  "minHolding",
  "maxHolding",
  "count",
  "burnBps",
  "holderBps",
  "maxCreatorBps",
  "maxWaitSeconds",
  "dailySalary",
  "rulesHash",
  "allowedAssets",
  "recipients",
] as const;
export type ProFeeProgramValidationContext = Readonly<{
  creator: Address;
  quoteAsset: Address;
  quoteDecimals: number;
  claimPolicies?: readonly ProFeeProgramClaimPolicy[];
}>;
/** Preparing a new launch is stricter than reading a funded historical tuple.
 * Named outputs are authenticated by the reviewed constructor policy table. */
export function assertProFeeProgramMonadConfiguration(
  input: ProFeeProgramConfig,
  inputPolicies: readonly ProFeeProgramClaimPolicy[],
): void {
  const configuration = validateProFeeProgramConfig(input);
  const policies = captureProFeeProgramClaimPolicies(inputPolicies);
  assertProFeeProgramMonadClaimPolicies(policies);
  for (const program of configuration.programs)
    assertProFeeProgramMonadModule(program.moduleId);
  assertProFeeProgramHolderAssetPolicies(policies, configuration.programs);
  const roleOf = (asset: Address) =>
    policies.find((policy) => equal(policy.asset, asset))?.assetRole;
  for (const program of configuration.programs) {
    if (
      program.moduleId === 7 &&
      ![2, 4, 5].includes(roleOf(program.asset) ?? 0)
    )
      fail("DCA requires an exact reviewed BTC, USDC or ETH asset role");
    if (program.moduleId === 10 && roleOf(program.asset) !== 4)
      fail("Treasury Builder requires the exact reviewed USDC asset role");
    if (program.moduleId === 25) {
      const roles = program.allowedAssets
        .map(roleOf)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      if (roles.join(",") !== "1,2,4,5")
        fail(
          "Index Fund requires exactly the reviewed MON, BTC, ETH and USDC asset roles",
        );
    }
  }
}
/** Structural/historical validation never grants network availability. Passing a
 * source-bound context also checks creator destinations and actual fee units. */
export function validateProFeeProgramConfig(
  input: unknown,
  context?: ProFeeProgramValidationContext,
): ProFeeProgramConfig {
  const raw = record(input, "configuration");
  keys(raw, ["poolFeeBps", "snapshotMaxAge", "programs"], "configuration");
  const poolFeeBps = uint(raw.poolFeeBps, 0, 1000, "poolFeeBps");
  const snapshotMaxAge = uint(raw.snapshotMaxAge, 1, 86_400, "snapshotMaxAge");
  if (
    !Array.isArray(raw.programs) ||
    raw.programs.length < 1 ||
    raw.programs.length > PRO_FEE_PROGRAM_COUNT
  )
    fail("configuration requires one to twenty-six programs");
  const creator = context
    ? address(context.creator, "creator", true)
    : undefined;
  const quote = context ? address(context.quoteAsset, "quote") : undefined;
  if (context) uint(context.quoteDecimals, 0, 36, "quote decimals");
  let previous = 0;
  let weights = 0;
  const programs = raw.programs.map((value) => {
    const item = record(value, "program");
    keys(item, programKeys, "program");
    const id = moduleDefinition(item.moduleId).id;
    if (id <= previous)
      fail("program IDs must be unique and in ascending order");
    previous = id;
    const program: ProFeeProgram = {
      moduleId: id,
      weightBps: uint(item.weightBps, 1, 10_000, "program weight"),
      intervalSeconds: uint(
        item.intervalSeconds,
        60,
        604_800,
        "intervalSeconds",
      ),
      authority: address(
        item.authority,
        "authority",
        holderModules.has(id) || contestModules.has(id),
      ),
      recipient: address(
        item.recipient,
        "recipient",
        [5, 7, 10, 17, 18, 25, 26].includes(id),
      ),
      asset: address(
        item.asset,
        "asset",
        [2, 3, 4, 7, 10, 11, 12, 13, 14, 24].includes(id),
      ),
      adapter: address(item.adapter, "adapter"),
      adapterCodeHash: hash(item.adapterCodeHash, "adapterCodeHash"),
      nftCollection: address(item.nftCollection, "nftCollection", id === 6),
      minHolding: biguint(item.minHolding, 0n, MAX_HOLDING, "minHolding"),
      maxHolding: biguint(item.maxHolding, 0n, MAX_HOLDING, "maxHolding"),
      count: uint(item.count, 0, 65535, "count"),
      burnBps: uint(item.burnBps, 0, 10_000, "burnBps"),
      holderBps: uint(item.holderBps, 0, 10_000, "holderBps"),
      maxCreatorBps: uint(item.maxCreatorBps, 0, 5000, "maxCreatorBps"),
      maxWaitSeconds: uint(item.maxWaitSeconds, 0, 604_800, "maxWaitSeconds"),
      dailySalary: biguint(item.dailySalary, 0n, MAX_UINT256, "dailySalary"),
      rulesHash: hash(
        item.rulesHash,
        "rulesHash",
        serviceCommitmentModules.has(id),
      ),
      allowedAssets: Object.freeze(
        Array.isArray(item.allowedAssets)
          ? item.allowedAssets.map((asset) => address(asset, "allowed asset"))
          : fail("allowedAssets must be an array"),
      ),
      recipients: Object.freeze(
        Array.isArray(item.recipients)
          ? item.recipients.map((recipient) => {
              const raw = record(recipient, "recipient");
              keys(raw, ["wallet", "weightBps"], "recipient");
              return Object.freeze({
                wallet: address(raw.wallet, "wallet", true),
                weightBps: uint(raw.weightBps, 1, 10_000, "recipient share"),
              });
            })
          : fail("recipients must be an array"),
      ),
    };
    weights += program.weightBps;
    if (
      (program.adapter === zeroAddress) !==
      (program.adapterCodeHash === ZERO_HASH)
    )
      fail("adapter and pinned code hash must be supplied together");
    if (program.adapter !== zeroAddress && program.authority === zeroAddress)
      fail("adapter execution requires an immutable authority");
    if (
      [5, 6, 18, 23, 24, 25, 26].includes(id) &&
      program.adapter === zeroAddress
    )
      fail("program requires an approved adapter");
    if (id === 1 && program.asset !== zeroAddress)
      fail("Earn MON requires the native asset");
    if (id === 5 && program.burnBps < 1000)
      fail("buyback share must be at least 1000 bps");
    if (id === 9) validateRecipients(program.recipients);
    else if (program.recipients.length !== 0)
      fail("only Fee Split has recipients");
    if (id === 15) uint(program.count, 3, 500, "top N");
    if (id === 16) uint(program.count, 2, 10, "distinct winners");
    if (
      id === 18 &&
      (program.burnBps + program.holderBps === 0 ||
        program.burnBps + program.holderBps > 10_000)
    )
      fail("burn/holder inner allocation is invalid");
    if (
      id === 20 &&
      (program.maxHolding < 100_000n * TOKEN_UNIT ||
        program.maxHolding <= program.minHolding)
    )
      fail(
        "balance-band maximum must exceed minimum and be at least 100000 tokens",
      );
    if (id === 8 || id === 16)
      uint(program.intervalSeconds, 300, 604_800, "draw interval");
    if (id === 21) uint(program.intervalSeconds, 300, 86_400, "buyer window");
    if (id === 22) uint(program.intervalSeconds, 300, 172_800, "quiet timer");
    if (
      id === 25 &&
      (program.count !== 4 || program.allowedAssets.length !== 4)
    )
      fail("Index Fund requires four equal asset legs");
    if (id === 26) {
      uint(program.intervalSeconds, 3600, 604_800, "salary interval");
      biguint(program.dailySalary, 1n, MAX_UINT256, "daily salary");
    }
    if (id !== 25 && program.allowedAssets.length !== 0)
      fail("only Index Fund has allowedAssets");
    if (
      new Set(program.allowedAssets.map((asset) => asset.toLowerCase()))
        .size !== program.allowedAssets.length
    )
      fail("duplicate allowed payout asset");
    // Reject dormant fields to keep the independently reviewed draft commitment unambiguous.
    for (const key of [
      "minHolding",
      "maxHolding",
      "count",
      "burnBps",
      "holderBps",
      "maxCreatorBps",
      "maxWaitSeconds",
      "dailySalary",
    ] as const) {
      const permitted =
        moduleDefinition(id).parameters.some((param) => param.key === key) ||
        (id === 25 && key === "count");
      if (!permitted && program[key] !== 0 && program[key] !== 0n)
        fail(`${key} is inactive for module ${id}`);
    }
    if (id !== 6 && program.nftCollection !== zeroAddress)
      fail("NFT collection is inactive for this module");
    if (context) {
      if ([5, 18, 26].includes(id) && !equal(program.recipient, creator!))
        fail("creator payout destination must be the actual creator");
      if ([9, 26].includes(id) && !equal(program.asset, quote!))
        fail("split/salary must use the actual fee quote");
      if (id === 7 && equal(program.asset, quote!))
        fail("purchase asset must differ from the quote");
      if (
        holderModules.has(id) ||
        contestModules.has(id) ||
        [7, 17].includes(id)
      ) {
        if (!equal(program.asset, quote!) && program.adapter === zeroAddress)
          fail("conversion from the fee quote requires an approved adapter");
      }
      if (
        id === 10 &&
        ((program.holderBps > 0 && !equal(program.asset, quote!)) ||
          (program.holderBps < 10000 && quote !== zeroAddress)) &&
        program.adapter === zeroAddress
      )
        fail(
          "Treasury conversion to USDC or native MON requires an approved adapter",
        );
      if (id === 26) {
        if (context.quoteDecimals < 1)
          fail("salary quote requires fractional units");
        biguint(
          program.dailySalary,
          10n ** BigInt(context.quoteDecimals - 1),
          50n * 10n ** BigInt(context.quoteDecimals),
          "daily salary in actual quote units",
        );
      }
    }
    return Object.freeze(program);
  });
  if (weights !== 10_000) fail("program weights must sum to exactly 10000 bps");
  if (context?.claimPolicies)
    assertProFeeProgramHolderAssetPolicies(
      captureProFeeProgramClaimPolicies(context.claimPolicies),
      programs,
    );
  return Object.freeze({
    poolFeeBps,
    snapshotMaxAge,
    programs: Object.freeze(programs),
  });
}

export function encodeProFeeProgramConfig(
  config: ProFeeProgramConfig,
  context?: ProFeeProgramValidationContext,
): Hex {
  return encodeAbiParameters(PRO_FEE_PROGRAM_CONFIG_ABI, [
    validateProFeeProgramConfig(config, context),
  ]);
}
export function decodeProFeeProgramConfig(
  encoded: Hex,
  context?: ProFeeProgramValidationContext,
): ProFeeProgramConfig {
  if (
    typeof encoded !== "string" ||
    !/^0x([0-9a-fA-F]{2})+$/.test(encoded) ||
    encoded.length > 524_288
  )
    fail("invalid or oversized encoded configuration");
  const [decoded] = decodeAbiParameters(PRO_FEE_PROGRAM_CONFIG_ABI, encoded);
  const config = validateProFeeProgramConfig(decoded, context);
  if (!equal(encodeProFeeProgramConfig(config, context), encoded))
    fail("encoded configuration is not canonical");
  return config;
}
export function proFeeProgramConfigHash(
  config: ProFeeProgramConfig,
  context?: ProFeeProgramValidationContext,
): Hex {
  return keccak256(encodeProFeeProgramConfig(config, context));
}
