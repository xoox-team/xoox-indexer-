import {
  isAddress,
  keccak256,
  stringToHex,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import {
  assertProFeeProgramLaunch,
  type ProFeeProgramLaunch,
} from "./vendor/xoox-sdk/pro-fee-program-launch";
import {
  validateProFeeProgramConfig,
  validateProFeeProgramCycle,
} from "./vendor/xoox-sdk/pro-fee-programs";
import {
  planVerifiedProProgramCycle,
  proProgramEvidenceJson,
  type ProProgramExecutionInput,
  type ProProgramPlan,
  type ProProgramQuote,
} from "./pro-program-execution";
import { type ProSnapshotSource } from "./pro-program-snapshots";

export const PRO_PROGRAM_EVIDENCE_MAX_BYTES = 8_388_608;
/** The reviewed infrastructure list (at most 256) plus the wallets the planner excludes because they cannot receive
 * native currency (it screens at most 10,000), so a hostile holder or buyer set can never make a plan unreplayable. */
export const PRO_PROGRAM_EVIDENCE_MAX_INFRASTRUCTURE = 256 + 10_000;
type RecordValue = Record<string, unknown>;
function need(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Pro program evidence: " + message + ".");
}
function record(value: unknown, label: string): RecordValue {
  need(
    !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    label + " must be a plain record",
  );
  return value as RecordValue;
}
function fields(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  label = "record",
): RecordValue {
  const value = record(input, label),
    keys = Object.keys(value);
  need(
    required.every((key) => Object.hasOwn(value, key)) &&
      keys.every((key) => required.includes(key) || optional.includes(key)),
    label + " contains missing or unknown fields",
  );
  return value;
}
function integer(value: unknown, label: string, bits = 256): bigint {
  need(
    typeof value === "string" &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      value.length <= 78,
    label + " must contain unsigned integer base units",
  );
  const result = BigInt(value);
  need(result < 1n << BigInt(bits), label + " exceeds uint" + bits);
  return result;
}
function number(
  value: unknown,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  need(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
    label + " must be a bounded whole number",
  );
  return value;
}
function address(value: unknown, label: string): Address {
  need(
    typeof value === "string" && isAddress(value, { strict: true }),
    label + " must be an EVM address",
  );
  return value as Address;
}
function hash(value: unknown, label: string, nonzero = false): Hex {
  need(
    typeof value === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(value) &&
      (!nonzero || value.toLowerCase() !== zeroHash),
    label + " must be bytes32",
  );
  return value as Hex;
}
function bytes(value: unknown, label: string): Hex {
  need(
    typeof value === "string" &&
      /^0x(?:[0-9a-fA-F]{2})*$/.test(value) &&
      value.length <= 131074,
    label + " must contain bounded hex bytes",
  );
  return value as Hex;
}
function text(value: unknown, label: string, max = 512): string {
  need(
    typeof value === "string" &&
      value.length <= max &&
      !value.includes("\0") &&
      new TextDecoder().decode(new TextEncoder().encode(value)) === value,
    label + " must contain bounded valid Unicode",
  );
  return value;
}
function boolean(value: unknown, label: string): boolean {
  need(typeof value === "boolean", label + " must be boolean");
  return value;
}
function array(value: unknown, label: string, max = 100000): unknown[] {
  need(
    Array.isArray(value) && value.length <= max,
    label + " must be a bounded array",
  );
  return value;
}
function units(
  raw: RecordValue,
  names: readonly string[],
  label: string,
): RecordValue {
  // Preserve the exact public object's insertion order; the evidence preimage
  // deliberately commits the original serialization, not a new key sort.
  return {
    ...raw,
    ...Object.fromEntries(
      names.map((name) => [name, integer(raw[name], label + "." + name)]),
    ),
  };
}
function evidencePreimage(
  raw: RecordValue,
  digestField: string,
  label: string,
) {
  if (!Object.hasOwn(raw, "evidenceJson")) return;
  const json = text(
    raw.evidenceJson,
    label + " public preimage",
    PRO_PROGRAM_EVIDENCE_MAX_BYTES,
  );
  need(
    new TextEncoder().encode(json).length <= PRO_PROGRAM_EVIDENCE_MAX_BYTES,
    label + " public preimage is too large",
  );
  need(
    keccak256(stringToHex(json)) === String(raw[digestField]).toLowerCase(),
    label + " public preimage differs from its evidence digest",
  );
}
function source(input: unknown): ProSnapshotSource {
  const raw = fields(
    input,
    [
      "chainId",
      "token",
      "factory",
      "curve",
      "vault",
      "creator",
      "configurationHash",
      "tokenCodeHash",
      "createdBlock",
      "blockNumber",
      "blockHash",
      "timestamp",
      "tokenDecimals",
      "genesisSupply",
      "cumulativeBurned",
      "currentSupply",
      "balancesComplete",
      "balancesFromBlock",
      "balancesThroughBlock",
      "infrastructure",
    ],
    ["poolCreatedBlock", "poolCreatedAt"],
    "source",
  );
  number(raw.chainId, "source chain", 1);
  number(raw.tokenDecimals, "token decimals", 0, 255);
  for (const name of ["token", "factory", "curve", "vault", "creator"])
    address(raw[name], "source " + name);
  for (const name of ["configurationHash", "tokenCodeHash", "blockHash"])
    hash(raw[name], "source " + name, true);
  boolean(raw.balancesComplete, "complete balance coverage");
  array(
    raw.infrastructure,
    "infrastructure",
    PRO_PROGRAM_EVIDENCE_MAX_INFRASTRUCTURE,
  ).forEach((item) => address(item, "infrastructure address"));
  need(
    Object.hasOwn(raw, "poolCreatedBlock") ===
      Object.hasOwn(raw, "poolCreatedAt"),
    "pool transition is incomplete",
  );
  return units(
    raw,
    [
      "createdBlock",
      "blockNumber",
      "timestamp",
      "genesisSupply",
      "cumulativeBurned",
      "currentSupply",
      "balancesFromBlock",
      "balancesThroughBlock",
      ...(raw.poolCreatedBlock === undefined
        ? []
        : ["poolCreatedBlock", "poolCreatedAt"]),
    ],
    "source",
  ) as ProSnapshotSource;
}
function configuration(input: unknown) {
  const raw = fields(
    input,
    ["poolFeeBps", "snapshotMaxAge", "programs"],
    [],
    "configuration",
  );
  return validateProFeeProgramConfig({
    ...raw,
    programs: array(raw.programs, "programs", 26).map((item) =>
      units(
        record(item, "program"),
        ["minHolding", "maxHolding", "dailySalary"],
        "program",
      ),
    ),
  });
}
function quote(input: unknown): ProProgramQuote {
  const raw = fields(
    input,
    [
      "adapter",
      "adapterCodeHash",
      "inputAsset",
      "outputAsset",
      "amountIn",
      "amountSpent",
      "amountOut",
      "blockNumber",
      "blockHash",
      "deadline",
      "data",
      "evidence",
    ],
    ["evidenceJson"],
    "quote",
  );
  for (const name of ["adapter", "inputAsset", "outputAsset"])
    address(raw[name], "quote " + name);
  for (const name of ["adapterCodeHash", "blockHash", "evidence"])
    hash(raw[name], "quote " + name, true);
  bytes(raw.data, "quote data");
  evidencePreimage(raw, "evidence", "quote");
  return units(
    raw,
    ["amountIn", "amountSpent", "amountOut", "blockNumber", "deadline"],
    "quote",
  ) as ProProgramQuote;
}
function trades(
  input: unknown,
): NonNullable<ProProgramExecutionInput["trades"]> {
  const raw = fields(
    input,
    [
      "buys",
      "coverage",
      "windowFrom",
      "requiredSources",
      "consumedLastBuyerIds",
    ],
    [],
    "trade observations",
  );
  const venues = (input: unknown) => {
    need(
      input === "curve" || input === "pool",
      "trade source must be curve or pool",
    );
    return input;
  };
  const buys = array(raw.buys, "canonical purchases").map((item) => {
    const value = fields(
      item,
      [
        "id",
        "token",
        "buyer",
        "recipient",
        "quoteAmount",
        "blockNumber",
        "blockHash",
        "timestamp",
        "logIndex",
        "source",
      ],
      ["tokenAmount"],
      "purchase",
    );
    text(value.id, "purchase ID");
    for (const name of ["token", "buyer", "recipient"])
      address(value[name], "purchase " + name);
    hash(value.blockHash, "purchase block hash", true);
    number(value.logIndex, "purchase log index");
    venues(value.source);
    return units(
      value,
      [
        "quoteAmount",
        "blockNumber",
        "timestamp",
        ...(value.tokenAmount === undefined ? [] : ["tokenAmount"]),
      ],
      "purchase",
    );
  });
  const coverage = array(raw.coverage, "purchase coverage", 16).map((item) => {
    const value = fields(
      item,
      [
        "token",
        "fromTimestamp",
        "throughTimestamp",
        "throughBlock",
        "throughBlockHash",
        "source",
        "scope",
        "complete",
        "evidence",
      ],
      [],
      "coverage",
    );
    address(value.token, "coverage token");
    hash(value.throughBlockHash, "coverage block hash", true);
    hash(value.evidence, "coverage evidence", true);
    venues(value.source);
    need(
      value.scope === "all-public-swaps" ||
        value.scope === "reviewed-router-only",
      "unknown coverage scope",
    );
    boolean(value.complete, "coverage completeness");
    return units(
      value,
      ["fromTimestamp", "throughTimestamp", "throughBlock"],
      "coverage",
    );
  });
  return {
    ...raw,
    buys,
    coverage,
    windowFrom: integer(raw.windowFrom, "buyer window"),
    requiredSources: array(raw.requiredSources, "required venues", 2).map(
      venues,
    ),
    consumedLastBuyerIds: array(
      raw.consumedLastBuyerIds,
      "consumed winner IDs",
    ).map((item) => text(item, "winner event ID")),
  } as unknown as NonNullable<ProProgramExecutionInput["trades"]>;
}
function listings(
  input: unknown,
): NonNullable<ProProgramExecutionInput["listings"]> {
  const raw = fields(
    input,
    ["collection", "blockHash", "complete", "evidence", "items"],
    ["evidenceJson"],
    "listing book",
  );
  address(raw.collection, "listing collection");
  hash(raw.blockHash, "listing block hash", true);
  hash(raw.evidence, "listing evidence", true);
  evidencePreimage(raw, "evidence", "listing");
  boolean(raw.complete, "listing completeness");
  return {
    ...raw,
    items: array(raw.items, "listings", 10000).map((item) => {
      const value = fields(
        item,
        ["collection", "tokenId", "price", "expiresAt", "orderHash", "data"],
        [],
        "listing",
      );
      address(value.collection, "listing collection");
      hash(value.orderHash, "listing order hash", true);
      bytes(value.data, "listing data");
      return units(value, ["tokenId", "price", "expiresAt"], "listing");
    }),
  } as unknown as NonNullable<ProProgramExecutionInput["listings"]>;
}

/** Rebuilds an issued plan from the committed public preimage and the original
 * reader-issued snapshot. It never admits a serialized plan/population as proof.
 * The expected digest must come from the submitted cycle or its accepted journal. */
export async function replayVerifiedProProgramPlan(
  launch: ProFeeProgramLaunch,
  evidenceJson: string,
  expectedEvidence: Hex,
): Promise<ProProgramPlan> {
  assertProFeeProgramLaunch(launch);
  hash(expectedEvidence, "expected cycle evidence", true);
  need(
    typeof evidenceJson === "string" &&
      new TextEncoder().encode(evidenceJson).length <=
        PRO_PROGRAM_EVIDENCE_MAX_BYTES,
    "public evidence is too large",
  );
  const data = fields(
    JSON.parse(evidenceJson),
    [
      "domain",
      "chainId",
      "factory",
      "token",
      "vault",
      "executor",
      "configurationHash",
      "snapshotBlock",
      "snapshotHash",
      "snapshotTimestamp",
      "configuration",
      "source",
      "balances",
      "quoteAsset",
      "quoteDecimals",
      "assetDecimals",
      "slippageBps",
      "plannedAt",
      "programIndex",
      "cycleId",
      "state",
      "actions",
      "dependencies",
      "lottery",
      "listings",
      "ai",
      "winnerEventId",
    ],
    [],
    "public cycle evidence",
  );
  need(data.ai === null, "retired model observations are not supported");
  need(
    proProgramEvidenceJson(data) === evidenceJson,
    "public evidence must use the original canonical JSON serialization",
  );
  need(
    keccak256(stringToHex(evidenceJson)) === expectedEvidence.toLowerCase(),
    "public evidence digest differs from the committed cycle",
  );
  need(
    data.domain === "xoox-pro-program-cycle-v4",
    "unsupported evidence domain",
  );
  number(data.chainId, "chain ID", 1);
  for (const name of ["factory", "token", "vault", "executor"])
    address(data[name], "identity " + name);
  hash(data.configurationHash, "configuration hash", true);
  hash(data.snapshotHash, "snapshot hash", true);
  const snapshotBlock = integer(data.snapshotBlock, "snapshot block"),
    snapshotTimestamp = integer(data.snapshotTimestamp, "snapshot time", 64);
  need(
    data.chainId === Number(launch.chainId) &&
      String(data.factory).toLowerCase() === launch.factory.toLowerCase() &&
      String(data.token).toLowerCase() === launch.token.toLowerCase() &&
      String(data.vault).toLowerCase() === launch.vault.toLowerCase() &&
      data.configurationHash === launch.configurationHash &&
      snapshotBlock === launch.blockNumber &&
      data.snapshotHash === launch.blockHash &&
      snapshotTimestamp === launch.blockTimestamp,
    "replay must use the same original issued launch snapshot",
  );
  const originalSource = source(data.source),
    state = fields(
      data.state,
      [
        "budget",
        "holderCarryQuote",
        "lastCycle",
        "lastCycleAt",
        "waitingSince",
        "salaryAvailable",
      ],
      [],
      "canonical program state",
    );
  const originalActions = array(data.actions, "original actions", 8).map(
    (item) =>
      units(
        record(item, "original action"),
        ["amount", "minOut", "nftId"],
        "action",
      ),
  );
  const originalCycle = validateProFeeProgramCycle({
    id: integer(data.cycleId, "cycle ID", 64),
    observedAt: originalSource.timestamp,
    deadline:
      integer(data.plannedAt, "planned time", 64) +
      BigInt(
        Math.min(
          number(
            record(data.configuration, "configuration").snapshotMaxAge,
            "snapshot age",
            1,
            86400,
          ),
          300,
        ),
      ),
    evidence: expectedEvidence,
    actions: originalActions,
  });
  const dependencies = array(data.dependencies, "public dependencies", 256).map(
    (item) => record(item, "dependency"),
  );
  const quotes = dependencies
      .filter((item) => Object.hasOwn(item, "adapter"))
      .map(quote),
    tradeRows = dependencies.filter((item) => Object.hasOwn(item, "trades"));
  need(tradeRows.length <= 1, "duplicate saved purchase observations");
  let cursor = 0;
  const input: ProProgramExecutionInput = {
    configuration: configuration(data.configuration),
    configurationHash: data.configurationHash as Hex,
    programIndex: number(data.programIndex, "program index", 0, 25),
    source: originalSource,
    quoteAsset: address(data.quoteAsset, "actual quote asset"),
    quoteDecimals: number(data.quoteDecimals, "quote decimals", 0, 36),
    executor: address(data.executor, "executor"),
    now: integer(data.plannedAt, "planned time", 64),
    state: units(
      state,
      Object.keys(state),
      "program state",
    ) as ProProgramExecutionInput["state"],
    balances: array(data.balances, "holder observations").map((item) => {
      const value = fields(item, ["account", "balance"], [], "balance");
      return {
        ...value,
        account: address(value.account, "holder account"),
        balance: integer(value.balance, "holder base units"),
      };
    }),
    assetDecimals: array(data.assetDecimals, "asset precisions", 32).map(
      (item) => {
        const value = fields(
          item,
          ["asset", "decimals"],
          [],
          "asset precision",
        );
        return {
          ...value,
          asset: address(value.asset, "asset"),
          decimals: number(value.decimals, "asset decimals", 0, 36),
        };
      },
    ),
    slippageBps: number(data.slippageBps, "slippage basis points", 0, 500),
    quote: async () => {
      need(cursor < quotes.length, "saved canonical quote is missing");
      return quotes[cursor++];
    },
    ...(tradeRows.length ? { trades: trades(tradeRows[0].trades) } : {}),
    ...(data.listings === null ? {} : { listings: listings(data.listings) }),
    ...(data.lottery === null
      ? {}
      : {
          lottery: (() => {
            const value = fields(
              data.lottery,
              ["seed", "seedEvidence", "authority"],
              ["evidenceJson"],
              "lottery observation",
            );
            hash(value.seed, "lottery seed");
            hash(value.seedEvidence, "lottery evidence");
            address(value.authority, "lottery authority");
            evidencePreimage(value, "seedEvidence", "lottery");
            return value as ProProgramExecutionInput["lottery"];
          })(),
        }),
  };
  const plan = await planVerifiedProProgramCycle(launch, input);
  need(
    cursor === quotes.length,
    "saved quote observations were not consumed exactly once",
  );
  need(
    plan.cycle &&
      plan.evidenceJson === evidenceJson &&
      plan.cycle.evidence === expectedEvidence.toLowerCase() &&
      // The planner lowercases addresses; the original cycle above went through the SDK validator, which checksums
      // them. Compare both in the SDK's canonical form, or any payout address with a hex letter fails replay.
      proProgramEvidenceJson(validateProFeeProgramCycle(plan.cycle)) ===
        proProgramEvidenceJson(originalCycle),
    "re-derived actions, allocations or public evidence differ from the original commitment",
  );
  return plan;
}
