import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { contracts } from "./configuration";
import {
  PRO_BOOTSTRAP_COMPONENT_ARTIFACTS,
  PRO_BOOTSTRAP_MAX_REVIEWED_QUOTES,
  PRO_BOOTSTRAP_SOURCE_SCHEMA,
  proBootstrapComponentArtifact,
  readProBootstrapInfrastructure,
  type ProBootstrapComponent,
  type ProBootstrapSourceManifest,
  type ProBootstrapReviewedQuote,
} from "./vendor/xoox-sdk/pro-bootstrap";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  http,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

const read = promisify(readFile);
export const PRO_CONSENT_INDEXER_SOURCE_SCHEMA =
  "xoox.pro-token.indexer-consent-sources" as const;
const MAX_CONFIG_BYTES = 1024 * 1024;
const ZERO_HASH = `0x${"00".repeat(32)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Pro consent source: ${message}`);
}
function record(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  ensure(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    `${label} must be a plain object.`,
  );
  const own = Reflect.ownKeys(value);
  ensure(
    own.length === keys.length &&
      own.every(
        (key) =>
          typeof key === "string" &&
          keys.includes(key) &&
          "value" in Object.getOwnPropertyDescriptor(value, key)!,
      ),
    `${label} has unknown, missing or accessor fields.`,
  );
  return value as Record<string, unknown>;
}
function address(value: unknown): Address {
  ensure(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      !same(value, zeroAddress),
    "nonzero address required.",
  );
  return getAddress(value);
}
function hash(value: unknown): Hex {
  ensure(
    typeof value === "string" &&
      /^0x[\da-fA-F]{64}$/.test(value) &&
      !same(value, ZERO_HASH),
    "nonzero bytes32 required.",
  );
  return value.toLowerCase() as Hex;
}
function uint(value: unknown, label: string): bigint {
  ensure(
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value),
    `${label} must be a canonical decimal string.`,
  );
  const result = BigInt(value);
  ensure(result >= 0n && result < 1n << 256n, `${label} is out of range.`);
  return result;
}
export type ProConsentIndexerSource = Readonly<{
  chainId: bigint;
  factory: Address;
  helper: Address;
  registry: Address;
  bootstrapManifest: ProBootstrapSourceManifest;
}>;

/** Trusted operator review input. This parser does not discover source hashes from RPC. */
export function parseProConsentIndexerSources(
  raw: unknown,
): readonly ProConsentIndexerSource[] {
  const root = record(
    raw,
    ["schema", "version", "sources"],
    "source configuration",
  );
  ensure(
    root.schema === PRO_CONSENT_INDEXER_SOURCE_SCHEMA && root.version === 1,
    "unsupported source configuration schema/version.",
  );
  ensure(
    Array.isArray(root.sources) &&
      root.sources.length > 0 &&
      root.sources.length <= 32,
    "one to 32 reviewed sources required.",
  );
  const used = new Map<string, Readonly<{ role: ProBootstrapComponent; artifact: string; runtimeCodeHash: Hex; price: boolean; reactive: boolean; peak: boolean }>>();
  const quoteAddresses = new Set<string>();
  return Object.freeze(
    root.sources.map((entry) => {
      const item = record(
        entry,
        ["chainId", "factory", "helper", "registry", "bootstrapManifest"],
        "reviewed source",
      );
      const chainId = uint(item.chainId, "chain ID");
      ensure(
        chainId > 0n && chainId <= BigInt(Number.MAX_SAFE_INTEGER),
        "chain ID is unsafe.",
      );
      const factory = address(item.factory),
        helper = address(item.helper),
        registry = address(item.registry);
      const rawManifest = item.bootstrapManifest;
      const hasQuotes = !!rawManifest && typeof rawManifest === "object" && Object.hasOwn(rawManifest, "quotes");
      const manifest = record(
        rawManifest,
        [
          "schema",
          "version",
          "reviewId",
          "chainId",
          "factory",
          "configuration",
          "artifacts",
          ...(hasQuotes ? ["quotes"] : []),
        ],
        "bootstrap manifest",
      );
      ensure(
        manifest.schema === PRO_BOOTSTRAP_SOURCE_SCHEMA &&
          manifest.version === 3 &&
          typeof manifest.reviewId === "string" &&
          manifest.reviewId.trim() === manifest.reviewId &&
          manifest.reviewId.length > 0 &&
          manifest.reviewId.length <= 256 &&
          uint(manifest.chainId, "manifest chain ID") === chainId &&
          same(address(manifest.factory), factory),
        "reviewed Bootstrap v3 identity required.",
      );
      const flags = record(
        manifest.configuration,
        ["price", "reactive", "peak"],
        "configuration flags",
      );
      ensure(
        Object.values(flags).every((value) => typeof value === "boolean") &&
          flags.reactive === true,
        "configured Reactive source required.",
      );
      const optional: Partial<Record<ProBootstrapComponent, boolean>> = {
        slidingDeployer: flags.price as boolean,
        priceOracle: flags.price as boolean,
        reactiveDeployer: true,
        linkRegistry: true,
        reactiveValidationChild: true,
        peakDeployer: flags.peak as boolean,
        peakRegistry: flags.peak as boolean,
        beaconDeployer: flags.peak as boolean,
        entangledDeployer: flags.peak as boolean,
      };
      const names = (
        Object.keys(
          PRO_BOOTSTRAP_COMPONENT_ARTIFACTS,
        ) as ProBootstrapComponent[]
      ).filter((name) => optional[name] ?? true);
      const artifacts = record(manifest.artifacts, names, "reviewed artifacts");
      const normalized = Object.fromEntries(
        names.map((name) => {
          const value = record(
            artifacts[name],
            ["artifact", "address", "runtimeCodeHash"],
            `artifact ${name}`,
          );
          ensure(
            value.artifact === proBootstrapComponentArtifact(name, 3),
            `wrong ${name} source artifact.`,
          );
          return [
            name,
            Object.freeze({
              artifact: value.artifact,
              address: address(value.address),
              runtimeCodeHash: hash(value.runtimeCodeHash),
            }),
          ];
        }),
      ) as ProBootstrapSourceManifest["artifacts"];
      ensure(
        new Set(names.map((name) => normalized[name]!.address.toLowerCase()))
          .size === names.length,
        "source component addresses overlap.",
      );
      ensure(
        same(normalized.factory!.address, factory) &&
          same(normalized.reactiveDeployer!.address, helper) &&
          same(normalized.linkRegistry!.address, registry),
        "configured Factory/helper/Registry differs from reviewed artifacts.",
      );
      for (const role of names) {
        const component = normalized[role]!;
        const target = component.address;
        const key = `${chainId}:${target.toLowerCase()}`;
        const prior = used.get(key);
        const sharedPriceOracle = role === "priceOracle" && prior?.role === "priceOracle" && prior.artifact === component.artifact && same(prior.runtimeCodeHash, component.runtimeCodeHash) && prior.price === flags.price && prior.reactive === flags.reactive && prior.peak === flags.peak;
        ensure(!quoteAddresses.has(key) && (!prior || sharedPriceOracle), `duplicate or cross-Factory ${role} source.`);
        used.set(key, { role, artifact: component.artifact, runtimeCodeHash: component.runtimeCodeHash, price: flags.price as boolean, reactive: flags.reactive as boolean, peak: flags.peak as boolean });
      }
      let quotes: readonly ProBootstrapReviewedQuote[] | undefined;
      if (hasQuotes) {
        const rawQuotes = manifest.quotes;
        ensure(Array.isArray(rawQuotes) && Object.getPrototypeOf(rawQuotes) === Array.prototype && rawQuotes.length <= PRO_BOOTSTRAP_MAX_REVIEWED_QUOTES, "reviewed quotes must be a bounded plain array.");
        const descriptors = Object.getOwnPropertyDescriptors(rawQuotes);
        ensure(Reflect.ownKeys(rawQuotes).length === rawQuotes.length + 1 && Array.from({ length: rawQuotes.length }, (_, index) => descriptors[index]).every((descriptor) => !!descriptor && "value" in descriptor), "reviewed quotes have sparse, unknown or accessor entries.");
        quotes = Object.freeze(Array.from({ length: rawQuotes.length }, (_, index) => {
          const entry = record(descriptors[index]!.value, ["address", "runtimeCodeHash"], `reviewed quote ${index}`);
          return Object.freeze({ address: address(entry.address), runtimeCodeHash: hash(entry.runtimeCodeHash) });
        }));
        const distinct = new Set(quotes.map((quote) => quote.address.toLowerCase()));
        ensure(distinct.size === quotes.length && quotes.every((quote) => !used.has(`${chainId}:${quote.address.toLowerCase()}`)), "reviewed quotes duplicate or overlap a source role.");
        for (const quote of quotes) quoteAddresses.add(`${chainId}:${quote.address.toLowerCase()}`);
      }
      return Object.freeze({
        chainId,
        factory,
        helper,
        registry,
        bootstrapManifest: Object.freeze({
          schema: PRO_BOOTSTRAP_SOURCE_SCHEMA,
          version: 3,
          reviewId: manifest.reviewId as string,
          chainId,
          factory,
          configuration: Object.freeze({
            price: flags.price as boolean,
            reactive: true,
            peak: flags.peak as boolean,
          }),
          artifacts: Object.freeze(normalized),
          ...(quotes ? { quotes } : {}),
        }),
      });
    }),
  );
}

export const proConsentIndexerAbi = parseAbi([
  "function participant(bytes32 id) view returns((address creator,address token,bytes32 configurationHash,uint8 role,uint256 nonce,bytes32 partnerId,bytes32 finalPairId,bool finalized))",
  "function finalPair(bytes32 id) view returns((bytes32 participantId0,bytes32 participantId1,address token0,address token1,bytes32 configurationHash0,bytes32 configurationHash1,address creator0,address creator1))",
  "function participantOfToken(address token) view returns(bytes32)",
  "function linkOfToken(address token) view returns(bytes32)",
  "function finalPairIdOfParticipant(bytes32 id) view returns(bytes32)",
  "function deriveFinalPairId(bytes32 id0,bytes32 id1) view returns(bytes32)",
  "function curveOf(address token) view returns(address)",
  "function policyOf(address token) view returns(address)",
  "function creatorOf(address token) view returns(address)",
  "function configurationHash(address token) view returns(bytes32)",
  "function ruleData(uint8 rule) view returns(bytes)",
]);
export type ProConsentParticipantState = Readonly<{
  id: string;
  creator: string;
  token: string;
  configurationHash: string;
  role: number;
  nonce: bigint;
  partnerId: string;
  finalPairId: string;
  finalized: boolean;
}>;
export type ProConsentPairState = Readonly<{
  id: string;
  participantId0: string;
  participantId1: string;
  token0: string;
  token1: string;
  configurationHash0: string;
  configurationHash1: string;
  creator0: string;
  creator1: string;
}>;
export type ProConsentSourceInput = Readonly<{
  registry: string;
  blockNumber: bigint;
  blockHash: string;
  timestamp: bigint;
  participantIds: readonly string[];
}>;

/** Genuine reviewed source at the event block. Later same-block nonce/finalization
 * may be visible; handlers retain each event's historical facts separately. */
export async function readProConsentSource(
  client: PublicClient,
  chainId: number,
  trusted: ProConsentIndexerSource,
  input: ProConsentSourceInput,
) {
  const source = structuredClone(trusted);
  const captured = Object.freeze({
    registry: address(input.registry),
    blockNumber: input.blockNumber,
    blockHash: hash(input.blockHash),
    timestamp: input.timestamp,
    participantIds: Object.freeze(input.participantIds.map(hash)),
  });
  ensure(
    Number.isSafeInteger(chainId) &&
      chainId > 0 &&
      BigInt(chainId) === source.chainId &&
      same(captured.registry, source.registry) &&
      typeof captured.blockNumber === "bigint" &&
      captured.blockNumber >= 0n &&
      typeof captured.timestamp === "bigint" &&
      captured.timestamp >= 0n &&
      captured.participantIds.length >= 1 &&
      captured.participantIds.length <= 2 &&
      new Set(captured.participantIds).size === captured.participantIds.length,
    "event source/snapshot is invalid.",
  );
  const canonical = async () => {
    const [block, currentChain] = await Promise.all([
      client.getBlock({ blockNumber: captured.blockNumber }),
      client.getChainId(),
    ]);
    ensure(
      currentChain === chainId &&
        block.number === captured.blockNumber &&
        !!block.hash &&
        same(block.hash, captured.blockHash) &&
        block.timestamp === captured.timestamp,
      "event block/chain is no longer canonical.",
    );
  };
  await canonical();
  const bootstrap = await readProBootstrapInfrastructure(
    client,
    source.factory,
    source.bootstrapManifest,
    {
      chainId: source.chainId,
      blockNumber: captured.blockNumber,
      blockHash: captured.blockHash,
      blockTimestamp: captured.timestamp,
    },
  );
  ensure(
    bootstrap.sourceReview.version === 3 &&
      bootstrap.reactiveConsentProfile === "pending-participant-v2" &&
      same(bootstrap.components.reactiveDeployer!.address, source.helper) &&
      same(bootstrap.components.linkRegistry!.address, source.registry),
    "genuine participant-consent source is unavailable.",
  );
  const selector = {
    blockHash: captured.blockHash,
    requireCanonical: true,
  } as const;
  async function getter(
    target: Address,
    functionName: (typeof proConsentIndexerAbi)[number]["name"],
    args: readonly unknown[],
  ) {
    const data = encodeFunctionData({
      abi: proConsentIndexerAbi,
      functionName,
      args,
    } as never);
    const raw = (await client.request({
      method: "eth_call",
      params: [{ to: target, data }, selector],
    } as never)) as Hex;
    const value = decodeFunctionResult({
      abi: proConsentIndexerAbi,
      functionName,
      data: raw,
    });
    ensure(
      typeof raw === "string" &&
        same(
          raw,
          encodeFunctionResult({
            abi: proConsentIndexerAbi,
            functionName,
            result: value,
          } as never),
        ),
      "noncanonical participant getter bytes.",
    );
    return value;
  }
  const participants: ProConsentParticipantState[] = [];
  const pairs = new Map<string, ProConsentPairState>();
  for (const id of captured.participantIds) {
    const value = (await getter(source.registry, "participant", [id])) as Omit<
      ProConsentParticipantState,
      "id"
    >;
    const creator = address(value.creator),
      token = address(value.token),
      configurationHash = hash(value.configurationHash);
    ensure(
      value.role === 0 || value.role === 1,
      "participant role is invalid.",
    );
    const [
      curve,
      policy,
      actualCreator,
      actualConfiguration,
      ownId,
      linkedId,
      pairId,
    ] = await Promise.all([
      getter(source.factory, "curveOf", [token]),
      getter(source.factory, "policyOf", [token]),
      getter(source.factory, "creatorOf", [token]),
      getter(source.factory, "configurationHash", [token]),
      getter(source.registry, "participantOfToken", [token]),
      getter(source.registry, "linkOfToken", [token]),
      getter(source.registry, "finalPairIdOfParticipant", [id]),
    ]);
    const curveAddress = address(curve);
    const policyAddress = address(policy);
    ensure(
      new Set(
        [token, curveAddress, policyAddress].map((value) =>
          value.toLowerCase(),
        ),
      ).size === 3 &&
        [token, curveAddress, policyAddress].every((target) =>
          Object.values(bootstrap.components).every(
            (component) => !same(component.address, target),
          ),
        ),
      "participant products overlap reviewed infrastructure.",
    );
    ensure(
      same(address(actualCreator), creator) &&
        same(hash(actualConfiguration), configurationHash) &&
        same(ownId as string, id) &&
        same(pairId as string, value.finalPairId),
      "participant identity/configuration maps differ.",
    );
    const data = (await getter(policyAddress, "ruleData", [20])) as Hex;
    ensure(
      /^0x[\da-fA-F]{256}$/.test(data),
      "participant rule payload is invalid.",
    );
    const words = [0, 1, 2, 3].map((i) =>
      BigInt(`0x${data.slice(2 + 64 * i, 66 + 64 * i)}`),
    );
    ensure(
      words[0] === BigInt(id) &&
        words[1] === BigInt(value.role) &&
        words[2]! > 0n &&
        words[2]! <= 1_000_000n &&
        words[3]! <= 1_000_000n,
      "immutable participant rule differs.",
    );
    if (!value.finalized) {
      ensure(
        same(value.partnerId, ZERO_HASH) &&
          same(value.finalPairId, ZERO_HASH) &&
          same(linkedId as string, ZERO_HASH),
        "pending participant has a relationship.",
      );
    } else {
      const otherId = hash(value.partnerId),
        finalId = hash(value.finalPairId);
      ensure(
        !same(otherId, id) && same(linkedId as string, id),
        "finalized participant mapping differs.",
      );
      const pair = (await getter(source.registry, "finalPair", [
        finalId,
      ])) as Omit<ProConsentPairState, "id">;
      const [opposite, derived] = await Promise.all([
        getter(source.registry, "participant", [otherId]),
        getter(source.registry, "deriveFinalPairId", [
          pair.participantId0,
          pair.participantId1,
        ]),
      ]);
      const partner = opposite as Omit<ProConsentParticipantState, "id">;
      const role = value.role;
      ensure(
        same(derived as string, finalId) &&
          same(role === 0 ? pair.participantId0 : pair.participantId1, id) &&
          same(
            role === 0 ? pair.participantId1 : pair.participantId0,
            otherId,
          ) &&
          same(role === 0 ? pair.token0 : pair.token1, token) &&
          same(
            role === 0 ? pair.configurationHash0 : pair.configurationHash1,
            configurationHash,
          ) &&
          same(role === 0 ? pair.creator0 : pair.creator1, creator) &&
          partner.finalized &&
          partner.role === 1 - role &&
          !same(partner.token, token) &&
          same(partner.partnerId, id) &&
          same(partner.finalPairId, finalId) &&
          same(
            role === 0 ? pair.token1 : pair.token0,
            address(partner.token),
          ) &&
          same(
            role === 0 ? pair.configurationHash1 : pair.configurationHash0,
            hash(partner.configurationHash),
          ) &&
          same(
            role === 0 ? pair.creator1 : pair.creator0,
            address(partner.creator),
          ),
        "reciprocal participant/pair state differs.",
      );
      pairs.set(finalId, Object.freeze({ ...pair, id: finalId }));
    }
    participants.push(
      Object.freeze({
        ...value,
        id,
        token: token.toLowerCase(),
        creator: creator.toLowerCase(),
        configurationHash,
        partnerId: value.partnerId.toLowerCase(),
        finalPairId: value.finalPairId.toLowerCase(),
      }),
    );
  }
  await canonical();
  return Object.freeze({
    factory: source.factory.toLowerCase(),
    helper: source.helper.toLowerCase(),
    registry: source.registry.toLowerCase(),
    reviewId: bootstrap.sourceReview.reviewId,
    participants: Object.freeze(participants),
    pairs: Object.freeze([...pairs.values()]),
  });
}

function configuredProContracts(names: readonly string[]): boolean[] {
  const bytes = readFileSync(
    resolve(process.env.ENVIO_CONFIG ?? "config.yaml"),
  );
  ensure(
    bytes.length <= MAX_CONFIG_BYTES,
    "operator configuration is oversized.",
  );
  const config = JSON.parse(bytes.toString("utf8")) as {
    contracts?: { name?: string; events?: { event?: string }[] }[];
    chains?: { contracts?: { name?: string }[] }[];
  };
  return names.map((name) => {
    const declared =
      config.contracts?.filter((item) => item.name === name) ?? [];
    const known = contracts.find((item) => item.name === name)!;
    ensure(
      declared.length <= 1 &&
        (declared.length === 0 ||
          JSON.stringify(declared[0]) === JSON.stringify(known)),
      `${name} ABI declaration is duplicate or differs.`,
    );
    return (
      declared.length === 1 &&
      Boolean(
        config.chains?.some((chain) =>
          chain.contracts?.some((item) => item.name === name),
        ),
      )
    );
  });
}
/** Legacy-only active configurations keep all absent Pro handlers unregistered. */
export function proStandardIndexerContractsConfigured(): boolean {
  const flags = configuredProContracts([
    "ProFactory",
    "ProCurve",
    "ProPolicy",
    "ProGraduationRegistry",
    "ProSwapRouter",
  ]);
  ensure(
    flags.every(Boolean) || flags.every((value) => !value),
    "ordinary Pro ABI roles are only partially configured.",
  );
  return flags.every(Boolean);
}
/** Static consent opt-in still requires the private reviewed source effect. */
export function proConsentContractConfigured(): boolean {
  return configuredProContracts(["ProConsentRegistry"])[0]!;
}

/** Optional additive holder role; existing configurations remain valid. */
export function proHolderContractConfigured(): boolean {
  return configuredProContracts(["ProToken"])[0]!;
}

/** Explicit static subscriptions and a private reviewed manifest are both mandatory. */
export async function loadProConsentSource(
  chainId: number,
  input: ProConsentSourceInput,
  createClient: (rpc: string) => PublicClient = (rpc) =>
    createPublicClient({
      transport: http(rpc, { timeout: 20_000, retryCount: 2 }),
    }),
) {
  const sourcePath = process.env.XOOX_PRO_CONSENT_SOURCES_PATH;
  const configPath = resolve(process.env.ENVIO_CONFIG ?? "config.yaml");
  const captured = Object.freeze({
    registry: address(input.registry),
    blockNumber: input.blockNumber,
    blockHash: hash(input.blockHash),
    timestamp: input.timestamp,
    participantIds: Object.freeze(input.participantIds.map(hash)),
  });
  ensure(
    typeof sourcePath === "string" &&
      sourcePath.length > 0 &&
      sourcePath === resolve(sourcePath),
    "explicit absolute reviewed source path is unavailable.",
  );
  const [sourceBytes, configBytes] = await Promise.all([
    read(sourcePath),
    read(configPath),
  ]);
  ensure(
    sourceBytes.length <= MAX_CONFIG_BYTES &&
      configBytes.length <= MAX_CONFIG_BYTES,
    "operator configuration is oversized.",
  );
  const sources = parseProConsentIndexerSources(
    JSON.parse(sourceBytes.toString("utf8")),
  );
  const matches = sources.filter(
    (item) =>
      item.chainId === BigInt(chainId) &&
      same(item.registry, captured.registry),
  );
  ensure(matches.length === 1, "reviewed source is missing or ambiguous.");
  const source = matches[0]!;
  const config = JSON.parse(configBytes.toString("utf8")) as {
    chains?: {
      id?: number;
      rpc?: { url?: string }[];
      contracts?: { name?: string; address?: string[] }[];
    }[];
  };
  const chains = config.chains?.filter((chain) => chain.id === chainId);
  ensure(chains?.length === 1, "operator chain is missing or ambiguous.");
  const chain = chains[0]!;
  for (const [name, target] of [
    ["ProFactory", source.factory],
    ["ProConsentRegistry", source.registry],
  ] as const) {
    const entries = chain.contracts?.filter((item) => item.name === name);
    ensure(
      entries?.length === 1 &&
        Array.isArray(entries[0]?.address) &&
        entries[0]!.address!.some(
          (value) => typeof value === "string" && same(value, target),
        ),
      "consent source is not explicitly subscribed.",
    );
  }
  const rpc = chain.rpc?.[0]?.url;
  ensure(
    typeof rpc === "string" && /^(https?:\/\/)/.test(rpc),
    "configured archive-capable RPC is unavailable.",
  );
  return readProConsentSource(createClient(rpc), chainId, source, captured);
}
