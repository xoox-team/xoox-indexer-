// Vendored from the XOOX SDK; only what the indexer uses.
import { zeroAddress } from "viem";
import type { QuoteAsset } from "./config";

/** Chain metadata is not an XOOX deployment. Deploy protocol contracts separately.
 * Source: https://docs.monad.xyz/developer-essentials/network-information */
export const monadMainnet = {
  chainId: 143,
  chainName: "Monad",
  rpcUrl: "https://rpc.monad.xyz",
  explorerUrl: "https://monadscan.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
} as const;
export const monadTestnet = {
  chainId: 10143,
  chainName: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadscan.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
} as const;
export const supportedMonadChainIds = [143, 10143, 31337] as const;

export function assertMonadNetwork(deployment: {
  chainId: number;
  environment: "local" | "configured";
  nativeCurrency: { symbol: string; decimals: number };
}): void {
  if (deployment.environment === "local" && deployment.chainId !== 31337)
    throw new Error("Local deployments require chain 31337.");
  if (
    deployment.environment === "configured" &&
    deployment.chainId !== 143 &&
    deployment.chainId !== 10143
  )
    throw new Error(
      "Configured deployments require Monad mainnet 143 or testnet 10143.",
    );
  if (
    deployment.nativeCurrency.symbol !== "MON" ||
    deployment.nativeCurrency.decimals !== 18
  )
    throw new Error("Monad native currency must be MON with 18 decimals.");
}

/** Official Uniswap mainnet deployments, verified to have code on chain 143.
 * https://developers.uniswap.org/docs/protocols/v4/deployments#monad-143 */
export const monadV4 = {
  poolManager: "0x188d586ddcf52439676ca21a244753fa19f9ea8e",
  positionManager: "0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016",
  quoter: "0xa222dd357a9076d1091ed6aa2e16c9742dd26891",
  stateView: "0x77395f3b2e73ae90843717371294fa97cc419d64",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;
export const monadV3 = {
  factory: "0x204faca1764b154221e35c0d20abb3c525710498",
  quoterV2: "0x661e93cca42afacb172121ef892830ca3b70f08d",
  swapRouter02: "0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900",
  positionManager: "0x7197e214c0b767cfb76fb734ab638e2c192f4e53",
} as const;

/** Token identities only: this catalog does not claim deployed XOOX pools,
 * live liquidity, market prices, or launch approval. No testnet substitutes.
 * Official registry: https://github.com/monad-crypto/token-list
 * Pool observations: docs/research/2026-09-21-monad-liquid-assets.md */
export const monadQuoteAssets = [
  {
    address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
    symbol: "WMON",
    name: "Wrapped Monad",
    decimals: 18,
    category: "crypto",
    logoUrl: "/brand/monad.svg",
  },
  {
    address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    category: "crypto",
    logoUrl: "/brand/ethereum.svg",
  },
  {
    address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    category: "crypto",
    logoUrl: "/crypto-logos/bitcoin.svg",
  },
  {
    address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    category: "crypto",
    logoUrl: "/brand/usdc.svg",
  },
  {
    address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
    symbol: "USDT0",
    name: "USDT0",
    decimals: 6,
    category: "crypto",
    logoUrl: "/crypto-logos/tether.svg",
  },
  {
    address: "0x8498312A6B3CbD158bf0c93AbdCF29E6e4F55081",
    symbol: "gMON",
    name: "gMON",
    decimals: 18,
    category: "crypto",
    logoUrl: "/brand/gmon.svg",
  },
  {
    address: "0xA3227C5969757783154C60bF0bC1944180ed81B9",
    symbol: "sMON",
    name: "Kintsu Staked Monad",
    decimals: 18,
    category: "crypto",
    logoUrl: "/brand/smon.svg",
  },
  {
    address: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c",
    symbol: "shMON",
    name: "ShMonad",
    decimals: 18,
    category: "crypto",
    logoUrl: "/brand/shmon.png",
  },
  {
    address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    symbol: "AUSD",
    name: "AUSD",
    decimals: 6,
    category: "crypto",
    logoUrl: "/brand/ausd.svg",
  },
  {
    address: "0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b",
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    decimals: 8,
    category: "crypto",
    logoUrl: "/brand/cbbtc.svg",
  },
  {
    address: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071",
    symbol: "XAUt0",
    name: "XAUt0",
    decimals: 6,
    category: "crypto",
    logoUrl: "/brand/xaut0.svg",
  },
  {
    address: "0xF59D81cd43f620E722E07f9Cb3f6E41B031017a3",
    symbol: "Cake",
    name: "PancakeSwap Token",
    decimals: 18,
    category: "crypto",
    logoUrl: "/brand/cake.svg",
  },
] as const satisfies readonly QuoteAsset[];
export const monadNativeAsset = {
  address: zeroAddress,
  symbol: "MON",
  name: "Monad",
  decimals: 18,
  category: "crypto",
  logoUrl: "/brand/monad.svg",
} as const satisfies QuoteAsset;

/** Known mainnet symbols and contract addresses must describe the same asset. */
export function assertMonadAssetIdentity(asset: QuoteAsset): void {
  const known = [monadNativeAsset, ...monadQuoteAssets].find(
    (quote) =>
      quote.address.toLowerCase() === asset.address.toLowerCase() ||
      quote.symbol === asset.symbol,
  );
  if (
    known &&
    (known.address.toLowerCase() !== asset.address.toLowerCase() ||
      known.symbol !== asset.symbol ||
      known.decimals !== asset.decimals ||
      asset.mock)
  )
    throw new Error(
      `Monad ${known.symbol} asset identity does not match the verified mainnet token.`,
    );
}

export const monadPaymentDependencies = {
  /** Legacy contract ABI name: on Monad, weth always means WMON, never WETH. */
  weth: monadQuoteAssets[0].address,
  v3Factory: monadV3.factory,
  quoterV3: monadV3.quoterV2,
  quoterV4: monadV4.quoter,
} as const;
export function assertMonadPaymentDependencies(deployment: {
  chainId: number;
  environment: "local" | "configured";
  payments?: {
    weth: string;
    v3Factory: string;
    quoterV3: string;
    quoterV4: string;
  };
}): void {
  if (
    deployment.chainId !== monadMainnet.chainId ||
    deployment.environment !== "configured" ||
    !deployment.payments
  )
    return;
  for (const key of ["weth", "v3Factory", "quoterV3", "quoterV4"] as const)
    if (
      deployment.payments[key].toLowerCase() !==
      monadPaymentDependencies[key].toLowerCase()
    )
      throw new Error(
        `Monad payment ${key} must use the pinned official deployment.`,
      );
}

/** HyperSync is available on Monad; HyperRPC requires provider authentication. */
export const monadIndexer = {
  chainId: 143,
  hyperSyncUrl: "https://143.hypersync.xyz",
  hyperRpcUrl: "https://143.rpc.hypersync.xyz",
  hyperRpcRequiresApiKey: true,
} as const;

/** Apply canonical infrastructure pins even when a caller bypasses JSON parsing. */
export function assertMonadDeploymentDependencies(deployment: {
  chainId: number;
  environment: "local" | "configured";
  poolManager?: string;
  positionManager?: string;
  permit2?: string;
  weth?: string;
}): void {
  if (deployment.chainId !== 143 || deployment.environment !== "configured")
    return;
  const expected = {
    poolManager: monadV4.poolManager,
    positionManager: monadV4.positionManager,
    permit2: monadV4.permit2,
    weth: monadPaymentDependencies.weth,
  };
  for (const key of [
    "poolManager",
    "positionManager",
    "permit2",
    "weth",
  ] as const)
    if (
      deployment[key] !== undefined &&
      deployment[key]!.toLowerCase() !== expected[key].toLowerCase()
    )
      throw new Error(`Monad ${key} must use the pinned official deployment.`);
}
