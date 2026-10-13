import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { proOpeningBuyAbi } from "./vendor/xoox-sdk/pro-opening-buy";
import {
  readProBootstrapInfrastructure,
  type ProBootstrapSourceManifest,
} from "./vendor/xoox-sdk/pro-bootstrap";
import { readProFeeProgramLaunch } from "./vendor/xoox-sdk/pro-fee-program-launch";
import {
  readProFeeProgramGraduationInfrastructure,
  type ProFeeProgramGraduationSourceManifest,
} from "./vendor/xoox-sdk/pro-fee-program-graduation";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  http,
  isAddress,
  keccak256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export type ProHolderSourceInput = Readonly<{
  factory: string;
  token: string;
  curve: string;
  policy: string;
  creator: string;
  configurationHash: string;
  supply: bigint;
  blockNumber: bigint;
  blockHash: string;
  timestamp: bigint;
  transactionHash: string;
  launchLogIndex: number;
}>;
export const proHolderSourceAbi = parseAbi([
  "function curveOf(address) view returns(address)",
  "function policyOf(address) view returns(address)",
  "function creatorOf(address) view returns(address)",
  "function configurationHash(address) view returns(bytes32)",
  "function curve() view returns(address)",
  "function policy() view returns(address)",
  "function totalSupply() view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function programVault() view returns(address)",
  "function genesisSupply() view returns(uint256)",
  "function cumulativeBurned() view returns(uint256)",
  "function feeProgramVersion() view returns(uint256)",
  "function factory() view returns(address)",
  "function token() view returns(address)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Pro holder source: ${message}`);
}
function address(value: unknown): Address {
  ensure(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      !same(value, zeroAddress),
    "nonzero identity required.",
  );
  return value.toLowerCase() as Address;
}
function hash(value: unknown): Hex {
  ensure(
    typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value),
    "canonical hash required.",
  );
  return value.toLowerCase() as Hex;
}

/** Reviewed infrastructure is mandatory, including explicit SDK profile 4 acceptance.
 * The reviewed TokenDeployer pins product creation code; Factory mappings, token
 * getters and the successful creation receipt then authenticate this product.
 */
export async function readProHolderSource(
  client: PublicClient,
  chainId: number,
  manifest: ProBootstrapSourceManifest,
  input: ProHolderSourceInput,
  graduationManifest?: ProFeeProgramGraduationSourceManifest,
) {
  const sourceVersion = manifest.version;
  ensure(
    !graduationManifest || sourceVersion === 4,
    "a legacy source cannot accept program graduation artifacts.",
  );
  const captured = Object.freeze({
    ...input,
    factory: address(input.factory),
    token: address(input.token),
    curve: address(input.curve),
    policy: address(input.policy),
    creator: address(input.creator),
    configurationHash: hash(input.configurationHash),
    blockHash: hash(input.blockHash),
    transactionHash: hash(input.transactionHash),
  });
  ensure(
    Number.isSafeInteger(chainId) &&
      chainId > 0 &&
      captured.supply > 0n &&
      captured.blockNumber >= 0n &&
      captured.timestamp >= 0n &&
      Number.isSafeInteger(captured.launchLogIndex) &&
      captured.launchLogIndex >= 0 &&
      manifest.chainId === BigInt(chainId) &&
      same(manifest.factory, captured.factory),
    "launch/source identity differs.",
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
      "launch block is no longer canonical.",
    );
  };
  await canonical();
  const bootstrap = await readProBootstrapInfrastructure(
    client,
    captured.factory,
    manifest,
    {
      chainId: BigInt(chainId),
      blockNumber: captured.blockNumber,
      blockHash: captured.blockHash,
      blockTimestamp: captured.timestamp,
    },
  );
  ensure(
    bootstrap.sourceReview.version === sourceVersion,
    "reviewed source profile changed.",
  );
  const selector = {
    blockHash: captured.blockHash,
    requireCanonical: true,
  } as const;
  const getter = async (
    target: Address,
    functionName: string,
    args: readonly unknown[] = [],
  ) => {
    const raw = (await client.request({
      method: "eth_call",
      params: [
        {
          to: target,
          data: encodeFunctionData({
            abi: proHolderSourceAbi,
            functionName,
            args,
          } as never),
        },
        selector,
      ],
    } as never)) as Hex;
    const value = decodeFunctionResult({
      abi: proHolderSourceAbi,
      functionName,
      data: raw,
    } as never);
    ensure(
      same(
        raw,
        encodeFunctionResult({
          abi: proHolderSourceAbi,
          functionName,
          result: value,
        } as never),
      ),
      "noncanonical getter bytes.",
    );
    return value;
  };
  const [
    curve,
    policy,
    creator,
    configurationHash,
    tokenCurve,
    tokenPolicy,
    actualSupply,
    decimals,
    code,
    receipt,
  ] = await Promise.all([
    getter(captured.factory, "curveOf", [captured.token]),
    getter(captured.factory, "policyOf", [captured.token]),
    getter(captured.factory, "creatorOf", [captured.token]),
    getter(captured.factory, "configurationHash", [captured.token]),
    getter(captured.token, "curve"),
    getter(captured.token, "policy"),
    getter(captured.token, "totalSupply"),
    getter(captured.token, "decimals"),
    client.request({
      method: "eth_getCode",
      params: [captured.token, selector],
    } as never),
    client.getTransactionReceipt({ hash: captured.transactionHash }),
  ]);
  ensure(
    same(address(curve), captured.curve) &&
      same(address(policy), captured.policy) &&
      same(address(creator), captured.creator) &&
      same(hash(configurationHash), captured.configurationHash) &&
      same(address(tokenCurve), captured.curve) &&
      same(address(tokenPolicy), captured.policy),
    "Factory/token launch binding differs.",
  );
  ensure(
    typeof code === "string" &&
      /^0x(?:[\da-fA-F]{2})+$/.test(code) &&
      decimals === 18 &&
      typeof actualSupply === "bigint",
    "token runtime/units unavailable.",
  );
  ensure(
    receipt.status === "success" &&
      receipt.blockNumber === captured.blockNumber &&
      same(receipt.blockHash, captured.blockHash) &&
      same(receipt.transactionHash, captured.transactionHash),
    "successful canonical launch receipt unavailable.",
  );
  const launchLog = receipt.logs.find(
    (log) => log.logIndex === captured.launchLogIndex,
  );
  ensure(
    launchLog && same(launchLog.address, captured.factory),
    "creation log is missing from its canonical receipt.",
  );
  const created = decodeEventLog({
    abi: proOpeningBuyAbi,
    data: launchLog.data,
    topics: launchLog.topics,
    strict: true,
  });
  ensure(
    created.eventName === "LaunchCreated" &&
      same(created.args.token, captured.token) &&
      same(created.args.curveAddress, captured.curve) &&
      same(created.args.policy, captured.policy) &&
      same(created.args.creator, captured.creator) &&
      same(created.args.configurationHash, captured.configurationHash) &&
      created.args.supply === captured.supply,
    "canonical creation receipt differs from accepted launch.",
  );
  const initial = receipt.logs
    .filter(
      (log) =>
        same(log.address, captured.token) &&
        log.logIndex < captured.launchLogIndex,
    )
    .map((log) => {
      try {
        const decoded = decodeEventLog({
          abi: proHolderSourceAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        return decoded.eventName === "Transfer"
          ? { ...decoded.args, logIndex: log.logIndex }
          : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((item) => item !== undefined);
  ensure(
    initial.length === 1 &&
      same(initial[0]!.from, zeroAddress) &&
      same(initial[0]!.to, captured.curve) &&
      initial[0]!.value === captured.supply,
    "exact constructor mint preceding launch is unavailable.",
  );
  const infrastructure = Object.values(bootstrap.components).map((component) =>
    component.address.toLowerCase(),
  );
  ensure(
    new Set([captured.token, captured.curve, captured.policy]).size === 3 &&
      [captured.token, captured.curve, captured.policy].every(
        (target) => !infrastructure.includes(target),
      ),
    "launch products overlap reviewed infrastructure.",
  );
  infrastructure.push(captured.policy);
  let programVault = "",
    cumulativeBurned = 0n;
  if (sourceVersion === 4) {
    const graduation = graduationManifest
      ? await readProFeeProgramGraduationInfrastructure(
          client,
          bootstrap,
          graduationManifest,
        )
      : undefined;
    const program = await readProFeeProgramLaunch(
      client,
      bootstrap,
      captured.token,
      graduation,
    );
    if (graduation) {
      ensure(
        graduation.blockNumber === captured.blockNumber &&
          same(graduation.blockHash, captured.blockHash),
        "graduation source snapshot differs.",
      );
      infrastructure.push(
        ...Object.values(graduation.components).map((component) =>
          address(component.address),
        ),
      );
    }
    ensure(
      same(program.token, captured.token) &&
        same(program.curve, captured.curve) &&
        same(program.policy, captured.policy) &&
        same(program.creator, captured.creator) &&
        same(program.factory, captured.factory) &&
        same(program.launchConfigurationHash, captured.configurationHash) &&
        program.blockNumber === captured.blockNumber &&
        same(program.blockHash, captured.blockHash),
      "reviewed program launch identity differs.",
    );
    const [version, genesis, burned, vault] = await Promise.all([
      getter(captured.token, "feeProgramVersion"),
      getter(captured.token, "genesisSupply"),
      getter(captured.token, "cumulativeBurned"),
      getter(captured.token, "programVault"),
    ]);
    programVault = address(vault);
    ensure(
      same(programVault, program.vault),
      "reviewed program Vault differs.",
    );
    ensure(
      version === 4n &&
        genesis === captured.supply &&
        typeof burned === "bigint" &&
        burned >= 0n &&
        actualSupply + burned === captured.supply,
      "program supply/profile differs.",
    );
    cumulativeBurned = burned;
    const [vaultVersion, vaultFactory, vaultToken, vaultCurve] =
      await Promise.all([
        getter(programVault as Address, "feeProgramVersion"),
        getter(programVault as Address, "factory"),
        getter(programVault as Address, "token"),
        getter(programVault as Address, "curve"),
      ]);
    ensure(
      vaultVersion === 4n &&
        same(address(vaultFactory), captured.factory) &&
        same(address(vaultToken), captured.token) &&
        same(address(vaultCurve), captured.curve),
      "program Vault binding differs.",
    );
    infrastructure.push(programVault);
    for (const entry of program.configuration.programs)
      if (!same(entry.adapter, zeroAddress))
        infrastructure.push(address(entry.adapter));
    if (!same(program.quoteAsset, zeroAddress))
      infrastructure.push(address(program.quoteAsset));
  } else
    ensure(
      actualSupply === captured.supply,
      "legacy supply differs from genesis.",
    );
  await canonical();
  return Object.freeze({
    tokenCodeHash: keccak256(code as Hex),
    sourceVersion,
    reviewId: bootstrap.sourceReview.reviewId,
    tokenDecimals: decimals,
    mintLogIndex: initial[0]!.logIndex,
    programVault,
    infrastructure: Object.freeze([...new Set(infrastructure)].sort()),
    cumulativeBurned,
  });
}

/** Private reviewed manifests are separate from subscription configuration. Their
 * exact schema/version/artifacts are validated by the SDK source reader, with no
 * conversion of an older review into a profile 4 review.
 */
export async function loadProHolderSource(
  chainId: number,
  input: ProHolderSourceInput,
) {
  const path = process.env.XOOX_PRO_HOLDER_SOURCES_PATH;
  ensure(
    path && path === resolve(path),
    "explicit absolute reviewed source path unavailable.",
  );
  const [sourceBytes, configBytes] = await Promise.all([
    readFile(path),
    readFile(resolve(process.env.ENVIO_CONFIG ?? "config.yaml")),
  ]);
  ensure(
    sourceBytes.length <= 1024 * 1024 && configBytes.length <= 1024 * 1024,
    "operator configuration oversized.",
  );
  const root = JSON.parse(sourceBytes.toString("utf8")) as {
    schema?: string;
    version?: number;
    manifests?: Record<string, unknown>[];
    graduationManifests?: Record<string, unknown>[];
  };
  ensure(
    ((root.version === 1 &&
      Object.keys(root).sort().join() === "manifests,schema,version") ||
      (root.version === 2 &&
        Object.keys(root).sort().join() ===
          "graduationManifests,manifests,schema,version" &&
        Array.isArray(root.graduationManifests) &&
        root.graduationManifests.length <= 32)) &&
      root.schema === "xoox.pro-token.indexer-holder-sources" &&
      (root.version === 1 || root.version === 2) &&
      Array.isArray(root.manifests) &&
      root.manifests.length > 0 &&
      root.manifests.length <= 32,
    "invalid reviewed source envelope.",
  );
  const matches = root.manifests.filter(
    (manifest) =>
      manifest.chainId === String(chainId) &&
      typeof manifest.factory === "string" &&
      same(manifest.factory, input.factory),
  );
  ensure(matches.length === 1, "reviewed Factory source missing or ambiguous.");
  const raw = matches[0]!;
  const manifest = Object.freeze({
    ...raw,
    chainId: BigInt(raw.chainId as string),
  }) as ProBootstrapSourceManifest;
  const graduationMatches = (root.graduationManifests ?? []).filter(
    (record) =>
      record.chainId === String(chainId) &&
      typeof record.factory === "string" &&
      same(record.factory, input.factory),
  );
  ensure(
    graduationMatches.length <= 1,
    "reviewed graduation source is ambiguous.",
  );
  const graduationManifest = graduationMatches[0]
    ? (Object.freeze({
        ...graduationMatches[0],
        chainId: BigInt(graduationMatches[0].chainId as string),
      }) as ProFeeProgramGraduationSourceManifest)
    : undefined;
  const config = JSON.parse(configBytes.toString("utf8")) as {
    chains?: {
      id?: number;
      rpc?: { url?: string }[];
      contracts?: { name?: string; address?: string[] }[];
    }[];
  };
  const chains = config.chains?.filter((chain) => chain.id === chainId);
  ensure(chains?.length === 1, "operator chain missing or ambiguous.");
  const chain = chains[0]!;
  const factories = chain.contracts?.filter(
    (contract) => contract.name === "ProFactory",
  );
  ensure(
    factories?.length === 1 &&
      factories[0]!.address?.some((target) => same(target, input.factory)),
    "Factory is not explicitly subscribed.",
  );
  const rpc = chain.rpc?.[0]?.url;
  ensure(
    typeof rpc === "string" && /^https?:\/\//.test(rpc),
    "archive-capable RPC unavailable.",
  );
  return readProHolderSource(
    createPublicClient({
      transport: http(rpc, { timeout: 20_000, retryCount: 2 }),
    }),
    chainId,
    manifest,
    input,
    graduationManifest,
  );
}
