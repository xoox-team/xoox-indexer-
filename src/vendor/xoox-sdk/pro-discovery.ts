// Vendored from the XOOX SDK; only what the indexer uses.
import {
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  canAggregateProCanonicalGetters,
  readProCanonicalGetterBatch,
  assertProBootstrapProof,
  assertProBootstrapReadScope,
  assertProBootstrapProofInScope,
  proBootstrapManifestFromProof,
  readProBootstrapInfrastructure,
  type ProBootstrapProof,
  type ProBootstrapSnapshotSelector,
  type ProBootstrapSourceManifest,
  type ProBootstrapReadScope,
} from "./pro-bootstrap";

export const proDiscoveryAbi = parseAbi([
  "function launchCount() view returns(uint256)",
  "function launchTokenAt(uint256 index) view returns(address)",
  "function curveOf(address token) view returns(address)",
  "function policyOf(address token) view returns(address)",
  "function creatorOf(address token) view returns(address)",
  "function configurationHash(address token) view returns(bytes32)",
  "function supplyOf(address token) view returns(uint256)",
  "function tokenOf(address curve) view returns(address)",
  "function isCurve(address curve) view returns(bool)",
  "function isSystemAddress(address account) view returns(bool)",
  "function factory() view returns(address)",
  "function partnerRegistry() view returns(address)",
  "function router() view returns(address)",
  "function token() view returns(address)",
  "function curve() view returns(address)",
  "function policy() view returns(address)",
  "function creator() view returns(address)",
  "function supply() view returns(uint256)",
  "function totalSupply() view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function rulesBitmap() view returns(uint256)",
  "function perpetual() view returns(bool)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function description() view returns(string)",
  "function image() view returns(string)",
  "function website() view returns(string)",
  "function twitter() view returns(string)",
  "function telegram() view returns(string)",
  "function feeProgramVersion() view returns(uint256)",
  "function genesisSupply() view returns(uint256)",
  "function cumulativeBurned() view returns(uint256)",
  "function programVault() view returns(address)",
  "function programVaultOf(address token) view returns(address)",
  "function isDeployedCurve(address curve) view returns(bool)",
]);
export type ProDiscoveryMetadata = Readonly<{
  name: string;
  symbol: string;
  description: string;
  image: string;
  website: string;
  twitter: string;
  telegram: string;
}>;
export type ProDiscoveryToken = Readonly<{
  schema: "xoox.pro-token.registered";
  version: 1;
  factory: Address;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  bootstrapInfrastructure: ProBootstrapProof;
  token: Address;
  curve: Address;
  policy: Address;
  creator: Address;
  configurationHash: Hex;
  supply: bigint;
  rulesBitmap: bigint;
  perpetual: boolean;
  metadata: ProDiscoveryMetadata;
  programSource?: Readonly<{
    version: 4;
    genesisSupply: bigint;
    actualSupply: bigint;
    cumulativeBurned: bigint;
    vault: Address;
  }>;
}>;
export type ProDiscoveryPage = Readonly<{
  schema: "xoox.pro-token.discovery";
  version: 1;
  factory: Address;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  blockTimestamp: bigint;
  bootstrapInfrastructure: ProBootstrapProof;
  totalCount: bigint;
  offset: bigint;
  pageSize: number;
  nextOffset?: bigint;
  items: readonly ProDiscoveryToken[];
}>;
export type ProDiscoveryOptions = Readonly<{
  offset?: bigint;
  pageSize?: number;
  snapshot?: ProBootstrapSnapshotSelector;
}>;
const issued = new WeakSet<object>();
const scopedTokens = new WeakMap<ProBootstrapReadScope, Map<ProBootstrapProof, Map<Address, ProDiscoveryToken>>>();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function require_(condition: boolean, label: string): asserts condition {
  if (!condition) throw new Error("Pro discovery " + label + ".");
}
function address(value: unknown, label: string): Address {
  require_(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      !same(value, zeroAddress),
    label + " must be a nonzero address",
  );
  return getAddress(value);
}
function uint(value: unknown, label: string): bigint {
  require_(
    typeof value === "bigint" && value >= 0n && value < 1n << 256n,
    label + " must be a uint256",
  );
  return value;
}
function readAt(client: PublicClient, proof: ProBootstrapProof) {
  return async (
    target: Address,
    functionName: (typeof proDiscoveryAbi)[number]["name"],
    args?: readonly (Address | bigint)[],
  ) => {
    const data = encodeFunctionData({
      abi: proDiscoveryAbi,
      functionName,
      ...(args ? { args } : {}),
    } as never);
    const raw = (await client.request({
      method: "eth_call",
      params: [
        { to: target, data },
        { blockHash: proof.blockHash, requireCanonical: true },
      ],
    } as never)) as Hex;
    const value = decodeFunctionResult({
      abi: proDiscoveryAbi,
      functionName,
      data: raw,
    });
    const canonical = encodeFunctionResult({
      abi: proDiscoveryAbi,
      functionName,
      result: value,
    } as never);
    require_(
      same(raw, canonical),
      functionName + " returned noncanonical ABI bytes",
    );
    return value;
  };
}
async function registered(
  client: PublicClient,
  proof: ProBootstrapProof,
  selected: Address,
): Promise<ProDiscoveryToken> {
  const token = address(selected, "token");
  const factory = proof.factory,
    partner = proof.partnerRegistry;
  const read = readAt(client, proof);
  const aggregate = proof.sourceReview.version === 3 && canAggregateProCanonicalGetters(client, factory, proof.blockHash);
  const group = (calls: readonly (readonly [Address, (typeof proDiscoveryAbi)[number]["name"], (readonly (Address | bigint)[])?])[]) => aggregate
    ? readProCanonicalGetterBatch(client, proof.blockHash, calls.map(([address, functionName, args]) => ({ address, abi: proDiscoveryAbi, functionName, ...(args ? { args } : {}) })))
    : Promise.all(calls.map(([target, name, args]) => read(target, name, args)));
  // The reviewed Factory public mappings have explicit keys and no caller dependency.
  const [c, p, owner, configuration] = await group([
    [factory, "curveOf", [token]], [factory, "policyOf", [token]],
    [factory, "creatorOf", [token]], [factory, "configurationHash", [token]],
  ]);
  const curve = address(c, "Curve"),
    policy = address(p, "Policy"),
    creator = address(owner, "creator");
  require_(
    typeof configuration === "string" &&
      /^0x[\da-fA-F]{64}$/.test(configuration) &&
      !/^0x0{64}$/.test(configuration),
    "configuration hash is missing",
  );
  const systems = new Set(
    Object.values(proof.components).map((v) => v.address.toLowerCase()),
  );
  require_(
    new Set([token, curve, policy, creator].map((v) => v.toLowerCase()))
      .size === 4 &&
      [token, curve, policy, creator].every(
        (v) => !systems.has(v.toLowerCase()),
      ),
    "launch identities collide with each other or infrastructure",
  );
  const codes = await Promise.all(
    [token, curve, policy].map((target) =>
      client.request({
        method: "eth_getCode",
        params: [
          target,
          { blockHash: proof.blockHash, requireCanonical: true },
        ],
      } as never),
    ),
  );
  require_(
    codes.every(
      (code) => typeof code === "string" && /^0x(?:[\da-fA-F]{2})+$/.test(code),
    ),
    "launch contract runtime is missing",
  );
  const supplyBinding = Symbol("registered supply");
  const bindings: readonly [
    target: Address,
    name: (typeof proDiscoveryAbi)[number]["name"],
    expected: unknown,
    args?: readonly Address[],
  ][] = [
    [factory, "isCurve", true, [curve]],
    [factory, "isSystemAddress", true, [token]],
    [factory, "isSystemAddress", true, [curve]],
    [factory, "isSystemAddress", true, [policy]],
    [token, "curve", curve],
    [token, "policy", policy],
    [partner, "curveOf", curve, [token]],
    [partner, "policyOf", policy, [token]],
    [partner, "creatorOf", creator, [token]],
    [partner, "configurationHash", configuration, [token]],
    [partner, "supplyOf", supplyBinding, [token]],
    [partner, "tokenOf", token, [curve]],
    [curve, "factory", factory],
    [curve, "partnerRegistry", partner],
    [curve, "router", proof.components.router.address],
    [curve, "token", token],
    [curve, "policy", policy],
    [curve, "creator", creator],
    [curve, "totalSupply", supplyBinding],
    [policy, "factory", factory],
    [policy, "token", token],
    [policy, "curve", curve],
    [policy, "creator", creator],
    [policy, "supply", supplyBinding],
  ];
  const fields = [
    "name", "symbol", "description", "image", "website", "twitter", "telegram",
  ] as const;
  const coreCalls = [
    [token, "totalSupply"], [policy, "rulesBitmap"],
    [curve, "perpetual"], [token, "decimals"],
  ] as const;
  const bindingCalls = bindings.map(([target, name, , args]) => [target, name, args] as const);
  const metadataCalls = fields.map(name => [token, name] as const);
  // All targets/arguments are known after registration and runtime checks. The
  // issued v3 getter lane bounds each group; validate every result before issue.
  // Other source families retain their original staged reads.
  const collected = aggregate
    ? await group([...coreCalls, ...bindingCalls, ...metadataCalls])
    : undefined;
  const [supplyValue, rulesValue, perpetual, decimals] = collected?.slice(0, coreCalls.length)
    ?? await group(coreCalls);
  const actualSupply = uint(supplyValue, "supply"),
    rulesBitmap = uint(rulesValue, "rules bitmap");
  const feeSource =
    proof.sourceReview.version === 4 && proof.programSource?.version === 4;
  let supply = actualSupply;
  let programSource: ProDiscoveryToken["programSource"];
  if (feeSource) {
    const [
      genesis,
      burned,
      version,
      vaultValue,
      mappedVault,
      curveVersion,
      genuineCurve,
    ] = await Promise.all([
      read(token, "genesisSupply"),
      read(token, "cumulativeBurned"),
      read(token, "feeProgramVersion"),
      read(token, "programVault"),
      read(proof.components.router.address, "programVaultOf", [token]),
      read(curve, "feeProgramVersion"),
      read(proof.components.curveDeployer.address, "isDeployedCurve", [curve]),
    ]);
    supply = uint(genesis, "genesis supply");
    const cumulativeBurned = uint(burned, "cumulative burns");
    const vault = address(vaultValue, "program Vault");
    require_(
      version === 4n &&
        typeof mappedVault === "string" &&
        same(vault, mappedVault),
      "fee program token/Vault source mismatch",
    );
    require_(
      curveVersion === 4n && genuineCurve === true,
      "fee program Curve source mismatch",
    );
    require_(
      actualSupply + cumulativeBurned === supply,
      "actual supply and recorded burns do not reconcile with genesis supply",
    );
    programSource = Object.freeze({
      version: 4,
      genesisSupply: supply,
      actualSupply,
      cumulativeBurned,
      vault,
    });
  }
  require_(
    supply > 0n &&
      (rulesBitmap > 0n || feeSource) &&
      rulesBitmap < 1n << 23n &&
      typeof perpetual === "boolean" &&
      decimals === 18,
    "supply, rules, mode or decimals are invalid",
  );
  const bindingValues = collected?.slice(coreCalls.length, coreCalls.length + bindings.length)
    ?? await group(bindingCalls);
  bindings.forEach(([, name, expectedValue], index) => {
      const expected = expectedValue === supplyBinding ? supply : expectedValue;
      const actual = bindingValues[index];
      require_(
        typeof expected === "string"
          ? typeof actual === "string" && same(actual, expected)
          : actual === expected,
        name + " registration/wiring mismatch",
      );
    });
  const limits = [128, 32, 4096, 2048, 2048, 2048, 2048];
  const metadataValues = collected?.slice(coreCalls.length + bindings.length)
    ?? await group(metadataCalls);
  metadataValues.forEach((v, i) =>
    require_(
      typeof v === "string" &&
        new TextEncoder().encode(v).length <= limits[i]! &&
        (![0, 1, 3].includes(i) || v.length > 0),
      "invalid " + fields[i] + " metadata",
    ),
  );
  return Object.freeze({
    schema: "xoox.pro-token.registered",
    version: 1,
    factory,
    chainId: proof.chainId,
    blockNumber: proof.blockNumber,
    blockHash: proof.blockHash,
    blockTimestamp: proof.blockTimestamp,
    bootstrapInfrastructure: proof,
    token,
    curve,
    policy,
    creator,
    configurationHash: configuration.toLowerCase() as Hex,
    supply,
    rulesBitmap,
    perpetual,
    metadata: Object.freeze(
      Object.fromEntries(
        fields.map((field, i) => [field, metadataValues[i]]),
      ) as ProDiscoveryMetadata,
    ),
    ...(programSource ? { programSource } : {}),
  });
}
/** Internal single-acquisition handle. Not exported by the SDK package index;
 * no provisional registered token or financial proof is returned to callers. */
export type ProInitialRegistrationContext = Readonly<{ schema: "xoox.pro.initial-registration" }>;
type InitialRegistrationState = {
  client: PublicClient;
  scope: ProBootstrapReadScope;
  bootstrap: ProBootstrapProof;
  token: Address;
  account: Address | undefined;
  identity: ProDiscoveryToken;
  signal?: AbortSignal;
  consumed: boolean;
};
const initialRegistrations = new WeakMap<ProInitialRegistrationContext, InitialRegistrationState>();

export async function beginProInitialRegistration(
  client: PublicClient,
  bootstrap: ProBootstrapProof,
  token: Address,
  scope: ProBootstrapReadScope,
  manifest: ProBootstrapSourceManifest,
  account?: Address,
  signal?: AbortSignal,
): Promise<ProInitialRegistrationContext> {
  signal?.throwIfAborted();
  assertProBootstrapProofInScope(client, scope, bootstrap, manifest);
  require_(bootstrap.sourceReview.version === 3, "Initial compound registration requires ordinary source3.");
  const target = address(token, "Token"), selectedAccount = account === undefined ? undefined : address(account, "Account");
  const identity = await registered(client, bootstrap, target);
  signal?.throwIfAborted();
  assertProBootstrapProofInScope(client, scope, bootstrap, manifest);
  const context = Object.freeze({ schema: "xoox.pro.initial-registration" as const });
  initialRegistrations.set(context, { client, scope, bootstrap, token: target, account: selectedAccount, identity, signal, consumed: false });
  return context;
}
function initialRegistrationState(context: ProInitialRegistrationContext): InitialRegistrationState {
  const state = initialRegistrations.get(context);
  require_(!!state && !state.consumed, "Initial registration context is foreign, consumed or closed.");
  state.signal?.throwIfAborted();
  return state;
}
/** Only an actually validated registration can choose the existing Peak path. */
export function initialRegistrationHasPeak(context: ProInitialRegistrationContext): boolean {
  const state = initialRegistrationState(context);
  return (state.identity.rulesBitmap & ((1n << 21n) | (1n << 22n))) !== 0n;
}
export function consumeProInitialRegistration(
  context: ProInitialRegistrationContext,
  client: PublicClient,
  scope: ProBootstrapReadScope,
  bootstrap: ProBootstrapProof,
  manifest: ProBootstrapSourceManifest,
  token: Address,
  account?: Address,
): ProDiscoveryToken {
  const state = initialRegistrationState(context);
  assertProBootstrapProofInScope(client, scope, bootstrap, manifest);
  require_(state.client === client && state.scope === scope && state.bootstrap === bootstrap &&
    state.token === address(token, "Token") && state.account === (account === undefined ? undefined : address(account, "Account")),
    "Initial registration context belongs to another client/source/token/account.");
  require_(!initialRegistrationHasPeak(context), "Peak tokens require the standalone registration and launch readers.");
  state.consumed = true;
  // This identity is deliberately absent from `issued` and scopedTokens.
  // Only the complete launch reader may issue its own final guarded result.
  return state.identity;
}
export function closeProInitialRegistration(context: ProInitialRegistrationContext): void {
  initialRegistrations.delete(context);
}
export function assertProInitialRegistrationLive(context: ProInitialRegistrationContext): void {
  const state = initialRegistrations.get(context);
  require_(!!state && state.consumed, "Initial registration context is not an active acquisition.");
  state.signal?.throwIfAborted();
}
async function finish(client: PublicClient, proof: ProBootstrapProof, scope?: ProBootstrapReadScope) {
  const after = await readProBootstrapInfrastructure(
    client,
    proof.factory,
    proBootstrapManifestFromProof(proof),
    proof,
    scope,
  );
  require_(
    after.supportedBitmap === proof.supportedBitmap &&
      after.owner === proof.owner &&
      after.routerAuthority === proof.routerAuthority,
    "source/configuration changed during the read",
  );
}
/** Proves registered launch metadata/wiring at the issued bootstrap snapshot; no LP or rule economic claim. */
export async function readProRegisteredToken(
  client: PublicClient,
  bootstrap: ProBootstrapProof,
  token: Address,
  readScope?: ProBootstrapReadScope,
): Promise<ProDiscoveryToken> {
  assertProBootstrapProof(bootstrap);
  if (readScope) assertProBootstrapReadScope(client, readScope);
  const target = address(token, "Token");
  const cached = readScope ? scopedTokens.get(readScope)?.get(bootstrap)?.get(target) : undefined;
  if (cached) {
    assertProDiscoveryToken(cached);
    await finish(client, bootstrap, readScope);
    return cached;
  }
  const result = await registered(client, bootstrap, token);
  await finish(client, bootstrap, readScope);
  issued.add(result);
  if (readScope) {
    let sources = scopedTokens.get(readScope);
    if (!sources) scopedTokens.set(readScope, sources = new Map());
    let tokens = sources.get(bootstrap);
    if (!tokens) {
      if (sources.size >= 8) throw new Error("Pro read scope exceeded its finite source bound.");
      sources.set(bootstrap, tokens = new Map());
    }
    if (tokens.size >= 24) throw new Error("Pro read scope exceeded its finite token bound.");
    tokens.set(target, result);
  }
  return result;
}
export function assertProDiscoveryToken(
  value: unknown,
): asserts value is ProDiscoveryToken {
  require_(
    !!value && typeof value === "object" && issued.has(value),
    "token must come from the canonical registered reader",
  );
}
/** Bounded newest-first Factory enumeration, independent of an indexer or connected wallet. */
export async function readProDiscoveryPage(
  client: PublicClient,
  factory: Address,
  manifest: ProBootstrapSourceManifest,
  options: ProDiscoveryOptions = {},
): Promise<ProDiscoveryPage> {
  const offset = uint(options.offset ?? 0n, "offset"),
    pageSize = options.pageSize ?? 12;
  require_(
    Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 24,
    "page size must be 1–24",
  );
  const snapshot = options.snapshot ? { ...options.snapshot } : undefined;
  const proof = await readProBootstrapInfrastructure(
    client,
    factory,
    manifest,
    snapshot,
  );
  const read = readAt(client, proof),
    totalCount = uint(await read(factory, "launchCount"), "launch count");
  const size =
    offset >= totalCount
      ? 0
      : Number(
          totalCount - offset < BigInt(pageSize)
            ? totalCount - offset
            : BigInt(pageSize),
        );
  const tokens = await Promise.all(
    Array.from({ length: size }, (_, i) =>
      read(factory, "launchTokenAt", [totalCount - offset - BigInt(i) - 1n]),
    ),
  );
  const addresses = tokens.map((t) => address(t, "enumerated token"));
  require_(
    new Set(addresses.map((t) => t.toLowerCase())).size === addresses.length,
    "Factory enumeration contains duplicate tokens",
  );
  const items: ProDiscoveryToken[] = [];
  // Each launch needs several reciprocal getters. Bound concurrent launches as
  // well as page length so a public RPC is not flooded by a whole page at once.
  for (let start = 0; start < addresses.length; start += 4)
    items.push(
      ...(await Promise.all(
        addresses
          .slice(start, start + 4)
          .map((t) => registered(client, proof, t)),
      )),
    );
  require_(
    (await read(factory, "launchCount")) === totalCount,
    "launch count changed at the pinned snapshot",
  );
  await finish(client, proof);
  items.forEach((item) => issued.add(item));
  return Object.freeze({
    schema: "xoox.pro-token.discovery",
    version: 1,
    factory: proof.factory,
    chainId: proof.chainId,
    blockNumber: proof.blockNumber,
    blockHash: proof.blockHash,
    blockTimestamp: proof.blockTimestamp,
    bootstrapInfrastructure: proof,
    totalCount,
    offset,
    pageSize,
    ...(offset + BigInt(size) < totalCount
      ? { nextOffset: offset + BigInt(size) }
      : {}),
    items: Object.freeze(items),
  });
}
