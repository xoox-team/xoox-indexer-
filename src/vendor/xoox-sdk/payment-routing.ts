// Vendored from the XOOX SDK; only what the indexer uses.
import {
  getAddress,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import type { Deployment, QuoteAsset } from "./config";
export type PaymentHop = {
  kind: number;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  tickSpacing: number;
};
export type PaymentRoute = {
  paymentAsset: Address;
  quoteAsset: Address;
  hops: PaymentHop[];
};
export type PaymentConfiguration = {
  router: Address;
  weth: Address;
  v3Factory: Address;
  quoterV3: Address;
  quoterV4: Address;
  assets: QuoteAsset[];
  routes: PaymentRoute[];
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const paymentRouterAbi = parseAbi([
  "function trade((address token,address paymentAsset,bool buy,uint256 amountIn,uint256 minQuote,uint256 minOut,uint8 expectedPhase,uint256 deadline) t,(uint8 kind,address tokenIn,address tokenOut,uint24 fee,int24 tickSpacing)[] hops) payable returns(uint256 amountOut,uint256 refund)",
  "function factory() view returns(address)",
  "function swapRouter() view returns(address)",
  "function poolManager() view returns(address)",
  "function v3Factory() view returns(address)",
  "function weth() view returns(address)",
  "event RoutedTrade(address indexed token,address indexed trader,address indexed paymentAsset,bool buy,uint8 phase,uint256 quoteAmount,uint256 tokenAmount,uint256 paymentAmount,address refundAsset,uint256 refundAmount)",
  "error InvalidRoute()",
  "error InvalidTrade()",
  "error PhaseChanged()",
  "error Slippage()",
  "error InexactTransfer()",
  "error IncompleteSwap()",
]);
export const paymentV3QuoteAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
export const paymentV4QuoteAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)",
]);

export function validatePaymentRoute(
  hops: readonly PaymentHop[],
  input: Address,
  output: Address,
  weth: Address,
  forbidden?: Address,
) {
  if (hops.length > 3) throw Error("Payment route is too long.");
  let current = input;
  const visited = new Set([input.toLowerCase()]);
  for (const h of hops) {
    if (
      !isAddress(h.tokenIn, { strict: false }) ||
      !isAddress(h.tokenOut, { strict: false }) ||
      !same(h.tokenIn, current) ||
      visited.has(h.tokenOut.toLowerCase()) ||
      [h.tokenIn, h.tokenOut].some((a) => forbidden && same(a, forbidden))
    )
      throw Error("Invalid payment route endpoints.");
    if (!Number.isInteger(h.fee) || !Number.isInteger(h.tickSpacing))
      throw Error("Invalid pool parameters.");
    if (h.kind === 0) {
      if (
        !(
          (same(h.tokenIn, zeroAddress) && same(h.tokenOut, weth)) ||
          (same(h.tokenIn, weth) && same(h.tokenOut, zeroAddress))
        ) ||
        h.fee !== 0 ||
        h.tickSpacing !== 0
      )
        throw Error("Only canonical MON wrapping is supported.");
    } else if (h.kind === 1) {
      if (
        same(h.tokenIn, zeroAddress) ||
        same(h.tokenOut, zeroAddress) ||
        h.fee <= 0 ||
        h.fee > 10000 ||
        h.tickSpacing !== 0
      )
        throw Error("Invalid v3 route.");
    } else if (h.kind === 2) {
      if (
        h.fee < 0 ||
        h.fee > 10000 ||
        h.tickSpacing <= 0 ||
        h.tickSpacing > 32767
      )
        throw Error("Invalid v4 route.");
    } else throw Error("Unsupported payment route.");
    visited.add(h.tokenOut.toLowerCase());
    current = h.tokenOut;
  }
  if (!same(current, output))
    throw Error("Payment route does not reach the selected asset.");
}
export function reversePaymentRoute(hops: readonly PaymentHop[]): PaymentHop[] {
  return [...hops]
    .reverse()
    .map((h) => ({ ...h, tokenIn: h.tokenOut, tokenOut: h.tokenIn }));
}

/** Compose at most three explicitly configured typed pool edges. Routes contain
 * canonical wrapping, Uniswap v3, or hookless Uniswap v4 hops only because each
 * source route has already passed validatePaymentRoute. */
export function findPaymentRoute(
  configuration: PaymentConfiguration,
  input: Address,
  output: Address,
  forbidden?: Address,
): PaymentHop[] | undefined {
  if (same(input, output)) return [];
  // Shared MON/WMON and stablecoin edges appear in many configured routes.
  // Deduplicate them before searching, so catalog size does not multiply paths.
  const edges = new Map<string, PaymentHop[]>();
  const unique = new Set<string>();
  for (const route of configuration.routes) {
    for (const hop of [...route.hops, ...reversePaymentRoute(route.hops)]) {
      const key = `${hop.kind}:${hop.tokenIn.toLowerCase()}:${hop.tokenOut.toLowerCase()}:${hop.fee}:${hop.tickSpacing}`;
      if (unique.has(key)) continue;
      unique.add(key);
      const inputKey = hop.tokenIn.toLowerCase();
      edges.set(inputKey, [...(edges.get(inputKey) ?? []), hop]);
    }
  }
  const queue: { current: Address; hops: PaymentHop[] }[] = [
    { current: input, hops: [] },
  ];
  const visited = new Set([input.toLowerCase()]);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    if (path.hops.length === 3) continue;
    for (const edge of edges.get(path.current.toLowerCase()) ?? []) {
      if (visited.has(edge.tokenOut.toLowerCase())) continue;
      const hops = [...path.hops, edge];
      const end = hops[hops.length - 1].tokenOut;
      try {
        validatePaymentRoute(hops, input, end, configuration.weth, forbidden);
      } catch {
        continue;
      }
      if (same(end, output)) return hops;
      visited.add(end.toLowerCase());
      queue.push({ current: end, hops });
    }
  }
}

/** Direct pool assets remain available. Routed choices must be allowlisted and
 * reachable without passing through the meme itself; MON is the default. */
export function tradePaymentAssets(
  configuration: PaymentConfiguration | undefined,
  quote: QuoteAsset,
  token: Address,
  secondaryQuote?: QuoteAsset,
  catalog: readonly QuoteAsset[] = [],
): QuoteAsset[] {
  const assets = new Map<string, QuoteAsset>();
  for (const asset of [quote, ...(secondaryQuote ? [secondaryQuote] : [])])
    assets.set(asset.address.toLowerCase(), asset);
  for (const asset of configuration?.assets ?? []) {
    if (findPaymentRoute(configuration!, asset.address, quote.address, token))
      if (!assets.has(asset.address.toLowerCase()))
        assets.set(asset.address.toLowerCase(), asset);
  }
  return [...assets.values()].map((asset) => {
    const metadata = catalog.find((entry) => same(entry.address, asset.address));
    const enriched = { ...metadata, ...asset };
    if (same(asset.address, zeroAddress))
      return { ...enriched, name: "Monad", category: "crypto" as const, logoUrl: "/brand/monad.svg" };
    if (configuration && same(asset.address, configuration.weth))
      return { ...enriched, name: "Wrapped Monad", category: "crypto" as const, logoUrl: "/brand/monad.svg" };
    if (["USDC", "mUSDC"].includes(asset.symbol) && !enriched.logoUrl)
      return { ...enriched, name: "USD Coin", category: "crypto" as const, logoUrl: "/brand/usdc.svg" };
    return enriched;
  }).sort(
    (a, b) =>
      Number(same(b.address, zeroAddress)) -
      Number(same(a.address, zeroAddress)),
  );
}

/** Explicitly enable approved quote assets that can use the existing MON graph.
 * This updates a configuration, never the onchain routers or liquidity pools. */
export function withRoutablePaymentAssets(
  configuration: PaymentConfiguration,
  approved: readonly QuoteAsset[],
): PaymentConfiguration {
  if (!configuration.assets.some((asset) => same(asset.address, zeroAddress)))
    return configuration;
  const assets = new Map(configuration.assets.map((asset) => [asset.address.toLowerCase(), asset]));
  const candidates: QuoteAsset[] = [
    { address: configuration.weth, symbol: "WMON", decimals: 18 },
    ...approved,
  ];
  for (const asset of candidates) {
    if (assets.has(asset.address.toLowerCase())) continue;
    if (findPaymentRoute(configuration, asset.address, zeroAddress))
      assets.set(asset.address.toLowerCase(), asset);
  }
  return parsePaymentConfiguration({ ...configuration, assets: [...assets.values()] });
}

/** Publication gate: every listed quote must support MON funding and proceeds.
 * Pool liquidity is checked separately, against the same publication block. */
export function requireNativePaymentRoutes(
  configuration: PaymentConfiguration | undefined,
  quotes: readonly QuoteAsset[],
) {
  const ethEnabled = configuration?.assets.some((asset) =>
    same(asset.address, zeroAddress),
  );
  const missing = quotes.filter(
    (quote) =>
      !same(quote.address, zeroAddress) &&
      (!ethEnabled ||
        !findPaymentRoute(configuration!, zeroAddress, quote.address)),
  );
  if (missing.length)
    throw Error(
      `MON payment routes are missing for: ${missing.map((asset) => asset.symbol).join(", ")}.`,
    );
}
/** @deprecated Use requireNativePaymentRoutes; native funding is MON. */
export const requireEthPaymentRoutes = requireNativePaymentRoutes;

export function paymentMinimums(
  quote: bigint,
  out: bigint,
  slippageBps: number,
) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500)
    throw Error("Payment slippage must be between 0 and 5%.");
  const minQuote = (quote * BigInt(10000 - slippageBps)) / 10000n,
    minOut = (out * BigInt(10000 - slippageBps)) / 10000n;
  if (minQuote <= 0n || minOut <= 0n)
    throw Error("Amount is too small for a protected trade.");
  return { minQuote, minOut };
}
function addr(value: unknown, native = false): Address {
  if (
    typeof value !== "string" ||
    !isAddress(value, { strict: false }) ||
    (!native && same(value, zeroAddress))
  )
    throw Error("Invalid payment contract address.");
  return getAddress(value);
}
export function parsePaymentConfiguration(raw: unknown): PaymentConfiguration {
  if (!raw || typeof raw !== "object")
    throw Error("Invalid payment configuration.");
  const p = raw as PaymentConfiguration;
  const config: PaymentConfiguration = {
    router: addr(p.router),
    weth: addr(p.weth),
    v3Factory: addr(p.v3Factory),
    quoterV3: addr(p.quoterV3),
    quoterV4: addr(p.quoterV4),
    assets: [],
    routes: [],
  };
  if (
    !Array.isArray(p.assets) ||
    !p.assets.length ||
    p.assets.length > 100 ||
    !Array.isArray(p.routes) ||
    p.routes.length > 1000
  )
    throw Error("Invalid payment assets or routes.");
  config.assets = p.assets.map((a) => {
    if (
      typeof a.symbol !== "string" ||
      !a.symbol.trim() ||
      a.symbol.length > 24 ||
      !Number.isInteger(a.decimals) ||
      a.decimals < 0 ||
      a.decimals > 36
    )
      throw Error("Invalid payment asset.");
    const address = addr(a.address, true);
    if (same(address, zeroAddress) && (a.symbol !== "MON" || a.decimals !== 18))
      throw Error("Native MON must use symbol MON and 18 decimals.");
    if (same(address, config.weth) && (a.symbol !== "WMON" || a.decimals !== 18))
      throw Error("Wrapped native MON must use symbol WMON and 18 decimals.");
    return { address, symbol: a.symbol, decimals: a.decimals };
  });
  if (
    new Set(config.assets.map((a) => a.address.toLowerCase())).size !==
    config.assets.length
  )
    throw Error("Duplicate payment assets.");
  config.routes = p.routes.map((r) => {
    if (!Array.isArray(r.hops)) throw Error("Invalid payment hops.");
    const route = {
      paymentAsset: addr(r.paymentAsset, true),
      quoteAsset: addr(r.quoteAsset, true),
      hops: r.hops.map((h) => ({
        kind: h.kind,
        tokenIn: addr(h.tokenIn, true),
        tokenOut: addr(h.tokenOut, true),
        fee: h.fee,
        tickSpacing: h.tickSpacing,
      })),
    };
    if (!config.assets.some((a) => same(a.address, route.paymentAsset)))
      throw Error("Route payment asset is not configured.");
    validatePaymentRoute(
      route.hops,
      route.paymentAsset,
      route.quoteAsset,
      config.weth,
    );
    return route;
  });
  if (
    new Set(
      config.routes.map(
        (r) => `${r.paymentAsset.toLowerCase()}:${r.quoteAsset.toLowerCase()}`,
      ),
    ).size !== config.routes.length
  )
    throw Error("Duplicate payment routes.");
  return config;
}
export async function verifyPaymentWiring(
  client: PublicClient,
  deployment: Deployment,
  blockNumber?: bigint,
) {
  const p = deployment.payments;
  if (!p) return;
  if (deployment.paymentRouter && !same(deployment.paymentRouter, p.router))
    throw Error("Payment router addresses disagree.");
  const bindings = Object.entries({
    factory: deployment.factory,
    swapRouter: deployment.swapRouter,
    poolManager: deployment.poolManager,
    v3Factory: p.v3Factory,
    weth: p.weth,
  });
  // These eleven fixed reads are independent. Start them together so paced
  // transports and deployless multicall can group the contract getters.
  const [actualBindings, codes, [v3Factory, v4Manager]] = await Promise.all([
    Promise.all(bindings.map(([getter]) => client.readContract({
      address: p.router,
      abi: paymentRouterAbi,
      functionName: getter as "factory",
      blockNumber,
    }))),
    Promise.all([p.quoterV3, p.quoterV4, p.v3Factory, p.weth].map((address) =>
      client.getCode({ address, blockNumber }),
    )),
    // Quoters are only advisory. Execution uses the validated router.
    Promise.all([
      client.readContract({
        address: p.quoterV3,
        abi: parseAbi(["function factory() view returns(address)"]),
        functionName: "factory",
        blockNumber,
      }),
      client.readContract({
        address: p.quoterV4,
        abi: parseAbi(["function poolManager() view returns(address)"]),
        functionName: "poolManager",
        blockNumber,
      }),
    ]),
  ]);
  for (const [index, [getter, expected]] of bindings.entries()) {
    const actual = actualBindings[index];
    if (!same(actual, expected))
      throw Error(`Payment router ${getter} does not match this deployment.`);
  }
  for (const code of codes) {
    if (!code || code === "0x")
      throw Error("Payment dependency is not deployed.");
  }
  if (!same(v3Factory, p.v3Factory) || !same(v4Manager, deployment.poolManager))
    throw Error("Payment quoter dependencies do not match.");
}
export async function quotePaymentConversion(
  client: PublicClient,
  p: Pick<PaymentConfiguration, "quoterV3" | "quoterV4">,
  hops: readonly PaymentHop[],
  input: bigint,
  blockNumber: bigint,
): Promise<bigint> {
  let amount = input;
  for (const h of hops) {
    if (amount <= 0n || amount > (1n << 127n) - 1n)
      throw Error("Payment amount is outside supported bounds.");
    if (h.kind === 0) continue;
    if (h.kind === 1) {
      amount = (
        await client.simulateContract({
          address: p.quoterV3,
          abi: paymentV3QuoteAbi,
          functionName: "quoteExactInputSingle",
          args: [
            {
              tokenIn: h.tokenIn,
              tokenOut: h.tokenOut,
              amountIn: amount,
              fee: h.fee,
              sqrtPriceLimitX96: 0n,
            },
          ],
          blockNumber,
        })
      ).result[0];
    } else if (h.kind === 2) {
      const zeroForOne = BigInt(h.tokenIn) < BigInt(h.tokenOut);
      amount = (
        await client.simulateContract({
          address: p.quoterV4,
          abi: paymentV4QuoteAbi,
          functionName: "quoteExactInputSingle",
          args: [
            {
              poolKey: {
                currency0: zeroForOne ? h.tokenIn : h.tokenOut,
                currency1: zeroForOne ? h.tokenOut : h.tokenIn,
                fee: h.fee,
                tickSpacing: h.tickSpacing,
                hooks: zeroAddress,
              },
              zeroForOne,
              exactAmount: amount,
              hookData: "0x",
            },
          ],
          blockNumber,
        })
      ).result[0];
    } else throw Error("Unsupported payment route.");
  }
  if (amount <= 0n) throw Error("No liquid route for this amount.");
  return amount;
}

export async function verifyEthPaymentRoutes(
  client: PublicClient,
  deployment: Deployment,
  blockNumber: bigint,
) {
  requireEthPaymentRoutes(deployment.payments, deployment.quoteAssets);
  const quotes = deployment.quoteAssets.filter(
    (asset) => !same(asset.address, zeroAddress),
  );
  if (!quotes.length) return [];
  await verifyPaymentWiring(client, deployment, blockNumber);
  const p = deployment.payments!;
  const evidence = [];
  for (const quote of quotes) {
    const hops = findPaymentRoute(p, zeroAddress, quote.address)!;
    const ethIn = 10n ** 16n;
    const quoteOut = await quotePaymentConversion(
      client,
      p,
      hops,
      ethIn,
      blockNumber,
    );
    const ethOut = await quotePaymentConversion(
      client,
      p,
      reversePaymentRoute(hops),
      quoteOut,
      blockNumber,
    );
    evidence.push({
      factory: deployment.factory,
      quoteAsset: quote.address,
      symbol: quote.symbol,
      blockNumber: blockNumber.toString(),
      ethIn: ethIn.toString(),
      quoteOut: quoteOut.toString(),
      ethOut: ethOut.toString(),
    });
  }
  return evidence;
}
