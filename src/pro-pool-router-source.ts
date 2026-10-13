import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  encodeFunctionResult,
  http,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

export type ProPoolRouterSourceInput = Readonly<{
  factory: string;
  registry: string;
  router: string;
  blockNumber: bigint;
  blockHash: string;
  timestamp: bigint;
}>;
const abi = parseAbi([
  "function factory() view returns(address)",
  "function registry() view returns(address)",
  "function graduationRegistry() view returns(address)",
  "function partnerRegistry() view returns(address)",
  "function poolManager() view returns(address)",
  "function hook() view returns(address)",
  "function executor() view returns(address)",
  "function verifier() view returns(address)",
  "function proTokenVersion() view returns(uint256)",
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Pro pool source: ${message}`);
}
function address(value: unknown): Address {
  ensure(
    typeof value === "string" &&
      isAddress(value, { strict: true }) &&
      !same(value, zeroAddress),
    "nonzero source address required.",
  );
  return value as Address;
}

/** Getter reads bind a trusted subscribed Router to the indexed Factory; they
 * do not review or authenticate arbitrary runtime code. Operator source review
 * remains mandatory before subscribing to this address. No latest-block fallback.
 */
export async function readProPoolRouterSource(
  client: PublicClient,
  chainId: number,
  input: ProPoolRouterSourceInput,
) {
  const captured = Object.freeze({
    factory: address(input.factory),
    registry: address(input.registry),
    router: address(input.router),
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    timestamp: input.timestamp,
  });
  ensure(
    Number.isSafeInteger(chainId) &&
      chainId > 0 &&
      typeof captured.blockNumber === "bigint" &&
      captured.blockNumber >= 0n &&
      typeof captured.timestamp === "bigint" &&
      captured.timestamp >= 0n &&
      /^0x[\da-fA-F]{64}$/.test(captured.blockHash),
    "event identity is unavailable.",
  );
  ensure(
    new Set(
      [captured.factory, captured.registry, captured.router].map((value) =>
        value.toLowerCase(),
      ),
    ).size === 3,
    "source identities overlap.",
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
  const selector = {
    blockHash: captured.blockHash as Hex,
    requireCanonical: true,
  } as const;
  const read = async (target: Address, name: (typeof abi)[number]["name"]) => {
    const data = encodeFunctionData({ abi, functionName: name });
    const raw = (await client.request({
      method: "eth_call",
      params: [{ to: target, data }, selector],
    } as never)) as Hex;
    const result = decodeFunctionResult({ abi, functionName: name, data: raw });
    ensure(
      same(
        raw,
        encodeFunctionResult({ abi, functionName: name, result } as never),
      ),
      "noncanonical getter bytes.",
    );
    return result;
  };
  await canonical();
  const [
    factory,
    registry,
    registryFactory,
    factoryRegistry,
    ...infrastructure
  ] = await Promise.all([
    read(captured.router, "factory"),
    read(captured.router, "registry"),
    read(captured.registry, "factory"),
    read(captured.factory, "graduationRegistry"),
    ...(
      [
        "partnerRegistry",
        "poolManager",
        "hook",
        "executor",
        "verifier",
      ] as const
    ).map((name) => read(captured.router, name)),
  ]);
  ensure(
    same(address(factory), captured.factory) &&
      same(address(registry), captured.registry) &&
      same(address(registryFactory), captured.factory) &&
      same(address(factoryRegistry), captured.registry),
    "Router/Registry/Factory binding differs from the indexed launch.",
  );
  const sources = Object.freeze(
    [
      captured.router,
      captured.factory,
      captured.registry,
      ...infrastructure.map(address),
    ].map((value) => value.toLowerCase()),
  );
  ensure(
    new Set(sources).size === sources.length,
    "source identities overlap.",
  );
  for (const target of [captured.router, captured.registry, captured.factory]) {
    const [version, code] = await Promise.all([
      read(target, "proTokenVersion"),
      client.request({
        method: "eth_getCode",
        params: [target, selector],
      } as never),
    ]);
    ensure(
      version === 1n &&
        typeof code === "string" &&
        /^0x(?:[\da-fA-F]{2})+$/.test(code),
      "source runtime/version is unavailable.",
    );
  }
  await canonical();
  return Object.freeze({
    factory: captured.factory.toLowerCase(),
    registry: captured.registry.toLowerCase(),
    infrastructure: sources,
  });
}

/** Reuses only the operator-configured chain RPC and explicit static subscribers. */
export async function loadProPoolRouterSource(
  chainId: number,
  input: ProPoolRouterSourceInput,
) {
  const bytes = await readFile(
    resolve(process.env.ENVIO_CONFIG ?? "config.yaml"),
  );
  ensure(bytes.length <= 1024 * 1024, "operator configuration is oversized.");
  const config = JSON.parse(bytes.toString("utf8")) as {
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
    ["ProFactory", input.factory],
    ["ProSwapRouter", input.router],
  ] as const) {
    const entries = chain.contracts?.filter(
      (contract) => contract.name === name,
    );
    ensure(
      entries?.length === 1 &&
        Array.isArray(entries[0]?.address) &&
        entries[0]!.address!.some(
          (value) => typeof value === "string" && same(value, target),
        ),
      "source address is not explicitly subscribed.",
    );
  }
  const rpc = chain.rpc?.[0]?.url;
  ensure(
    typeof rpc === "string" && /^(https?:\/\/)/.test(rpc),
    "configured archive-capable RPC is unavailable.",
  );
  return readProPoolRouterSource(
    createPublicClient({
      transport: http(rpc, { timeout: 20_000, retryCount: 2 }),
    }),
    chainId,
    input,
  );
}
