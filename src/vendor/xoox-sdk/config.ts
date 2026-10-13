// Vendored from the XOOX SDK; only what the indexer uses.
import {
  findPaymentRoute,
  parsePaymentConfiguration,
  type PaymentConfiguration,
} from "./payment-routing";
import {
  getAddress,
  isAddress,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
} from "viem";
import { assertMonadPaymentDependencies, assertMonadAssetIdentity, assertMonadDeploymentDependencies } from "./networks";
import { parseDuoGenerationRegistry, type DuoGenerationRegistry } from "./duo-generations";

export type QuoteAsset = {
  category?: "crypto" | "stock";
  address: Address;
  symbol: string;
  decimals: number;
  mock?: boolean;
  name?: string;
  logoUrl?: string;
  logoBackground?: "light" | "dark";
};
export type DeploymentSecurity = {
  deploymentAuthority: Address;
  governance: Address;
  keeperOperator: Address;
  opsRecipient: Address;
  permissionless: boolean;
  protocolBuyback?: {
    token: Address;
    executor: Address;
  };
};
export type PublicationPolicy = {
  /** Number of blocks that the verified publication block must trail each RPC head. */
  confirmationDepth: number;
  /** Expected registrable provider families, for example `quicknode.pro`. */
  primaryRpcProvider: string;
  secondaryRpcProvider: string;
};
export type LiquidityWarningEvidence = {
  unlockedLiquidity: false;
  transferPausable: false;
  potentialScam: false;
  unverifiedToken: boolean;
  disableBuying: false;
  disableSelling: false;
};
type LiquidityCanaryBase = {
  token: Address;
  quoteAsset: Address;
  url: string;
  warnings: LiquidityWarningEvidence;
};
export type LiquidityCanary =
  | (LiquidityCanaryBase & { kind: "single" })
  | (LiquidityCanaryBase & {
      kind: "duo";
      secondaryQuote: Address;
      routeHash: Hash;
    });
export type LiquidityAcceptance = {
  checkedAt: string;
  provider: "fomo.family";
  canaries: LiquidityCanary[];
};
export type TestnetLiquidityCanary =
  | { kind: "single"; token: Address; quoteAsset: Address }
  | {
      kind: "duo";
      token: Address;
      quoteAsset: Address;
      secondaryQuote: Address;
      routeHash: Hash;
    };
export type TestnetLiquidityAcceptance = {
  checkedAt: string;
  provider: "monad-testnet-onchain";
  canaries: TestnetLiquidityCanary[];
};
export type DuoPair = {
  primaryQuote: Address;
  secondaryQuote: Address;
};
export type Deployment = {
  legacyDeployments?: Deployment[];
  /** Additive reviewed successor bundles. Presence alone never grants admission. */
  duoGenerations?: DuoGenerationRegistry;
  payments?: PaymentConfiguration;
  paymentRouter?: Address;
  chainId: number;
  chainName?: string;
  rpcUrl: string;
  explorerUrl?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  factory: Address;
  feeVault: Address;
  buybackVault: Address;
  poolManager: Address;
  positionManager: Address;
  hook: Address;
  swapRouter: Address;
  launchRouter?: Address;
  stakingFactory?: Address;
  duoExecutor?: Address;
  duoPairs?: DuoPair[];
  treasury?: Address;
  locker?: Address;
  graduationExecutor?: Address;
  dividendFactory?: Address;
  weth?: Address;
  permit2?: Address;
  startBlock: string;
  quoteAssets: QuoteAsset[];
  environment: "local" | "configured";
  security?: DeploymentSecurity;
  publication?: PublicationPolicy;
  liquidityAcceptance?: LiquidityAcceptance;
  testnetLiquidityAcceptance?: TestnetLiquidityAcceptance;
};

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required.`);
  return value.trim();
}
function brandedChainName(value: string): string {
  return value === "LONG Local" ? "XOOX Local" : value;
}
function integer(
  value: unknown,
  field: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new Error(`${field} must be a valid integer.`);
  return value;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean.`);
  return value;
}
function address(value: unknown, field: string, native = false): Address {
  const result = text(value, field);
  if (
    !isAddress(result, { strict: false }) ||
    (!native && result.toLowerCase() === zeroAddress)
  )
    throw new Error(`${field} must be a nonzero contract address.`);
  return getAddress(result);
}
function url(value: unknown, field: string): string {
  const result = text(value, field);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${field} must be an HTTP URL.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error(`${field} must be an HTTP URL without credentials.`);
  return result.replace(/\/$/, "");
}

function rpcProvider(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase().replace(/\.+$/, "");
  if (
    result.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(result) ||
    result.includes("..")
  )
    throw new Error(`${field} must be a normalized RPC provider identifier.`);
  return result;
}

function parseLiquidityAcceptance(
  value: unknown,
  chainId: number,
  quoteAssets: readonly QuoteAsset[],
  duoPairs: readonly DuoPair[],
): LiquidityAcceptance {
  const evidence = object(value, "liquidity acceptance");
  if (evidence.provider !== "fomo.family")
    throw new Error("Liquidity acceptance provider must be fomo.family.");
  const checkedAt = text(evidence.checkedAt, "liquidity acceptance checkedAt");
  const parsedCheckedAt = new Date(checkedAt);
  if (
    !Number.isFinite(parsedCheckedAt.getTime()) ||
    parsedCheckedAt.toISOString() !== checkedAt
  )
    throw new Error("Liquidity acceptance checkedAt must be an ISO timestamp.");
  if (!Array.isArray(evidence.canaries) || evidence.canaries.length === 0)
    throw new Error("Liquidity acceptance requires at least one canary.");
  const canaries = evidence.canaries.map((value, index): LiquidityCanary => {
    const canary = object(value, `liquidity acceptance canaries[${index}]`);
    if (canary.kind !== "single" && canary.kind !== "duo")
      throw new Error("Liquidity canary kind must be single or duo.");
    const token = address(canary.token, "liquidity canary token");
    const quoteAsset = address(
      canary.quoteAsset,
      "liquidity canary quoteAsset",
      true,
    );
    if (
      !quoteAssets.some(
        (quote) => quote.address.toLowerCase() === quoteAsset.toLowerCase(),
      )
    )
      throw new Error(
        "Liquidity canary quoteAsset must be a configured launch quote.",
      );
    const canaryUrl = url(canary.url, "liquidity canary URL");
    const parsedUrl = new URL(canaryUrl);
    const expectedPath = `/tokens/monad/${token}`.toLowerCase();
    if (
      chainId !== 143 ||
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "fomo.family" ||
      parsedUrl.port !== "" ||
      parsedUrl.username !== "" ||
      parsedUrl.password !== "" ||
      parsedUrl.search !== "" ||
      parsedUrl.hash !== "" ||
      parsedUrl.pathname.toLowerCase() !== expectedPath
    )
      throw new Error(
        "Liquidity canary URL must be the exact Monad HTTPS fomo.family token page.",
      );
    const warnings = object(canary.warnings, "liquidity canary warnings");
    for (const key of [
      "unlockedLiquidity",
      "transferPausable",
      "potentialScam",
      "disableBuying",
      "disableSelling",
    ] as const)
      if (warnings[key] !== false)
        throw new Error(`Liquidity canary warning ${key} must be false.`);
    if (typeof warnings.unverifiedToken !== "boolean")
      throw new Error(
        "Liquidity canary unverifiedToken status must be boolean.",
      );
    const base: LiquidityCanaryBase = {
      token,
      quoteAsset,
      url: canaryUrl,
      warnings: {
        unlockedLiquidity: false,
        transferPausable: false,
        potentialScam: false,
        unverifiedToken: warnings.unverifiedToken,
        disableBuying: false,
        disableSelling: false,
      },
    };
    if (canary.kind === "single") return { kind: "single", ...base };
    const secondaryQuote = address(
      canary.secondaryQuote,
      "Duo liquidity canary secondaryQuote",
      true,
    );
    const routeHash = text(
      canary.routeHash,
      "Duo liquidity canary routeHash",
    ) as Hash;
    if (!/^0x[0-9a-fA-F]{64}$/.test(routeHash) || routeHash === zeroHash)
      throw new Error(
        "Duo liquidity canary routeHash must be nonzero bytes32.",
      );
    if (
      !duoPairs.some(
        (pair) =>
          pair.primaryQuote.toLowerCase() === quoteAsset.toLowerCase() &&
          pair.secondaryQuote.toLowerCase() === secondaryQuote.toLowerCase(),
      )
    )
      throw new Error(
        "Duo liquidity canary must match an ordered Duo pair allowlist entry.",
      );
    return {
      kind: "duo",
      ...base,
      secondaryQuote,
      routeHash: routeHash.toLowerCase() as Hash,
    };
  });
  if (
    new Set(canaries.map((canary) => canary.token.toLowerCase())).size !==
    canaries.length
  )
    throw new Error("Liquidity acceptance contains duplicate canary tokens.");
  if (!canaries.some((canary) => canary.kind === "single"))
    throw new Error("Liquidity acceptance requires a Single V4 canary.");
  return { checkedAt, provider: "fomo.family", canaries };
}

function parseTestnetLiquidityAcceptance(
  value: unknown,
  quoteAssets: readonly QuoteAsset[],
  duoPairs: readonly DuoPair[],
): TestnetLiquidityAcceptance {
  const evidence = object(value, "testnet liquidity acceptance");
  if (evidence.provider !== "monad-testnet-onchain")
    throw new Error(
      "Testnet liquidity acceptance provider must be monad-testnet-onchain.",
    );
  const checkedAt = text(
    evidence.checkedAt,
    "testnet liquidity acceptance checkedAt",
  );
  const parsedCheckedAt = new Date(checkedAt);
  if (
    !Number.isFinite(parsedCheckedAt.getTime()) ||
    parsedCheckedAt.toISOString() !== checkedAt
  )
    throw new Error(
      "Testnet liquidity acceptance checkedAt must be an ISO timestamp.",
    );
  if (!Array.isArray(evidence.canaries) || evidence.canaries.length === 0)
    throw new Error("Testnet liquidity acceptance requires at least one canary.");
  const canaries = evidence.canaries.map(
    (value, index): TestnetLiquidityCanary => {
      const canary = object(value, `testnet liquidity canaries[${index}]`);
      if (canary.kind !== "single" && canary.kind !== "duo")
        throw new Error("Testnet liquidity canary kind must be single or duo.");
      if (canary.url !== undefined || canary.warnings !== undefined)
        throw new Error(
          "Testnet liquidity canaries use onchain evidence, not external URL or warning claims.",
        );
      const token = address(canary.token, "testnet liquidity canary token");
      const quoteAsset = address(
        canary.quoteAsset,
        "testnet liquidity canary quoteAsset",
        true,
      );
      if (
        !quoteAssets.some(
          (quote) =>
            quote.address.toLowerCase() === quoteAsset.toLowerCase(),
        )
      )
        throw new Error(
          "Testnet liquidity canary quoteAsset must be a configured launch quote.",
        );
      if (canary.kind === "single") {
        if (
          canary.secondaryQuote !== undefined ||
          canary.routeHash !== undefined
        )
          throw new Error(
            "Single testnet liquidity canary cannot declare Duo route evidence.",
          );
        return { kind: "single", token, quoteAsset };
      }
      const secondaryQuote = address(
        canary.secondaryQuote,
        "testnet Duo canary secondaryQuote",
        true,
      );
      const routeHash = text(
        canary.routeHash,
        "testnet Duo canary routeHash",
      ) as Hash;
      if (!/^0x[0-9a-fA-F]{64}$/.test(routeHash) || routeHash === zeroHash)
        throw new Error("Testnet Duo canary routeHash must be nonzero bytes32.");
      if (
        !duoPairs.some(
          (pair) =>
            pair.primaryQuote.toLowerCase() === quoteAsset.toLowerCase() &&
            pair.secondaryQuote.toLowerCase() === secondaryQuote.toLowerCase(),
        )
      )
        throw new Error(
          "Testnet Duo canary must match an ordered Duo pair allowlist entry.",
        );
      return {
        kind: "duo",
        token,
        quoteAsset,
        secondaryQuote,
        routeHash: routeHash.toLowerCase() as Hash,
      };
    },
  );
  if (
    new Set(canaries.map((canary) => canary.token.toLowerCase())).size !==
    canaries.length
  )
    throw new Error("Testnet liquidity acceptance contains duplicate canary tokens.");
  if (!canaries.some((canary) => canary.kind === "single"))
    throw new Error("Testnet liquidity acceptance requires a Single V4 canary.");
  return { checkedAt, provider: "monad-testnet-onchain", canaries };
}

export function parseDeployment(value: unknown): Deployment {
  const data = object(value, "Deployment");
  const native = object(data.nativeCurrency, "nativeCurrency");
  const chainId = integer(data.chainId, "chainId");
  if (chainId === 0) throw new Error("chainId must be positive.");
  if (data.environment !== "local" && data.environment !== "configured")
    throw new Error("environment must be local or configured.");
  if (data.environment === "local" && chainId !== 31337)
    throw new Error("Local deployments require chain 31337.");
  const rpcUrl = url(data.rpcUrl, "rpcUrl");
  if (data.environment === "configured") {
    const publicRpc = new URL(rpcUrl);
    if (publicRpc.protocol !== "https:")
      throw new Error("Configured deployments require an HTTPS RPC URL.");
    const credentialShapedPath = publicRpc.pathname
      .split("/")
      .filter(Boolean)
      .some((segment) => segment.length >= 24);
    const credentialShapedHostname = publicRpc.hostname
      .split(".")
      .some((label) => label.length >= 24);
    if (
      publicRpc.search ||
      publicRpc.hash ||
      credentialShapedPath ||
      credentialShapedHostname
    )
      throw new Error(
        "Configured deployments require an anonymous public RPC URL.",
      );
  }
  if (data.environment === "configured" && chainId !== 143 && chainId !== 10143)
    throw new Error("Configured deployments require Monad mainnet 143 or testnet 10143.");
  if (native.symbol !== "MON" || native.decimals !== 18)
    throw new Error("Monad native currency must be MON with 18 decimals.");
  const startBlock = String(data.startBlock);
  if (
    !/^\d+$/.test(startBlock) ||
    (typeof data.startBlock === "number" &&
      !Number.isSafeInteger(data.startBlock))
  )
    throw new Error(
      "startBlock must be a nonnegative integer or decimal string.",
    );
  if (!Array.isArray(data.quoteAssets) || !data.quoteAssets.length)
    throw new Error("At least one quote asset is required.");
  const quoteAssets = data.quoteAssets.map((value, i) => {
    const item = object(value, `quoteAssets[${i}]`);
    if (
      item.category !== undefined &&
      item.category !== "crypto" &&
      item.category !== "stock"
    )
      throw new Error("Invalid quote category.");
    if (item.mock !== undefined && typeof item.mock !== "boolean")
      throw new Error("Quote asset mock flag must be boolean.");
    const metadata: Pick<QuoteAsset, "name" | "logoUrl" | "logoBackground"> =
      {};
    if (item.logoBackground !== undefined) {
      if (item.logoBackground !== "light" && item.logoBackground !== "dark")
        throw new Error("Invalid logo background.");
      metadata.logoBackground = item.logoBackground;
    }
    if (item.name !== undefined) {
      metadata.name = text(item.name, "quote name");
      if (metadata.name.length > 160)
        throw new Error("Quote name is too long.");
    }
    if (item.logoUrl !== undefined) {
      const logo = text(item.logoUrl, "quote logo");
      if (
        /^\/(stock-logos|crypto-logos|brand)\/[a-z0-9_-]+\.(png|webp|svg)$/.test(
          logo,
        )
      )
        metadata.logoUrl = logo;
      else {
        const parsed = new URL(url(logo, "quote logo"));
        if (parsed.protocol !== "https:")
          throw new Error("Quote logo must use HTTPS.");
        metadata.logoUrl = parsed.toString();
      }
    }
    return {
      address: address(item.address, "quote asset", true),
      symbol: text(item.symbol, "quote symbol"),
      decimals: integer(item.decimals, "quote decimals", 36),
      mock: item.mock as boolean | undefined,
      ...(item.category
        ? { category: item.category as "crypto" | "stock" }
        : {}),
      ...metadata,
    };
  });
  if (
    new Set(quoteAssets.map((q) => q.address.toLowerCase())).size !==
    quoteAssets.length
  )
    throw new Error("Duplicate quote asset addresses.");
  for (const quote of quoteAssets)
    if (quote.address === zeroAddress && (quote.symbol !== "MON" || quote.decimals !== 18))
      throw new Error("Native Monad quotes must use MON with 18 decimals.");
  const optionalAddresses: Partial<Deployment> = {};
  for (const key of [
    "launchRouter",
    "stakingFactory",
    "duoExecutor",
    "paymentRouter",
    "treasury",
    "locker",
    "graduationExecutor",
    "dividendFactory",
    "weth",
    "permit2",
  ] as const) {
    if (data[key] !== undefined)
      optionalAddresses[key] = address(data[key], key);
  }
  const payments =
    data.payments === undefined
      ? undefined
      : parsePaymentConfiguration(data.payments);
  assertMonadPaymentDependencies({
    chainId,
    environment: data.environment,
    ...(payments ? { payments } : {}),
  });
  if (data.environment === "configured" && chainId === 143)
    for (const asset of [...quoteAssets, ...(payments?.assets ?? [])])
      assertMonadAssetIdentity(asset);
  if (payments && optionalAddresses.weth && payments.weth.toLowerCase() !== optionalAddresses.weth.toLowerCase())
    throw new Error("Wrapped native MON addresses disagree.");
  const paymentRouter = optionalAddresses.paymentRouter;
  if (
    paymentRouter &&
    payments &&
    paymentRouter.toLowerCase() !== payments.router.toLowerCase()
  )
    throw new Error("Payment router addresses disagree.");
  let duoPairs: DuoPair[] | undefined;
  if (data.duoPairs !== undefined) {
    if (!Array.isArray(data.duoPairs) || data.duoPairs.length > 256)
      throw new Error("Duo pair allowlist must contain at most 256 pairs.");
    if (data.duoPairs.length > 0 && !optionalAddresses.duoExecutor)
      throw new Error("Duo pair allowlist requires a Duo executor.");
    if (data.duoPairs.length > 0 && !payments)
      throw new Error("Duo pair allowlist requires payment routes.");
    const quoteAddresses = new Set(
      quoteAssets.map((quote) => quote.address.toLowerCase()),
    );
    duoPairs = data.duoPairs.map((value, index) => {
      const item = object(value, `duoPairs[${index}]`);
      const primaryQuote = address(
        item.primaryQuote,
        `duoPairs[${index}].primaryQuote`,
        true,
      );
      const secondaryQuote = address(
        item.secondaryQuote,
        `duoPairs[${index}].secondaryQuote`,
        true,
      );
      if (
        primaryQuote.toLowerCase() === secondaryQuote.toLowerCase() ||
        !quoteAddresses.has(primaryQuote.toLowerCase()) ||
        !quoteAddresses.has(secondaryQuote.toLowerCase())
      )
        throw new Error(
          "Duo pair endpoints must be two different configured quote assets.",
        );
      if (!findPaymentRoute(payments!, secondaryQuote, primaryQuote))
        throw new Error(
          "Duo pair needs an exact typed secondary-to-primary payment route.",
        );
      return { primaryQuote, secondaryQuote };
    });
    if (
      new Set(
        duoPairs.map(
          (pair) =>
            `${pair.primaryQuote.toLowerCase()}:${pair.secondaryQuote.toLowerCase()}`,
        ),
      ).size !== duoPairs.length
    )
      throw new Error("Duplicate Duo pair allowlist entry.");
  }
  let security: DeploymentSecurity | undefined;
  if (data.security !== undefined) {
    const roles = object(data.security, "security");
    let protocolBuyback: DeploymentSecurity["protocolBuyback"];
    if (roles.protocolBuyback !== undefined) {
      const buyback = object(roles.protocolBuyback, "security.protocolBuyback");
      protocolBuyback = {
        token: address(buyback.token, "security.protocolBuyback.token"),
        executor: address(
          buyback.executor,
          "security.protocolBuyback.executor",
        ),
      };
    }
    security = {
      deploymentAuthority: address(
        roles.deploymentAuthority,
        "security.deploymentAuthority",
      ),
      governance: address(roles.governance, "security.governance"),
      keeperOperator: address(roles.keeperOperator, "security.keeperOperator"),
      opsRecipient: address(roles.opsRecipient, "security.opsRecipient"),
      permissionless: boolean(roles.permissionless, "security.permissionless"),
      ...(protocolBuyback ? { protocolBuyback } : {}),
    };
  }
  let publication: PublicationPolicy | undefined;
  if (data.publication !== undefined) {
    const policy = object(data.publication, "publication");
    const confirmationDepth = integer(
      policy.confirmationDepth,
      "publication.confirmationDepth",
      4_096,
    );
    if (confirmationDepth === 0)
      throw new Error(
        "publication.confirmationDepth must be greater than zero.",
      );
    const primaryRpcProvider = rpcProvider(
      policy.primaryRpcProvider,
      "publication.primaryRpcProvider",
    );
    const secondaryRpcProvider = rpcProvider(
      policy.secondaryRpcProvider,
      "publication.secondaryRpcProvider",
    );
    if (primaryRpcProvider === secondaryRpcProvider)
      throw new Error("Publication RPC providers must be independent.");
    publication = {
      confirmationDepth,
      primaryRpcProvider,
      secondaryRpcProvider,
    };
  }
  const hasDuoPairs = (duoPairs?.length ?? 0) > 0;
  const closedTestnetDuo =
    data.environment === "configured" &&
    chainId === 10143 &&
    security?.permissionless === false;
  const closedConfiguredStaging =
    data.environment === "configured" &&
    security?.permissionless === false &&
    !hasDuoPairs;
  if (data.environment === "configured" && payments && !paymentRouter)
    throw new Error(
      "Configured deployments require paymentRouter and payments together.",
    );
  if (
    data.environment === "configured" &&
    paymentRouter &&
    !payments &&
    !closedConfiguredStaging
  )
    throw new Error(
      "Configured deployments require paymentRouter and payments together.",
    );
  if (
    data.environment === "configured" &&
    (hasDuoPairs ||
      (security?.permissionless && optionalAddresses.duoExecutor)) &&
    (!paymentRouter || !payments)
  )
    throw new Error(
      "Permissionless or published Duo deployments require paymentRouter and payments together.",
    );
  if (
    data.environment === "configured" &&
    optionalAddresses.duoExecutor &&
    !payments &&
    !closedConfiguredStaging
  )
    throw new Error("Configured Duo requires payments.");
  if (
    data.environment === "configured" &&
    optionalAddresses.duoExecutor &&
    !hasDuoPairs &&
    !closedConfiguredStaging
  )
    throw new Error(
      "Configured Duo requires a route-backed Duo pair allowlist.",
    );
  if (chainId === 10143 && data.liquidityAcceptance !== undefined)
    throw new Error("Fomo liquidity acceptance is supported only on Monad mainnet 143.");
  const liquidityAcceptance =
    data.liquidityAcceptance === undefined
      ? undefined
      : parseLiquidityAcceptance(
          data.liquidityAcceptance,
          chainId,
          quoteAssets,
          duoPairs ?? [],
        );
  if (
    data.testnetLiquidityAcceptance !== undefined &&
    (chainId !== 10143 || data.environment !== "configured")
  )
    throw new Error(
      "Testnet liquidity acceptance requires configured Monad testnet 10143.",
    );
  const testnetLiquidityAcceptance =
    data.testnetLiquidityAcceptance === undefined
      ? undefined
      : parseTestnetLiquidityAcceptance(
          data.testnetLiquidityAcceptance,
          quoteAssets,
          duoPairs ?? [],
        );
  const canaryAcceptance =
    chainId === 10143 ? testnetLiquidityAcceptance : liquidityAcceptance;
  if (
    data.environment === "configured" &&
    security?.permissionless &&
    !canaryAcceptance
  )
    throw new Error(
      "Configured permissionless launches require liquidity acceptance evidence.",
    );
  if (
    data.environment === "configured" &&
    hasDuoPairs &&
    !canaryAcceptance &&
    !closedTestnetDuo
  )
    throw new Error(
      "Every published Duo pair requires its own route-bound V4 liquidity canary.",
    );
  if (
    data.environment === "configured" &&
    (security?.permissionless || testnetLiquidityAcceptance)
  ) {
    for (const quote of quoteAssets)
      if (
        !canaryAcceptance?.canaries.some(
          (canary) =>
            canary.kind === "single" &&
            canary.quoteAsset.toLowerCase() === quote.address.toLowerCase(),
        )
      )
        throw new Error(
          `Configured permissionless quote ${quote.symbol} requires its own Single V4 liquidity canary.`,
        );
  }
  if (
    data.environment === "configured" &&
    (!closedTestnetDuo || testnetLiquidityAcceptance)
  )
    for (const pair of duoPairs ?? [])
      if (
        !canaryAcceptance?.canaries.some(
          (canary) =>
            canary.kind === "duo" &&
            canary.quoteAsset.toLowerCase() ===
              pair.primaryQuote.toLowerCase() &&
            canary.secondaryQuote.toLowerCase() ===
              pair.secondaryQuote.toLowerCase(),
        )
      )
        throw new Error(
          "Every published Duo pair requires its own route-bound V4 liquidity canary.",
        );
  const deployment: Deployment = {
    chainId,
    ...(data.chainName === undefined
      ? {}
      : { chainName: brandedChainName(text(data.chainName, "chainName")) }),
    rpcUrl,
    ...(data.explorerUrl === undefined
      ? {}
      : { explorerUrl: url(data.explorerUrl, "explorerUrl") }),
    nativeCurrency: {
      name: text(native.name, "native name"),
      symbol: text(native.symbol, "native symbol"),
      decimals: integer(native.decimals, "native decimals", 36),
    },
    factory: address(data.factory, "factory"),
    feeVault: address(data.feeVault, "feeVault"),
    buybackVault: address(data.buybackVault, "buybackVault"),
    poolManager: address(data.poolManager, "poolManager"),
    positionManager: address(data.positionManager, "positionManager"),
    hook: address(data.hook, "hook"),
    swapRouter: address(data.swapRouter, "swapRouter"),
    startBlock,
    quoteAssets,
    environment: data.environment,
    ...(security ? { security } : {}),
    ...(publication ? { publication } : {}),
    ...(liquidityAcceptance ? { liquidityAcceptance } : {}),
    ...(testnetLiquidityAcceptance ? { testnetLiquidityAcceptance } : {}),
    ...optionalAddresses,
    ...(payments ? { payments } : {}),
    ...(duoPairs ? { duoPairs } : {}),
  };
  assertMonadDeploymentDependencies(deployment);
  if (data.legacyDeployments !== undefined) {
    if (
      !Array.isArray(data.legacyDeployments) ||
      data.legacyDeployments.length > 8
    )
      throw new Error(
        "legacyDeployments must contain at most eight deployment bundles.",
      );
    if (
      data.environment === "configured" &&
      data.legacyDeployments.length !== 0
    )
      throw new Error(
        "Configured legacy deployments require versioned runtime evidence and cannot be published yet.",
      );
    const factories = new Set([deployment.factory.toLowerCase()]);
    const units = new Map(
      deployment.quoteAssets.map((quote) => [
        quote.address.toLowerCase(),
        quote.decimals,
      ]),
    );
    deployment.legacyDeployments = data.legacyDeployments.map(
      (value, index) => {
        const raw = object(value, `legacyDeployments[${index}]`);
        if (raw.legacyDeployments !== undefined)
          throw new Error(
            "Legacy deployment bundles must be flat, without nested registries.",
          );
        const legacy = parseDeployment(raw);
        if (
          legacy.chainId !== deployment.chainId ||
          legacy.environment !== deployment.environment ||
          new URL(legacy.rpcUrl).href !== new URL(deployment.rpcUrl).href ||
          legacy.nativeCurrency.name !== deployment.nativeCurrency.name ||
          legacy.nativeCurrency.symbol !== deployment.nativeCurrency.symbol ||
          legacy.nativeCurrency.decimals !== deployment.nativeCurrency.decimals
        )
          throw new Error(
            "Legacy deployments must use the same chain, RPC, environment and native currency.",
          );
        const factory = legacy.factory.toLowerCase();
        if (factories.has(factory))
          throw new Error("Duplicate deployment factory.");
        factories.add(factory);
        for (const quote of legacy.quoteAssets) {
          const key = quote.address.toLowerCase();
          if (units.has(key) && units.get(key) !== quote.decimals)
            throw new Error(
              "Shared quote assets must have matching decimals across deployments.",
            );
          units.set(key, quote.decimals);
        }
        return legacy;
      },
    );
  }
  if (data.duoGenerations !== undefined)
    deployment.duoGenerations = parseDuoGenerationRegistry(data.duoGenerations, deployment);
  return deployment;
}

export function quoteAsset(deployment: Deployment, asset: Address): QuoteAsset {
  const quote = deployment.quoteAssets.find(
    (q) => q.address.toLowerCase() === asset.toLowerCase(),
  );
  if (!quote)
    throw new Error(`Quote asset ${asset} is not present in this deployment.`);
  return quote;
}
