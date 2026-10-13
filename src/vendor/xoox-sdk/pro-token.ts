// Vendored from the XOOX SDK; only what the indexer uses.
import {
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
  type MulticallReturnType,
  type PublicClient,
} from "viem";
import {
  assertProGraduationInfrastructureProof,
  readProGraduationInfrastructure,
  type ProGraduationInfrastructureProof,
  type ProGraduationSourceManifest,
} from "./pro-graduation";

import {
  canAggregateProCanonicalGetters,
  readProCanonicalGetterBatch,
  type ProBootstrapSnapshotSelector,
} from "./pro-bootstrap";

/** IDs and payloads are shared with ProTypes.sol. Percentages use parts per million of supply. */
export enum ProRule {
  Allowlist,
  HolderGated,
  HolderVesting,
  AntiDumpCaps,
  SlidingCaps,
  GraduatedSellCaps,
  MaxPerWallet,
  Chapters,
  RisingMaxPerWallet,
  SniperFeeCap,
  TradeGuard,
  AntiBundle,
  VenueLocked,
  DexOnly,
  FomoOnlyBuys,
  PumpAppOnly,
  MarketHours,
  P2POnly,
  BuyerRewards,
  Tithe,
  ReactivePair,
  Entangled,
  Beacon,
}
export const PRO_RULE_COUNT = 23;
export const PRO_TOKEN_SCHEMA = "xoox.pro-token.form" as const;
export const PRO_TOKEN_VERSION = 1 as const;
export const PRO_PPM_DENOMINATOR = 1_000_000;
export type ProSlidingTierDraft = Readonly<{
  marketCapUsd: string;
  buyPercent: string;
  sellPercent: string;
}>;
export type ProRuleValue =
  | string
  | boolean
  | readonly string[]
  | readonly ProSlidingTierDraft[];
export type ProRuleDraft = Readonly<{
  rule: number;
  values: Readonly<Record<string, ProRuleValue>>;
}>;
export type ProRuleConfig = Readonly<{ rule: ProRule; data: Hex }>;
export type ProRuleParam = Readonly<{
  key: string;
  label: string;
  type:
    | "percent"
    | "uint"
    | "address"
    | "bytes32"
    | "addresses"
    | "tiers"
    | "boolean"
    | "select";
  defaultValue: ProRuleValue;
  min?: string;
  /** Replaces the generic range message when a whole number is below `min`. */
  minError?: string;
  max?: string;
  help?: string;
  options?: readonly Readonly<{ value: string; label: string }>[];
}>;
export type ProRuleDefinition = Readonly<{
  id: ProRule;
  name: string;
  description: string;
  category:
    | "access"
    | "vesting"
    | "limits"
    | "routes"
    | "schedule"
    | "rewards"
    | "partners";
  status: "available" | "development";
  params: readonly ProRuleParam[];
}>;

/**
 * Heartbeat of the price publisher. scripts/pro/publish-prices.ts posts one signed
 * observation per pass of its --watch-seconds loop, and that interval cannot exceed
 * the reviewed maxSampleGapSeconds of the publisher configuration. The longest gap in
 * any reviewed configuration of this repository is 30 seconds (scripts/pro/price-config.test.ts,
 * scripts/pro/publish-prices.test.ts); the local rehearsals use 20 and the operator
 * guide example uses 5. The signed time is the measurement time, which also trails the
 * posting time, so the longest reviewed gap is the figure to plan around.
 */
export const PRO_PRICE_PUBLISHER_HEARTBEAT_SECONDS = 30;
/**
 * Value Ladder buys need a signed price younger than the rule's maximum age, so an age
 * of a few seconds pauses buys between any two healthy publications. Two heartbeats is the
 * shortest age that survives one late or missed publication without pausing buys. The
 * second Core generation enforces the same floor on chain (`ProTypes.MIN_SLIDING_MAX_AGE_SECONDS`,
 * checked by the rule validator and by the module constructor), so a direct contract caller
 * cannot create a token whose buys never work; the first generation accepts any age from
 * 1 second, which this guard keeps out of the create flow. Sells never need a fresh price,
 * and launches that already exist are not re-validated against it.
 */
export const PRO_SLIDING_MIN_MAX_AGE_SECONDS =
  2 * PRO_PRICE_PUBLISHER_HEARTBEAT_SECONDS;

const percent = (
  key: string,
  label: string,
  value: string,
  min = "0.0001",
): ProRuleParam => ({
  key,
  label,
  type: "percent",
  defaultValue: value,
  min,
  max: "100",
  help: "Percentage of total token supply. Precision: 0.0001%.",
});
const uint = (
  key: string,
  label: string,
  value: string,
  min = "1",
  max?: string,
): ProRuleParam => ({
  key,
  label,
  type: "uint",
  defaultValue: value,
  min,
  max,
});
const address = (key: string, label: string): ProRuleParam => ({
  key,
  label,
  type: "address",
  defaultValue: "",
});
const hash = (key: string, label: string): ProRuleParam => ({
  key,
  label,
  type: "bytes32",
  defaultValue: "",
});
const bool = (key: string, label: string, value = false): ProRuleParam => ({
  key,
  label,
  type: "boolean",
  defaultValue: value,
});
const definition = (
  id: ProRule,
  name: string,
  description: string,
  category: ProRuleDefinition["category"],
  params: readonly ProRuleParam[],
  status: ProRuleDefinition["status"] = "available",
): ProRuleDefinition => ({ id, name, description, category, status, params });
const catalog: ProRuleDefinition[] = [
  definition(
    ProRule.Allowlist,
    "Access Pass",
    "Let tokens reach only approved receiving wallets listed for this launch.",
    "access",
    [hash("root", "Access Pass Merkle root")],
  ),
  definition(
    ProRule.HolderGated,
    "Hold Pass",
    "Check that each receiving wallet holds the required ERC20, ERC721 or ERC1155 balance.",
    "access",
    [
      address("asset", "Gate asset"),
      {
        key: "kind",
        label: "Asset standard",
        type: "select",
        defaultValue: "0",
        options: [
          { value: "0", label: "ERC20" },
          { value: "1", label: "ERC721" },
          { value: "2", label: "ERC1155" },
        ],
      },
      uint("tokenId", "ERC1155 token ID", "0", "0"),
      uint("minBalance", "Minimum balance (asset base units)", "1"),
    ],
  ),
  definition(
    ProRule.HolderVesting,
    "Release Schedule",
    "Lock early purchases on separate cliff and release schedules while keeping earlier unlocked balances free, with up to 256 active schedules per wallet.",
    "vesting",
    [
      uint(
        "earlyWindowSeconds",
        "Early buyer window (seconds; 0 = all buyers)",
        "0",
        "0",
        "4294967295",
      ),
      uint("cliffSeconds", "Cliff (seconds)", "86400", "0", "4294967295"),
      uint(
        "periodSeconds",
        "Release period (seconds)",
        "86400",
        "1",
        "4294967295",
      ),
      percent("releasePPM", "Release per period (%)", "10"),
    ],
  ),
  definition(
    ProRule.AntiDumpCaps,
    "Trade Bounds",
    "Set separate buy and sell quantity limits as shares of the full token supply.",
    "limits",
    [
      percent("buyPPM", "Maximum buy (%)", "2", "0"),
      percent("sellPPM", "Maximum sell (%)", "0.25"),
    ],
  ),
  definition(
    ProRule.SlidingCaps,
    "Value Ladder",
    "Use fresh signed USD value thresholds to set buy and sell limits, with lower values restoring earlier tiers and stale prices stopping buys until a fresh price is accepted.",
    "limits",
    [
      {
        ...uint(
          "maxAgeSeconds",
          "Maximum price age (seconds)",
          "300",
          String(PRO_SLIDING_MIN_MAX_AGE_SECONDS),
          "4294967295",
        ),
        help: `At least ${PRO_SLIDING_MIN_MAX_AGE_SECONDS} seconds, twice the ${PRO_PRICE_PUBLISHER_HEARTBEAT_SECONDS} second price publisher heartbeat, so one late price cannot pause buys. The oracle’s own maximum age also applies.`,
        minError: `Maximum price age must be at least ${PRO_SLIDING_MIN_MAX_AGE_SECONDS} seconds, twice the ${PRO_PRICE_PUBLISHER_HEARTBEAT_SECONDS} second price publisher heartbeat, so one late price cannot pause buys.`,
      },
      percent("baseBuyPPM", "Initial maximum buy (%)", "2", "0"),
      percent("baseSellPPM", "Initial maximum sell (%)", "1"),
      {
        key: "tiers",
        label: "Market value thresholds",
        type: "tiers",
        defaultValue: [
          { marketCapUsd: "100000", buyPercent: "1", sellPercent: "0.5" },
          { marketCapUsd: "500000", buyPercent: "0.5", sellPercent: "0.25" },
          { marketCapUsd: "1000000", buyPercent: "0.25", sellPercent: "0.1" },
        ],
      },
    ],
  ),
  definition(
    ProRule.GraduatedSellCaps,
    "Balance Brake",
    "Reduce the sale quantity limit as the seller's starting balance grows, stopping at the chosen minimum.",
    "limits",
    [
      percent("smallSellPPM", "Small balance sell limit (%)", "1"),
      percent("minSellPPM", "Minimum sell limit (%)", "0.1"),
      percent("largeBagPPM", "Large balance threshold (%)", "3"),
    ],
  ),
  definition(
    ProRule.MaxPerWallet,
    "Wallet Ceiling",
    "Cap the balance a receiving wallet can hold, with fixed creator, system and declared wallet exemptions.",
    "limits",
    [percent("ppm", "Maximum wallet balance (%)", "1")],
  ),
  definition(
    ProRule.Chapters,
    "Volume Ladder",
    "Double the wallet balance limit as settled swap volume crosses each interval, excluding wallet transfers.",
    "limits",
    [
      percent("startPPM", "Initial wallet limit (%)", "1"),
      uint(
        "volumePerDouble",
        "Swap volume per doubling (token base units)",
        "10000000000000000000000000",
      ),
    ],
  ),
  definition(
    ProRule.RisingMaxPerWallet,
    "Wallet Growth",
    "Expand the wallet balance limit each period by a fixed step or doubling, stopping at the total supply.",
    "limits",
    [
      percent("startPPM", "Initial wallet limit (%)", "0.1"),
      percent("stepPPM", "Increase per period (%)", "0.1", "0"),
      uint("periodSeconds", "Period (seconds)", "300", "1", "4294967295"),
      bool("doubling", "Double every period"),
    ],
  ),
  definition(
    ProRule.SniperFeeCap,
    "Priority Brake",
    "Restrict non-creator buy priority fees for a chosen window while leaving sells open; validator side payments are outside its scope.",
    "limits",
    [
      uint(
        "windowSeconds",
        "Window (seconds; 0 = permanent)",
        "600",
        "0",
        "4294967295",
      ),
      uint(
        "maxPriorityFeePerGas",
        "Maximum priority fee per gas (wei)",
        "2000000000",
      ),
    ],
  ),
  definition(
    ProRule.TradeGuard,
    "Move Ceiling",
    "Limit each buy, sell and wallet transfer to a fixed share of the full token supply.",
    "limits",
    [percent("maxPPM", "Maximum movement (%)", "0.5")],
  ),
  definition(
    ProRule.AntiBundle,
    "Block Pace",
    "Set one shared swap count per block for this token, with wallet transfers outside the count.",
    "limits",
    [uint("maxSwapsPerBlock", "Maximum swaps per block", "3", "1", "65535")],
  ),
  definition(
    ProRule.VenueLocked,
    "Pool Anchor",
    "Keep transfers on the launch curve while its rules are active; verified graduation opens normal wallet transfers and pool trading.",
    "routes",
    [],
  ),
  definition(
    ProRule.DexOnly,
    "Swap Only",
    "Keep trading on the launch curve or approved router paths while blocking wallet-to-wallet transfers.",
    "routes",
    [
      {
        key: "routers",
        label: "Allowed routers",
        type: "addresses",
        defaultValue: [],
        help: "One nonzero router address per line; no duplicates.",
      },
    ],
  ),
  definition(
    ProRule.FomoOnlyBuys,
    "Verified Entry",
    "For public buys, bind the buyer and purchase path to an authority signature while the creator can buy directly.",
    "routes",
    [hash("routeId", "Authorized purchase route ID")],
  ),
  definition(
    ProRule.PumpAppOnly,
    "Partner Entry",
    "Route public buys through a separate authority-signed application path bound to the buying wallet, with direct creator buys allowed.",
    "routes",
    [hash("routeId", "Verified application route ID")],
  ),
  definition(
    ProRule.MarketHours,
    "Session Clock",
    "Run buys and sells on fixed New York sessions with an optional sell override; holiday coverage ends after 2028 and time coverage after 2100.",
    "schedule",
    [
      bool("allowSellsOutside", "Allow sales outside sessions"),
      bool("observeHolidays", "Observe market holidays"),
    ],
  ),
  definition(
    ProRule.P2POnly,
    "Wallet Relay",
    "Keep wallet transfers open on a graduating curve where only the creator may buy and all curve sells are blocked; verified graduation opens normal market trading.",
    "routes",
    [],
  ),
  definition(
    ProRule.BuyerRewards,
    "Buy Bonus",
    "Give the buying wallet prefunded tokens or NFTs for qualifying purchases, even with another recipient, without creating reward debt when the vault is empty.",
    "rewards",
    [
      address("rewardAsset", "Reward asset"),
      {
        key: "kind",
        label: "Reward asset standard",
        type: "select",
        defaultValue: "0",
        options: [
          { value: "0", label: "ERC20" },
          { value: "1", label: "ERC721" },
        ],
      },
      uint("rewardAmount", "Reward per qualifying purchase (base units)", "1"),
      percent("minBuyPPM", "Qualifying purchase (%)", "0.05"),
    ],
  ),
  definition(
    ProRule.Tithe,
    "Fixed Contribution",
    "Charge a fixed extra native contribution on buys, sells and positive wallet transfers while preserving the transferred token amount.",
    "rewards",
    [
      address("recipient", "Contribution beneficiary"),
      uint(
        "amount",
        "Native contribution per operation (wei)",
        "5000000000000000",
      ),
    ],
  ),
  definition(
    ProRule.ReactivePair,
    "Linked Pulse",
    "Planned: let verified trading activity in a registered linked token adjust this token's buy limit.",
    "partners",
    [
      address("partner", "Partner token"),
      percent("basePPM", "Base buy limit (%)", "1"),
      percent("sensitivityPPM", "Sensitivity (%)", "25"),
    ],
    "development",
  ),
  definition(
    ProRule.Entangled,
    "Target Unlock",
    "Planned: permanently unlock trading after a linked Peak Signal reaches a verified market value target.",
    "partners",
    [
      address("beacon", "Peak Signal token"),
      uint("targetValue", "Target market value (oracle units)", "20000"),
    ],
    "development",
  ),
  definition(
    ProRule.Beacon,
    "Peak Signal",
    "Planned: publish verified peak market values as a standalone signal or a trigger for linked token unlocks.",
    "partners",
    [
      address("partner", "Target Unlock partner"),
      address("oracle", "Market value adapter"),
    ],
    "development",
  ),
];
function freezeParam(param: ProRuleParam): ProRuleParam {
  return Object.freeze({
    ...param,
    defaultValue: Array.isArray(param.defaultValue)
      ? param.type === "tiers"
        ? copyProSlidingTiers(param.defaultValue)
        : Object.freeze([...param.defaultValue] as string[])
      : param.defaultValue,
    options:
      param.options &&
      Object.freeze(
        param.options.map((option) => Object.freeze({ ...option })),
      ),
  });
}
export const PRO_RULE_CATALOGUE: readonly ProRuleDefinition[] = Object.freeze(
  catalog.map((rule) =>
    Object.freeze({
      ...rule,
      params: Object.freeze(rule.params.map(freezeParam)),
    }),
  ),
);
export const PRO_TOKEN_RULES = PRO_RULE_CATALOGUE;
export const PRO_COMBINABLE_RULES: readonly ProRule[] = Object.freeze([
  ProRule.TradeGuard,
  ProRule.AntiDumpCaps,
  ProRule.GraduatedSellCaps,
  ProRule.MaxPerWallet,
  ProRule.Chapters,
  ProRule.AntiBundle,
  ProRule.DexOnly,
  ProRule.FomoOnlyBuys,
  ProRule.RisingMaxPerWallet,
  ProRule.SniperFeeCap,
]);
export const PRO_RULE_CONFLICTS: readonly (readonly [ProRule, ProRule])[] =
  Object.freeze(
    [
      [ProRule.TradeGuard, ProRule.AntiDumpCaps],
      [ProRule.AntiDumpCaps, ProRule.GraduatedSellCaps],
      [ProRule.MaxPerWallet, ProRule.Chapters],
      [ProRule.MaxPerWallet, ProRule.RisingMaxPerWallet],
      [ProRule.Chapters, ProRule.RisingMaxPerWallet],
    ].map((pair) => Object.freeze(pair as [ProRule, ProRule])),
  );
export const PRO_RULE_CONFLICT_DETAILS = Object.freeze(
  PRO_RULE_CONFLICTS.map((rules) =>
    Object.freeze({
      rules,
      reason: `${PRO_RULE_CATALOGUE[rules[0]].name} and ${PRO_RULE_CATALOGUE[rules[1]].name} cannot be combined.`,
    }),
  ),
);

function ruleId(value: number): ProRule {
  if (!Number.isInteger(value) || value < 0 || value >= PRO_RULE_COUNT)
    throw new Error("Unknown Pro Token rule.");
  return value;
}
export function proRulesBitmap(rules: readonly number[]): bigint {
  return rules.reduce(
    (bitmap, rule) => bitmap | (1n << BigInt(ruleId(rule))),
    0n,
  );
}
export const PRO_ALL_RULE_BITMAP = (1n << BigInt(PRO_RULE_COUNT)) - 1n;
/** Rules with a known ABI encoder. This is not a deployed factory capability declaration. */
export const PRO_ENCODABLE_RULE_BITMAP = proRulesBitmap(
  PRO_RULE_CATALOGUE.filter((rule) => rule.status === "available").map(
    (rule) => rule.id,
  ),
);
/** @deprecated Use PRO_ENCODABLE_RULE_BITMAP for local encoding and readProTokenCapabilities for deployment support. */
export const PRO_SUPPORTED_RULE_BITMAP = PRO_ENCODABLE_RULE_BITMAP;
export function hasProRuleCapability(bitmap: bigint, rule: number): boolean {
  if (bitmap < 0n || bitmap > PRO_ALL_RULE_BITMAP)
    throw new Error("Unsupported Pro Token capability bitmap.");
  return (bitmap & (1n << BigInt(ruleId(rule)))) !== 0n;
}
/** Parse decimal percent exactly. 1% = 10,000 PPM; 0.0001% = one PPM. No floats. */
export function parseProPercentPPM(value: string): number {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text))
    throw new Error("Enter a percentage with up to four decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  if (result > 1_000_000n)
    throw new Error("Percentage must be between 0% and 100%.");
  return Number(result);
}
export function formatProPercentPPM(ppm: number): string {
  if (!Number.isInteger(ppm) || ppm < 0 || ppm > PRO_PPM_DENOMINATOR)
    throw new Error("Invalid supply percentage PPM.");
  const whole = Math.floor(ppm / 10_000);
  const fraction = String(ppm % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Release Schedule still carries a fifth `minBuyPPM` payload field, and the
 * onchain validator and module still require it to be 1 to 1,000,000 ppm. The
 * second Core generation no longer reads it, because every early purchase is
 * locked. The first generation still treats it as a per-purchase floor, so the
 * encoder always writes the smallest accepted value, which locks everything but
 * a purchase of less than 0.0001% of the supply there, and the form has no field.
 */
const HOLDER_VESTING_MIN_BUY_PPM = 1;
const PAYLOADS: Partial<Record<ProRule, string>> = {
  [ProRule.Allowlist]: "bytes32 root",
  [ProRule.HolderGated]:
    "address asset,uint8 kind,uint256 tokenId,uint256 minBalance",
  [ProRule.HolderVesting]:
    "uint32 earlyWindowSeconds,uint32 cliffSeconds,uint32 periodSeconds,uint32 releasePPM,uint32 minBuyPPM",
  [ProRule.AntiDumpCaps]: "uint32 buyPPM,uint32 sellPPM",
  [ProRule.SlidingCaps]:
    "uint32 maxAgeSeconds,uint32 baseBuyPPM,uint32 baseSellPPM,(uint256 marketCapUsd18,uint32 buyPPM,uint32 sellPPM)[] tiers",
  [ProRule.GraduatedSellCaps]:
    "uint32 smallSellPPM,uint32 minSellPPM,uint32 largeBagPPM",
  [ProRule.MaxPerWallet]: "uint32 ppm",
  [ProRule.Chapters]: "uint32 startPPM,uint256 volumePerDouble",
  [ProRule.RisingMaxPerWallet]:
    "uint32 startPPM,uint32 stepPPM,uint32 periodSeconds,bool doubling",
  [ProRule.SniperFeeCap]: "uint32 windowSeconds,uint256 maxPriorityFeePerGas",
  [ProRule.TradeGuard]: "uint32 maxPPM",
  [ProRule.AntiBundle]: "uint16 maxSwapsPerBlock",
  [ProRule.DexOnly]: "address[] routers",
  [ProRule.FomoOnlyBuys]: "bytes32 routeId",
  [ProRule.PumpAppOnly]: "bytes32 routeId",
  [ProRule.MarketHours]: "bool allowSellsOutside,bool observeHolidays",
  [ProRule.BuyerRewards]:
    "address rewardAsset,uint8 kind,uint256 rewardAmount,uint32 minBuyPPM",
  [ProRule.Tithe]: "address recipient,uint256 amount",
};
function unsigned(
  text: ProRuleValue | undefined,
  label: string,
  bits = 256,
  minimum = 0n,
): bigint {
  if (typeof text !== "string" || !/^\d+$/.test(text.trim()))
    throw new Error(`${label} must be a whole nonnegative number.`);
  const result = BigInt(text.trim());
  if (result < minimum || result >= 1n << BigInt(bits))
    throw new Error(`${label} is outside its supported range.`);
  return result;
}
function wallet(value: ProRuleValue | undefined, label: string): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value.trim(), { strict: true }) ||
    value.trim().toLowerCase() === zeroAddress
  )
    throw new Error(`Enter a valid nonzero ${label} address.`);
  return getAddress(value.trim());
}
function bytes32(value: ProRuleValue | undefined, label: string): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value) ||
    /^0x0{64}$/.test(value)
  )
    throw new Error(`${label} must be a nonzero bytes32 value.`);
  return value.toLowerCase() as Hex;
}
/** Exact USD18 conversion; does not turn unavailable prices into zero or round excess precision. */
export function parseProUsd18(value: string): bigint {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(text))
    throw new Error("Enter a USD threshold with up to 18 decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  if (amount === 0n || amount >= 1n << 256n)
    throw new Error("USD threshold must be positive and fit uint256.");
  return amount;
}
function formatProUsd18(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const fraction = String(amount % 10n ** 18n)
    .padStart(18, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
function copyProSlidingTiers(raw: unknown): readonly ProSlidingTierDraft[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5)
    throw new Error("Value Ladder requires 1–5 market value thresholds.");
  return Object.freeze(
    raw.map((entry) => {
      const tier = plainObject(entry, "Value Ladder threshold", [
        "marketCapUsd",
        "buyPercent",
        "sellPercent",
      ]);
      if (Object.values(tier).some((value) => typeof value !== "string"))
        throw new Error(
          "Value Ladder threshold values must be decimal strings.",
        );
      return Object.freeze({ ...tier }) as ProSlidingTierDraft;
    }),
  );
}
export function normalizeProSlidingTiers(
  raw: unknown,
): readonly ProSlidingTierDraft[] {
  let previous = 0n;
  return Object.freeze(
    copyProSlidingTiers(raw).map((tier) => {
      const threshold = parseProUsd18(tier.marketCapUsd);
      if (threshold <= previous)
        throw new Error(
          "Value Ladder market value thresholds must increase strictly.",
        );
      previous = threshold;
      const buy = parseProPercentPPM(tier.buyPercent);
      const sell = parseProPercentPPM(tier.sellPercent);
      if (sell === 0)
        throw new Error("Value Ladder sell limits must be greater than zero.");
      return Object.freeze({
        marketCapUsd: formatProUsd18(threshold),
        buyPercent: formatProPercentPPM(buy),
        sellPercent: formatProPercentPPM(sell),
      });
    }),
  );
}
function paramValue(
  param: ProRuleParam,
  raw: ProRuleValue | undefined,
): ProRuleValue {
  if (raw === undefined) throw new Error(`${param.label} is required.`);
  switch (param.type) {
    case "tiers":
      return normalizeProSlidingTiers(raw);
    case "percent": {
      if (typeof raw !== "string")
        throw new Error(`${param.label} must be a decimal percentage.`);
      const ppm = parseProPercentPPM(raw);
      if (param.min && ppm < parseProPercentPPM(param.min))
        throw new Error(`${param.label} must be at least ${param.min}%.`);
      return formatProPercentPPM(ppm);
    }
    case "uint": {
      const value = unsigned(raw, param.label);
      if (param.min && value < BigInt(param.min) && param.minError)
        throw new Error(param.minError);
      if (
        (param.min && value < BigInt(param.min)) ||
        (param.max && value > BigInt(param.max))
      )
        throw new Error(`${param.label} is outside its supported range.`);
      return value.toString();
    }
    case "address":
      return wallet(raw, param.label);
    case "bytes32":
      return bytes32(raw, param.label);
    case "boolean":
      if (typeof raw !== "boolean")
        throw new Error(`${param.label} must be true or false.`);
      return raw;
    case "select":
      if (
        typeof raw !== "string" ||
        !param.options?.some((option) => option.value === raw)
      )
        throw new Error(`Choose a supported ${param.label.toLowerCase()}.`);
      return raw;
    case "addresses": {
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32)
        throw new Error(`${param.label} requires 1–32 addresses.`);
      const addresses = raw.map((value) => wallet(value, param.label));
      if (
        new Set(addresses.map((value) => value.toLowerCase())).size !==
        addresses.length
      )
        throw new Error(`${param.label} must contain different addresses.`);
      return Object.freeze(addresses);
    }
  }
}
function normalizeDraft(draft: ProRuleDraft): ProRuleDraft {
  const id = ruleId(draft.rule),
    definition = PRO_RULE_CATALOGUE[id];
  if (
    !draft.values ||
    typeof draft.values !== "object" ||
    Array.isArray(draft.values)
  )
    throw new Error(`${definition.name} settings must be an object.`);
  if (id === ProRule.VenueLocked && Object.hasOwn(draft.values, "poolId"))
    throw new Error(
      "This Pool Anchor draft uses an obsolete PoolId. Start a new parameter-free Pool Anchor draft.",
    );
  for (const key of Object.keys(draft.values))
    if (!definition.params.some((param) => param.key === key))
      throw new Error(`Unknown ${definition.name} setting: ${key}.`);
  const values = Object.fromEntries(
    definition.params.map((param) => [
      param.key,
      paramValue(param, draft.values[param.key]),
    ]),
  );
  if (
    id === ProRule.GraduatedSellCaps &&
    parseProPercentPPM(values.minSellPPM as string) >
      parseProPercentPPM(values.smallSellPPM as string)
  )
    throw new Error(
      "Minimum sell limit cannot exceed the small balance sell limit.",
    );
  if (
    id === ProRule.RisingMaxPerWallet &&
    values.doubling === false &&
    parseProPercentPPM(values.stepPPM as string) === 0
  )
    throw new Error(
      "Wallet limit increase must be greater than zero when doubling is off.",
    );
  if (
    id === ProRule.BuyerRewards &&
    values.kind === "1" &&
    values.rewardAmount !== "1"
  )
    throw new Error(
      "ERC721 rewards must allocate exactly one NFT per qualifying purchase.",
    );
  return Object.freeze({ rule: id, values: Object.freeze(values) });
}
export type ProRuleValidationOptions = Readonly<{
  supportedBitmap?: bigint;
  allowDevelopment?: boolean;
  allowEmpty?: boolean;
  mode?: "single" | "combine";
}>;
function validateSelection(
  ids: readonly number[],
  options: ProRuleValidationOptions,
): void {
  if (ids.length === 0 && !options.allowEmpty)
    throw new Error("Select at least one Pro Token rule.");
  if (new Set(ids).size !== ids.length)
    throw new Error("Each Pro Token rule can only be selected once.");
  ids.forEach(ruleId);
  if (options.mode === "single" && ids.length > 1)
    throw new Error("Single rule mode accepts only one rule.");
  if (ids.length > 1 || options.mode === "combine")
    for (const id of ids)
      if (!PRO_COMBINABLE_RULES.includes(id))
        throw new Error(
          `${PRO_RULE_CATALOGUE[id].name} is available only in single rule mode.`,
        );
  for (const conflict of PRO_RULE_CONFLICT_DETAILS)
    if (conflict.rules.every((id) => ids.includes(id)))
      throw new Error(conflict.reason);
  if (options.supportedBitmap !== undefined)
    for (const id of ids)
      if (!hasProRuleCapability(options.supportedBitmap, id))
        throw new Error(
          `${PRO_RULE_CATALOGUE[id].name} is not supported by this deployment.`,
        );
  if (!options.allowDevelopment)
    for (const id of ids)
      if (PRO_RULE_CATALOGUE[id].status === "development")
        throw new Error(
          `${PRO_RULE_CATALOGUE[id].name} is still in development and cannot be encoded for launch.`,
        );
}
export function createProRuleDraft(id: number): ProRuleDraft {
  const definition = PRO_RULE_CATALOGUE[ruleId(id)];
  return Object.freeze({
    rule: id,
    values: Object.freeze(
      Object.fromEntries(
        definition.params.map((param) => [param.key, param.defaultValue]),
      ),
    ),
  });
}
export function validateProRuleDrafts(
  drafts: readonly ProRuleDraft[],
  options: ProRuleValidationOptions = {},
): readonly ProRuleDraft[] {
  if (!Array.isArray(drafts) || drafts.length > PRO_RULE_COUNT)
    throw new Error("Invalid Pro Token rule list.");
  validateSelection(
    drafts.map((draft) => draft.rule),
    options,
  );
  return Object.freeze(drafts.map(normalizeDraft));
}
function encodeNormalized(draft: ProRuleDraft): ProRuleConfig {
  const rule = ruleId(draft.rule);
  if (rule === ProRule.P2POnly || rule === ProRule.VenueLocked)
    return Object.freeze({ rule, data: "0x" });
  const payload = PAYLOADS[rule];
  if (!payload)
    throw new Error(
      `${PRO_RULE_CATALOGUE[rule].name} is still in development.`,
    );
  const values = PRO_RULE_CATALOGUE[rule].params.map((param) => {
    const value = draft.values[param.key];
    if (param.type === "percent") return parseProPercentPPM(value as string);
    if (param.type === "uint") return unsigned(value, param.label);
    if (param.type === "select") return Number(value);
    if (param.type === "tiers")
      return (value as readonly ProSlidingTierDraft[]).map((tier) => ({
        marketCapUsd18: parseProUsd18(tier.marketCapUsd),
        buyPPM: parseProPercentPPM(tier.buyPercent),
        sellPPM: parseProPercentPPM(tier.sellPercent),
      }));
    return value;
  });
  return Object.freeze({
    rule,
    data: encodeAbiParameters(
      parseAbiParameters(payload),
      rule === ProRule.HolderVesting
        ? [...values, HOLDER_VESTING_MIN_BUY_PPM]
        : values,
    ),
  });
}
export function encodeProRule(draft: ProRuleDraft): ProRuleConfig {
  return encodeProRules([draft])[0];
}
export function encodeProRules(
  drafts: readonly ProRuleDraft[],
  options: Omit<
    ProRuleValidationOptions,
    "allowDevelopment" | "allowEmpty"
  > = {},
): readonly ProRuleConfig[] {
  return Object.freeze(
    validateProRuleDrafts(drafts, options).map(encodeNormalized),
  );
}
export function validateProRuleConfigs(
  configs: readonly ProRuleConfig[],
  options: Omit<
    ProRuleValidationOptions,
    "allowDevelopment" | "allowEmpty"
  > = {},
): readonly ProRuleConfig[] {
  if (!Array.isArray(configs) || configs.length > PRO_RULE_COUNT)
    throw new Error("Invalid Pro Token rule list.");
  validateSelection(
    configs.map((config) => config.rule),
    options,
  );
  return Object.freeze(
    configs.map((config: ProRuleConfig) => {
      if (
        typeof config.data !== "string" ||
        !/^0x(?:[0-9a-fA-F]{2})*$/.test(config.data)
      )
        throw new Error("Invalid Pro Token ABI payload.");
      if (
        config.rule === ProRule.P2POnly ||
        config.rule === ProRule.VenueLocked
      ) {
        if (config.data !== "0x")
          throw new Error(
            `${PRO_RULE_CATALOGUE[config.rule].name} must use an empty payload; old PoolId payloads are not supported.`,
          );
        return Object.freeze({ ...config });
      }
      const payload = PAYLOADS[config.rule];
      if (!payload) throw new Error("Unsupported Pro Token ABI payload.");
      const decoded = decodeAbiParameters(
        parseAbiParameters(payload),
        config.data,
      );
      const params = PRO_RULE_CATALOGUE[config.rule].params;
      const draft = {
        rule: config.rule,
        values: Object.fromEntries(
          params.map((param, index) => [
            param.key,
            param.type === "tiers"
              ? (
                  decoded[index] as readonly {
                    marketCapUsd18: bigint;
                    buyPPM: number;
                    sellPPM: number;
                  }[]
                ).map((tier) => ({
                  marketCapUsd: formatProUsd18(tier.marketCapUsd18),
                  buyPercent: formatProPercentPPM(tier.buyPPM),
                  sellPercent: formatProPercentPPM(tier.sellPPM),
                }))
              : param.type === "percent"
                ? formatProPercentPPM(Number(decoded[index]))
                : param.type === "uint" || param.type === "select"
                  ? String(decoded[index])
                  : decoded[index],
          ]),
        ),
      } as ProRuleDraft;
      const normalized = encodeNormalized(normalizeDraft(draft));
      if (normalized.data.toLowerCase() !== config.data.toLowerCase())
        throw new Error("Noncanonical Pro Token ABI payload.");
      return normalized;
    }),
  );
}

export type ProTokenForm = Readonly<{
  schema: typeof PRO_TOKEN_SCHEMA;
  version: typeof PRO_TOKEN_VERSION;
  metadata: Readonly<{
    name: string;
    symbol: string;
    description: string;
    image: string;
    website: string;
    twitter: string;
    telegram: string;
  }>;
  market: Readonly<{
    quote: string;
    curve: "graduating" | "perpetual";
    openingBuy: string;
    /** Human quote units, converted using the verified quote asset decimals before signing. */
    phantomQuote: string;
    graduationThreshold: string;
    /** Whole basis points as strings; blank while deployment economics are being loaded. */
    baseFeeBps: string;
    buyTaxBps: string;
    sellTaxBps: string;
    /** Blank resolves to the initiating creator wallet in the launch adapter. */
    feeRecipient: string;
  }>;
  ruleMode: "single" | "combine";
  rules: readonly ProRuleDraft[];
}>;
export function createProTokenForm(): ProTokenForm {
  return Object.freeze({
    schema: PRO_TOKEN_SCHEMA,
    version: PRO_TOKEN_VERSION,
    metadata: Object.freeze({
      name: "",
      symbol: "",
      description: "",
      image: "",
      website: "",
      twitter: "",
      telegram: "",
    }),
    market: Object.freeze({
      quote: zeroAddress,
      curve: "graduating",
      openingBuy: "0",
      phantomQuote: "",
      graduationThreshold: "",
      baseFeeBps: "",
      buyTaxBps: "",
      sellTaxBps: "",
      feeRecipient: "",
    }),
    ruleMode: "single",
    rules: Object.freeze([]),
  });
}
function plainObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key))
  )
    throw new Error(`${label} has missing or unsupported fields.`);
  return record;
}
/** Import validates structure; unfinished input fields may be saved. Encoding validates complete launch values. */
export function importProTokenForm(json: string): ProTokenForm {
  if (json.length > 256_000)
    throw new Error("Pro Token form exceeds the import size limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Pro Token form must be valid JSON.");
  }
  const form = plainObject(parsed, "Pro Token form", [
    "schema",
    "version",
    "metadata",
    "market",
    "ruleMode",
    "rules",
  ]);
  if (form.schema !== PRO_TOKEN_SCHEMA || form.version !== PRO_TOKEN_VERSION)
    throw new Error("Unsupported Pro Token form schema or version.");
  const metadata = plainObject(form.metadata, "Token metadata", [
    "name",
    "symbol",
    "description",
    "image",
    "website",
    "twitter",
    "telegram",
  ]);
  if (Object.values(metadata).some((value) => typeof value !== "string"))
    throw new Error("Token metadata fields must be strings.");
  const market = plainObject(form.market, "Token market", [
    "quote",
    "curve",
    "openingBuy",
    "phantomQuote",
    "graduationThreshold",
    "baseFeeBps",
    "buyTaxBps",
    "sellTaxBps",
    "feeRecipient",
  ]);
  if (
    typeof market.quote !== "string" ||
    !isAddress(market.quote, { strict: true }) ||
    typeof market.openingBuy !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(market.openingBuy) ||
    (market.curve !== "graduating" && market.curve !== "perpetual")
  )
    throw new Error("Invalid Pro Token market settings.");
  for (const field of ["phantomQuote", "graduationThreshold"] as const) {
    const value = market[field];
    if (
      typeof value !== "string" ||
      (value !== "" && !/^\d+(?:\.\d+)?$/.test(value))
    )
      throw new Error(`Invalid saved ${field}. Use decimal quote units.`);
  }
  for (const field of ["baseFeeBps", "buyTaxBps", "sellTaxBps"] as const) {
    const value = market[field];
    if (
      typeof value !== "string" ||
      (value !== "" && (!/^\d+$/.test(value) || BigInt(value) > 9900n))
    )
      throw new Error(
        `Invalid saved ${field}. Use whole basis points between 0 and 9900.`,
      );
  }
  if (
    typeof market.feeRecipient !== "string" ||
    (market.feeRecipient !== "" &&
      (!isAddress(market.feeRecipient, { strict: true }) ||
        market.feeRecipient.toLowerCase() === zeroAddress))
  )
    throw new Error("Invalid saved fee recipient address.");
  if (form.ruleMode !== "single" && form.ruleMode !== "combine")
    throw new Error("Invalid Pro Token rule mode.");
  if (!Array.isArray(form.rules) || form.rules.length > PRO_RULE_COUNT)
    throw new Error("Invalid Pro Token rule list.");
  const rules = form.rules.map((value): ProRuleDraft => {
    const rule = plainObject(value, "Pro Token rule", ["rule", "values"]);
    if (typeof rule.rule !== "number")
      throw new Error("Unknown Pro Token rule.");
    const definition = PRO_RULE_CATALOGUE[ruleId(rule.rule)];
    if (
      rule.rule === ProRule.VenueLocked &&
      rule.values &&
      typeof rule.values === "object" &&
      Object.hasOwn(rule.values, "poolId")
    )
      throw new Error(
        "This saved Pool Anchor draft uses an obsolete PoolId. Start a new parameter-free Pool Anchor draft.",
      );
    if (
      rule.rule === ProRule.SlidingCaps &&
      rule.values &&
      typeof rule.values === "object" &&
      Object.hasOwn(rule.values, "oracle")
    )
      throw new Error(
        "This saved Value Ladder draft uses the earlier placeholder format. Re-enter its limits and thresholds; the price source is fixed by the deployment.",
      );
    // Drafts saved before the purchase minimum was removed still carry it, and it has no effect now.
    const savedValues =
      rule.rule === ProRule.HolderVesting &&
      rule.values &&
      typeof rule.values === "object" &&
      !Array.isArray(rule.values)
        ? Object.fromEntries(
            Object.entries(rule.values).filter(([key]) => key !== "minBuyPPM"),
          )
        : rule.values;
    const values = plainObject(
      savedValues,
      `${definition.name} settings`,
      definition.params.map((param) => param.key),
    );
    const copied = Object.fromEntries(
      definition.params.map((param) => {
        const raw = values[param.key];
        if (param.type === "tiers")
          return [param.key, copyProSlidingTiers(raw)];
        if (
          param.type === "boolean"
            ? typeof raw !== "boolean"
            : param.type === "addresses"
              ? !Array.isArray(raw) ||
                raw.some((entry) => typeof entry !== "string")
              : typeof raw !== "string"
        )
          throw new Error(`Invalid saved ${param.label}.`);
        return [param.key, Array.isArray(raw) ? Object.freeze([...raw]) : raw];
      }),
    );
    return Object.freeze({
      rule: rule.rule,
      values: Object.freeze(copied),
    }) as ProRuleDraft;
  });
  validateSelection(
    rules.map((rule) => rule.rule),
    { allowEmpty: true, allowDevelopment: true, mode: form.ruleMode },
  );
  return Object.freeze({
    schema: PRO_TOKEN_SCHEMA,
    version: PRO_TOKEN_VERSION,
    metadata: Object.freeze(metadata),
    market: Object.freeze({ ...market, quote: getAddress(market.quote) }),
    ruleMode: form.ruleMode,
    rules: Object.freeze(rules),
  }) as ProTokenForm;
}
export function exportProTokenForm(form: ProTokenForm): string {
  return JSON.stringify(importProTokenForm(JSON.stringify(form)), null, 2);
}

export const proFactoryAbi = parseAbi([
  "function proTokenVersion() view returns (uint256)",
  "function supportedRules() view returns (uint256)",
  "function supportsGraduation() view returns (bool)",
  "function partnerRegistry() view returns (address)",
  "function isSystemAddress(address account) view returns (bool)",
  "function priceInfrastructureConfigured() view returns (bool)",
  "function priceOracle() view returns (address)",
  "function slidingDeployer() view returns (address)",
  "function reactiveInfrastructureConfigured() view returns (bool)",
  "function reactiveDeployer() view returns (address)",
  "function linkRegistry() view returns (address)",
  "function reactiveDeployerCodeHash() view returns (bytes32)",
  "function linkRegistryCodeHash() view returns (bytes32)",
  "function deriveReactiveLinkId(address creator,bytes32 salt) view returns (bytes32)",
  "struct Metadata { string name; string symbol; string description; string image; string website; string twitter; string telegram; }",
  "struct CurveConfig { address quoteAsset; uint256 phantomQuote; uint256 graduationThreshold; uint16 baseFeeBps; uint16 buyTaxBps; uint16 sellTaxBps; bool perpetual; address feeRecipient; }",
  "struct RuleConfig { uint8 rule; bytes data; }",
  "struct LaunchRequest { Metadata metadata; uint256 supply; CurveConfig curve; RuleConfig[] rules; address[] walletExemptions; bytes32 salt; uint64 deadline; }",
  "function createLaunch(Metadata metadata,uint256 supply,CurveConfig curve,RuleConfig[] rules,address[] walletExemptions,bytes32 salt,uint64 deadline) returns(address token,address curveAddress,address policy)",
  "function createReactivePair(LaunchRequest first,LaunchRequest second,bytes32 linkSalt) returns(address token0,address token1)",
]);
/** Exact-prefunded rewards are managed after launch; these functions do not send transactions. */
export const proBuyerRewardsAbi = parseAbi([
  "function rewardAsset() view returns (address)",
  "function rewardKind() view returns (uint8)",
  "function rewardAmount() view returns (uint256)",
  "function claimable(address buyer) view returns (uint256)",
  "function nftBeneficiary(uint256 tokenId) view returns (address)",
  "function unusedERC20() view returns (uint256)",
  "function unusedNFTCount() view returns (uint256)",
  "function fundERC20(uint256 amount)",
  "function fundNFT(uint256 tokenId)",
  "function claimERC20(address recipient) returns (uint256 amount)",
  "function claimNFT(uint256 tokenId,address recipient)",
]);
/** Tithe transfer methods preserve full token amounts and require the fixed native contribution. */
export const proTitheTokenAbi = parseAbi([
  "function paidTransfer(address to,uint256 amount) payable returns (bool)",
  "function paidTransferFrom(address from,address to,uint256 amount) payable returns (bool)",
]);
export const proContributionVaultAbi = parseAbi([
  "function recipient() view returns (address)",
  "function contributionPerOperation() view returns (uint256)",
  "function pending() view returns (uint256)",
  "function contributed(address payer) view returns (uint256)",
  "function claim(address payout) returns (uint256 amount)",
]);
/** Exact settled activity; a baseline is read-only input, not partner-link authorization. */
export const proPartnerRegistryAbi = parseAbi([
  "function factory() view returns (address)",
  "function registryVersion() view returns (uint256)",
  "function curveOf(address token) view returns (address)",
  "function supplyOf(address token) view returns (uint256)",
  "function activity(address token) view returns (uint64 sequence,uint256 netTokensOut,uint256 boughtVolume,uint256 soldVolume)",
  "function volumeHighWords(address token) view returns (uint256 boughtHigh,uint256 soldHigh)",
  "function pressurePPM(address token,uint256 baselineNetTokens) view returns (int32)",
  "event LaunchRegistered(address indexed token,address indexed curve,address indexed creator,address policy,uint256 supply,bytes32 configurationHash)",
  "event TradeRecorded(address indexed token,address indexed curve,uint64 sequence,bool isBuy,uint256 tokenAmount,uint256 netTokensOut,uint256 boughtVolume,uint256 soldVolume,uint256 boughtVolumeHigh,uint256 soldVolumeHigh)",
]);
/** Rebuild exact raw lifetime volume from its two uint256 storage words. */
export function combineProVolumeWords(high: bigint, low: bigint): bigint {
  const limit = 1n << 256n;
  if (
    typeof high !== "bigint" ||
    typeof low !== "bigint" ||
    high < 0n ||
    high >= limit ||
    low < 0n ||
    low >= limit
  )
    throw new Error("Pro volume words must be uint256 bigint values.");
  return (high << 256n) | low;
}
export const proSlidingCapsAbi = parseAbi([
  "function controller() view returns (address)",
  "function token() view returns (address)",
  "function oracle() view returns (address)",
  "function maxAgeSeconds() view returns (uint32)",
  "function tierCount() view returns (uint256)",
  "function tierAt(uint256 index) view returns ((uint256 marketCapUsd18,uint32 buyPPM,uint32 sellPPM))",
  "function currentCaps() view returns (uint32 buyPPM,uint32 sellPPM,uint8 tier,uint256 marketCapUsd18,uint64 observedAt)",
  "function currentLimits() view returns (uint256 maximumBuy,uint256 maximumSell,uint8 tier,uint256 marketCapUsd18,uint64 observedAt)",
]);
const proPriceSourceAbi = parseAbi([
  "function oracleVersion() view returns (uint256)",
  "function updater() view returns (address)",
  "function maxAgeSeconds() view returns (uint32)",
]);
const proReactiveInfrastructureAbi = parseAbi([
  "function factory() view returns (address)",
  "function proTokenVersion() view returns (uint256)",
  "function deployerKind() view returns (uint256)",
  "function linkRegistry() view returns (address)",
  "function activityRegistry() view returns (address)",
]);
const proReactiveRegistryIdentityAbi = parseAbi([
  "function factory() view returns (address)",
  "function linkRegistryVersion() view returns (uint256)",
  "function deployer() view returns (address)",
  "function activityRegistry() view returns (address)",
]);
export type ProPriceInfrastructure = Readonly<{
  oracle: Address;
  updater: Address;
  maxAgeSeconds: number;
  slidingDeployer: Address;
}>;
export type ProReactiveInfrastructure = Readonly<{
  helper: Address;
  linkRegistry: Address;
  helperCodeHash: Hex;
  linkRegistryCodeHash: Hex;
}>;
export type ProTokenCapabilities = Readonly<{
  version: 1;
  supportedBitmap: bigint;
  factory: Address;
  supportsGraduation: boolean;
  partnerRegistry: Address;
  /** Canonical reader metadata; legacy hand-built permanent contexts may omit it. */
  chainId?: bigint;
  blockNumber?: bigint;
  blockHash?: Hex;
  blockTimestamp?: bigint;
  supportedGraduatingBitmap?: bigint;
  graduationInfrastructure?: ProGraduationInfrastructureProof;
  priceInfrastructure?: ProPriceInfrastructure;
  reactiveInfrastructure?: ProReactiveInfrastructure;
}>;
export type ProTokenCapabilitySnapshot = ProTokenCapabilities &
  Readonly<{
    chainId: bigint;
    blockNumber: bigint;
    blockHash: Hex;
    blockTimestamp: bigint;
    supportedGraduatingBitmap: bigint;
  }>;
const graduationOnlyRuleBitmap =
  (1n << BigInt(ProRule.VenueLocked)) | (1n << BigInt(ProRule.P2POnly));
/**
 * Read only one canonical block; an unsupported EIP-1898 RPC fails without a latest-state fallback.
 * A graduation manifest is trusted reviewed deployment configuration, never saved user-draft input.
 * Without it, graduation and its exclusive R12/R17 rules remain unavailable.
 */
export async function readProTokenCapabilities(
  client: PublicClient,
  factory: Address,
  reviewedManifest?: ProGraduationSourceManifest,
  selector?: ProBootstrapSnapshotSelector,
): Promise<ProTokenCapabilitySnapshot> {
  const target = wallet(factory, "Pro factory");
  // Selection fixes a canonical block only; it does not issue source authority or
  // permit aggregation. Capture every field before the first asynchronous read.
  const selectedUint = (value: unknown, bits: number, label: string): bigint => {
    if (typeof value !== "bigint" || value < 0n || value >= 1n << BigInt(bits))
      throw new Error("Selected capability " + label + " must fit uint" + bits + ".");
    return value;
  };
  const selected = selector === undefined ? undefined : Object.freeze({
    blockNumber: selectedUint(selector?.blockNumber, 256, "block number"),
    blockHash: bytes32(selector?.blockHash, "Selected capability block hash"),
    ...(selector.chainId === undefined ? {} : { chainId: selectedUint(selector.chainId, 256, "chain ID") }),
    ...(selector.blockTimestamp === undefined ? {} : { blockTimestamp: selectedUint(selector.blockTimestamp, 64, "timestamp") }),
  });
  const [rawChain, blockNumber] = await Promise.all([
    client.getChainId(),
    selected ? Promise.resolve(selected.blockNumber) : client.getBlockNumber({ cacheTime: 0 }),
  ]);
  if (!Number.isSafeInteger(rawChain) || rawChain < 1)
    throw new Error("RPC returned an invalid capability chain ID.");
  const chainId = BigInt(rawChain);
  if (selected?.chainId !== undefined && selected.chainId !== chainId)
    throw new Error("Selected capability chain differs from the fresh RPC chain.");
  if (
    typeof blockNumber !== "bigint" ||
    blockNumber < 0n ||
    blockNumber >= 1n << 256n
  )
    throw new Error("RPC returned an invalid capability block number.");
  const before = await client.getBlock({ blockNumber });
  if (
    before.number !== blockNumber ||
    typeof before.timestamp !== "bigint" ||
    before.timestamp < 0n ||
    before.timestamp >= 1n << 64n ||
    typeof before.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(before.hash) ||
    /^0x0{64}$/.test(before.hash)
  )
    throw new Error("RPC did not return the requested mined capability block.");
  const blockHash = before.hash.toLowerCase() as Hex;
  const blockTimestamp = before.timestamp;
  if (selected && (selected.blockHash !== blockHash ||
      selected.blockTimestamp !== undefined && selected.blockTimestamp !== blockTimestamp))
    throw new Error("Selected capability hash or timestamp differs from the fresh canonical header.");
  const pinnedBlock = Object.freeze({
    blockHash,
    requireCanonical: true as const,
  });
  const factoryCode = await client.getCode({ address: target, ...pinnedBlock });
  if (!factoryCode || factoryCode === "0x")
    throw new Error(
      "Pro factory has no contract code at the capability block.",
    );
  // Only a previously completed v3 bootstrap on this exact client/factory/hash
  // can select the existing source-reviewed public getter lane.
  const aggregate = canAggregateProCanonicalGetters(client, target, blockHash);
  const getters = async <const T extends Parameters<typeof readProCanonicalGetterBatch>[2]>(
    contracts: T,
  ): Promise<MulticallReturnType<T, false>> => (aggregate
    ? await readProCanonicalGetterBatch(client, blockHash, contracts)
    : await Promise.all(contracts.map(contract => client.readContract({ ...contract, ...pinnedBlock } as never)))) as MulticallReturnType<T, false>;
  const [version, bitmap, supportsGraduation, registryAddress] =
    await getters([
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "proTokenVersion",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "supportedRules",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "supportsGraduation",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "partnerRegistry",
      },
    ]);
  if (
    version !== 1n ||
    typeof bitmap !== "bigint" ||
    typeof supportsGraduation !== "boolean" ||
    bitmap < 0n ||
    bitmap > PRO_ALL_RULE_BITMAP
  )
    throw new Error("Unsupported Pro Token factory capabilities.");
  if (!supportsGraduation && (bitmap & graduationOnlyRuleBitmap) !== 0n)
    throw new Error(
      "Factory graduation support is inconsistent with its graduation-only rules.",
    );
  const partnerRegistry = wallet(registryAddress, "partner activity registry");
  if (partnerRegistry.toLowerCase() === target.toLowerCase())
    throw new Error("Partner activity registry must differ from its factory.");
  const registryCode = await client.getCode({
    address: partnerRegistry,
    ...pinnedBlock,
  });
  if (!registryCode || registryCode === "0x")
    throw new Error(
      "Partner activity registry has no contract code at the capability block.",
    );
  const [registryFactory, registryVersion, registryIsSystem] =
    await getters([
      {
        address: partnerRegistry,
        abi: proPartnerRegistryAbi,
        functionName: "factory",
      },
      {
        address: partnerRegistry,
        abi: proPartnerRegistryAbi,
        functionName: "registryVersion",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "isSystemAddress",
        args: [partnerRegistry],
      },
    ]);
  if (
    registryVersion !== 1n ||
    registryIsSystem !== true ||
    typeof registryFactory !== "string" ||
    registryFactory.toLowerCase() !== target.toLowerCase()
  )
    throw new Error("Unsupported or foreign partner activity registry.");
  let priceInfrastructure: ProPriceInfrastructure | undefined;
  if (hasProRuleCapability(bitmap, ProRule.SlidingCaps)) {
    const [configured, oracleAddress, deployerAddress] = await getters([
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "priceInfrastructureConfigured",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "priceOracle",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "slidingDeployer",
      },
    ]);
    if (configured !== true)
      throw new Error("Value Ladder price infrastructure is not configured.");
    const oracle = wallet(oracleAddress, "price oracle");
    const slidingDeployer = wallet(deployerAddress, "sliding deployer");
    const systemAddresses = [
      target,
      partnerRegistry,
      oracle,
      slidingDeployer,
    ].map((address) => address.toLowerCase());
    if (new Set(systemAddresses).size !== 4)
      throw new Error(
        "Factory, partner registry, price oracle and sliding deployer identities must differ.",
      );
    const [oracleCode, deployerCode] = await Promise.all([
      client.getCode({ address: oracle, ...pinnedBlock }),
      client.getCode({ address: slidingDeployer, ...pinnedBlock }),
    ]);
    if (
      !oracleCode ||
      oracleCode === "0x" ||
      !deployerCode ||
      deployerCode === "0x"
    )
      throw new Error(
        "Price infrastructure has no contract code at the capability block.",
      );
    const [oracleVersion, updaterAddress, maxAgeSeconds] = await getters([
      {
        address: oracle,
        abi: proPriceSourceAbi,
        functionName: "oracleVersion",
      },
      {
        address: oracle,
        abi: proPriceSourceAbi,
        functionName: "updater",
      },
      {
        address: oracle,
        abi: proPriceSourceAbi,
        functionName: "maxAgeSeconds",
      },
    ]);
    if (
      oracleVersion !== 1n ||
      typeof maxAgeSeconds !== "number" ||
      !Number.isInteger(maxAgeSeconds) ||
      maxAgeSeconds < 1 ||
      maxAgeSeconds > 4294967295
    )
      throw new Error("Unsupported Pro price source.");
    const updater = wallet(updaterAddress, "price updater");
    if (systemAddresses.includes(updater.toLowerCase()))
      throw new Error(
        "Price signing authority must differ from infrastructure contracts.",
      );
    const updaterCode = await client.getCode({
      address: updater,
      ...pinnedBlock,
    });
    if (updaterCode && updaterCode !== "0x")
      throw new Error(
        "Price signing authority must be an EOA at the capability block.",
      );
    priceInfrastructure = Object.freeze({
      oracle,
      slidingDeployer,
      updater,
      maxAgeSeconds,
    });
  }
  let reactiveInfrastructure: ProReactiveInfrastructure | undefined;
  if (hasProRuleCapability(bitmap, ProRule.ReactivePair)) {
    const [
      configured,
      helperAddress,
      linkAddress,
      helperHash,
      linkHash,
      mappedOracle,
      mappedSliding,
    ] = await getters([
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "reactiveInfrastructureConfigured",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "reactiveDeployer",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "linkRegistry",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "reactiveDeployerCodeHash",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "linkRegistryCodeHash",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "priceOracle",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "slidingDeployer",
      },
    ]);
    if (configured !== true)
      throw new Error("Linked Pulse infrastructure is not configured.");
    const helper = wallet(helperAddress, "Linked Pulse helper");
    const linkRegistry = wallet(linkAddress, "Linked Pulse link registry");
    const helperCodeHash = bytes32(helperHash, "Linked Pulse helper code hash");
    const linkRegistryCodeHash = bytes32(
      linkHash,
      "Linked Pulse registry code hash",
    );
    const priceAddresses = [mappedOracle, mappedSliding].map((value) => {
      if (typeof value !== "string" || !isAddress(value, { strict: true }))
        throw new Error("Invalid Linked Pulse price infrastructure identity.");
      return getAddress(value);
    });
    if (
      priceInfrastructure &&
      (priceAddresses[0].toLowerCase() !==
        priceInfrastructure.oracle.toLowerCase() ||
        priceAddresses[1].toLowerCase() !==
          priceInfrastructure.slidingDeployer.toLowerCase())
    )
      throw new Error(
        "Price infrastructure identity changed within the capability block.",
      );
    const fixedAddresses = [target, partnerRegistry, helper, linkRegistry].map(
      (value) => value.toLowerCase(),
    );
    if (
      new Set(fixedAddresses).size !== fixedAddresses.length ||
      priceAddresses.some(
        (value) =>
          value !== zeroAddress && fixedAddresses.includes(value.toLowerCase()),
      )
    )
      throw new Error(
        "Factory, activity registry, Linked Pulse and price infrastructure identities must differ.",
      );
    if (
      priceInfrastructure &&
      [helper, linkRegistry].some(
        (value) =>
          value.toLowerCase() === priceInfrastructure.updater.toLowerCase(),
      )
    )
      throw new Error(
        "Linked Pulse infrastructure must differ from its price signing authority.",
      );
    const [helperCode, linkCode] = await Promise.all([
      client.getCode({ address: helper, ...pinnedBlock }),
      client.getCode({ address: linkRegistry, ...pinnedBlock }),
    ]);
    if (
      !helperCode ||
      !linkCode ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(helperCode) ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(linkCode)
    )
      throw new Error(
        "Linked Pulse infrastructure has no valid contract code at the capability block.",
      );
    if (
      keccak256(helperCode) !== helperCodeHash ||
      keccak256(linkCode) !== linkRegistryCodeHash
    )
      throw new Error(
        "Linked Pulse infrastructure code hash does not match the Factory pin.",
      );
    const [
      helperFactory,
      helperVersion,
      kind,
      helperRegistry,
      helperActivity,
      registryFactory,
      registryVersion,
      registryDeployer,
      registryActivity,
      helperIsSystem,
      linkIsSystem,
    ] = await getters([
      {
        address: helper,
        abi: proReactiveInfrastructureAbi,
        functionName: "factory",
      },
      {
        address: helper,
        abi: proReactiveInfrastructureAbi,
        functionName: "proTokenVersion",
      },
      {
        address: helper,
        abi: proReactiveInfrastructureAbi,
        functionName: "deployerKind",
      },
      {
        address: helper,
        abi: proReactiveInfrastructureAbi,
        functionName: "linkRegistry",
      },
      {
        address: helper,
        abi: proReactiveInfrastructureAbi,
        functionName: "activityRegistry",
      },
      {
        address: linkRegistry,
        abi: proReactiveRegistryIdentityAbi,
        functionName: "factory",
      },
      {
        address: linkRegistry,
        abi: proReactiveRegistryIdentityAbi,
        functionName: "linkRegistryVersion",
      },
      {
        address: linkRegistry,
        abi: proReactiveRegistryIdentityAbi,
        functionName: "deployer",
      },
      {
        address: linkRegistry,
        abi: proReactiveRegistryIdentityAbi,
        functionName: "activityRegistry",
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "isSystemAddress",
        args: [helper],
      },
      {
        address: target,
        abi: proFactoryAbi,
        functionName: "isSystemAddress",
        args: [linkRegistry],
      },
    ]);
    if (
      helperVersion !== 1n ||
      kind !== 6n ||
      registryVersion !== 1n ||
      helperIsSystem !== true ||
      linkIsSystem !== true ||
      wallet(helperFactory, "Linked Pulse helper factory").toLowerCase() !==
        target.toLowerCase() ||
      wallet(registryFactory, "Linked Pulse registry factory").toLowerCase() !==
        target.toLowerCase() ||
      wallet(helperRegistry, "Linked Pulse helper registry").toLowerCase() !==
        linkRegistry.toLowerCase() ||
      wallet(
        helperActivity,
        "Linked Pulse helper activity registry",
      ).toLowerCase() !== partnerRegistry.toLowerCase() ||
      wallet(
        registryDeployer,
        "Linked Pulse registry deployer",
      ).toLowerCase() !== helper.toLowerCase() ||
      wallet(
        registryActivity,
        "Linked Pulse activity registry",
      ).toLowerCase() !== partnerRegistry.toLowerCase()
    )
      throw new Error(
        "Unsupported, unregistered or foreign Linked Pulse infrastructure.",
      );
    reactiveInfrastructure = Object.freeze({
      helper,
      linkRegistry,
      helperCodeHash,
      linkRegistryCodeHash,
    });
  }
  let graduationInfrastructure: ProGraduationInfrastructureProof | undefined;
  if (supportsGraduation && reviewedManifest !== undefined) {
    const proof = await readProGraduationInfrastructure(
      client,
      target,
      reviewedManifest,
      Object.freeze({ blockNumber, blockHash }),
    );
    assertProGraduationInfrastructureProof(proof);
    if (
      proof.factoryVersion !== 1 ||
      proof.supportsGraduation !== true ||
      proof.components.factory.address.toLowerCase() !== target.toLowerCase() ||
      proof.components.partnerRegistry.address.toLowerCase() !==
        partnerRegistry.toLowerCase() ||
      proof.supportedBitmap !== bitmap ||
      proof.chainId !== chainId ||
      proof.blockNumber !== blockNumber ||
      proof.blockHash !== blockHash ||
      proof.blockTimestamp !== blockTimestamp
    )
      throw new Error(
        "Graduation infrastructure differs from the common capability snapshot.",
      );
    graduationInfrastructure = proof;
  }
  const [after, afterChain] = await Promise.all([
    client.getBlock({ blockNumber }),
    client.getChainId(),
  ]);
  if (
    after.number !== blockNumber ||
    typeof after.hash !== "string" ||
    after.hash.toLowerCase() !== blockHash ||
    after.timestamp !== blockTimestamp ||
    afterChain !== rawChain
  )
    throw new Error(
      "Capability state block changed or chain changed during acquisition (reorg).",
    );
  return Object.freeze({
    version: 1,
    supportedBitmap: graduationInfrastructure
      ? bitmap
      : bitmap & ~graduationOnlyRuleBitmap,
    factory: target,
    supportsGraduation: graduationInfrastructure !== undefined,
    partnerRegistry,
    chainId,
    blockNumber,
    blockHash,
    blockTimestamp,
    supportedGraduatingBitmap:
      graduationInfrastructure?.supportedGraduatingBitmap ?? 0n,
    ...(graduationInfrastructure ? { graduationInfrastructure } : {}),
    ...(priceInfrastructure ? { priceInfrastructure } : {}),
    ...(reactiveInfrastructure ? { reactiveInfrastructure } : {}),
  });
}
