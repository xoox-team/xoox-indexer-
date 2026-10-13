import { deploymentVariants } from "./vendor/xoox-sdk/deployments";
import { parseDeployment, type Deployment } from "./vendor/xoox-sdk/config";
import { primaryDuoDeployment } from "./vendor/xoox-sdk/duo-generations";
import { isAddress, zeroAddress } from "viem";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  TRADE_DEX_CHAIN_ID,
  TRADE_DEX_SOURCES,
  TRADE_DEX_CONTRACTS,
  tradeDexSubscriptions,
} from "./trade-dex-registry";
import {
  CHAIN_ID as TERMINAL_ROUTER_CHAIN_ID,
  ROUTER as TERMINAL_ROUTER_ADDRESS,
  ROUTER_START as TERMINAL_ROUTER_START,
  TRADE_EVENT as TERMINAL_ROUTER_TRADE_EVENT,
} from "./terminal-feed/constants";
export const contracts = [
  ...TRADE_DEX_CONTRACTS,
  {
    name: "Factory",
    events: [
      { event: "DuoExecutorConfigured(address indexed executor)" },
      {
        event:
          "DuoConfigured(address indexed token,address indexed secondaryQuote)",
      },
      {
        event:
          "DuoLaunched(address indexed token,uint256 primaryAllocation,uint256 secondaryAllocation)",
      },
      {
        event:
          "DuoPoolRecorded(address indexed token,bytes32 indexed poolId,uint256 positionId)",
      },
      { event: "BuybackEnabledUpdated(address indexed token,bool enabled)" },
      {
        event:
          "HolderFeeSharingConfigured(address indexed token,address indexed vault,uint8 mode,uint16 baseShareBps,uint16 taxShareBps)",
      },
      {
        event:
          "FeeStrategySnapshotted(address indexed token,bool baseFeeEnabled,uint16 creatorBps,uint16 holderBps,uint16 burnBps,uint16 liquidityBps)",
      },
      {
        event:
          "LaunchStakingConfigured(address indexed token,address indexed pool,uint256 totalSupply,uint256 curveAllocation,uint256 rewardAmount,uint32 duration)",
      },
      {
        event:
          "TokenLaunched(address indexed token,address indexed curve,address indexed creator,address quoteAsset,uint256 configId)",
      },
      {
        event:
          "QuoteAssetUpdated(address indexed asset,bool approved,uint8 decimals)",
      },
      {
        event:
          "PairTokenEconomicsUpdated(address indexed asset,uint256 phantomQuote,uint256 graduationThreshold)",
      },
      {
        event:
          "GraduationSwept(address indexed token,uint256 quoteAmount,uint256 tokenAmount,uint256 sweptAt)",
      },
      {
        event:
          "Graduated(address indexed token,bytes32 indexed poolId,uint256 positionId,uint256 residualTokensLocked)",
      },
      {
        event:
          "Rescued(address indexed token,address indexed recipient,uint256 quoteAmount,uint256 tokenAmount)",
      },
      {
        event:
          "CreatorFeeRecipientUpdated(address indexed token,address indexed previousRecipient,address indexed recipient)",
      },
      {
        event:
          "LaunchEconomicsSnapshotted(address indexed token,uint256 supply,uint256 phantomQuote,uint256 graduationThreshold,uint16 baseBps,uint16 creatorTaxBps,uint16 protocolShareBps,uint16 buybackShareBps,bool buybackEnabled,address dividendVault,uint16 dividendShareBps)",
      },
    ],
  },
  {
    name: "LaunchRouter",
    events: [
      {
        event:
          "LaunchOptionsConfigured(address indexed token,uint16 buyTaxBps,uint16 sellTaxBps,uint256 minimumHolderBalance,address royaltySplitter,bytes32 optionsHash)",
      },
    ],
  },
  {
    name: "Curve",
    events: [
      {
        event:
          "CurveBuy(address indexed buyer,address indexed recipient,uint256 tokensOut,uint256 quoteSpent,uint256 quoteRefund,uint256 baseFee,uint256 creatorTax,uint256 snipeTax,uint256 realQuoteReserve,uint256 tokenReserve)",
      },
      {
        event:
          "CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 baseFee,uint256 creatorTax,uint256 realQuoteReserve,uint256 tokenReserve)",
      },
      {
        event:
          "CurveCompleted(address indexed token,uint256 quoteReserve,uint256 tokenReserve)",
      },
    ],
  },
  {
    name: "Token",
    events: [
      {
        event:
          "Transfer(address indexed from,address indexed to,uint256 value)",
      },
      {
        event:
          "TokenMetadata(string name,string symbol,string image,string description,string website,string twitter,string telegram,uint256 supply)",
      },
      { event: "LiquidityPoolSet(address indexed pool)" },
      { event: "DividendVaultSet(address indexed vault)" },
    ],
  },
  {
    name: "FeeVault",
    events: [
      {
        event:
          "FeeStrategyAllocated(address indexed token,address indexed asset,uint256 protocolAmount,uint256 creatorAmount,uint256 holderAmount,uint256 burnAmount,uint256 liquidityAmount)",
      },
      {
        event:
          "BurnProcessed(address indexed token,uint256 quoteSpent,uint256 tokensBurned,uint256 quoteRemaining)",
      },
      {
        event:
          "LiquidityProcessed(address indexed token,uint256 indexed positionId,uint256 quoteSpent,uint256 tokensBought,uint256 tokensUsed,uint128 liquidityAdded,uint256 quoteRemaining,uint256 tokensRemaining)",
      },
      { event: "BuybackExecutorConfigured(address indexed executor)" },
      {
        event:
          "FeeCredited(address indexed token,address indexed asset,address indexed beneficiary,uint256 amount)",
      },
      {
        event:
          "Claimed(address indexed token,address indexed asset,address indexed beneficiary,uint256 amount)",
      },
      {
        event:
          "HolderDividendFunded(address indexed token,address indexed dividendVault,address indexed asset,uint256 amount)",
      },
    ],
  },
  {
    name: "DividendVault",
    events: [
      { event: "RewardsDeposited(uint256 indexed epoch,uint256 amount)" },
      {
        event:
          "DividendClaimed(uint256 indexed epoch,address indexed beneficiary,uint256 amount)",
      },
      {
        event:
          "EmptyEpochRolledOver(uint256 indexed sourceEpoch,uint256 indexed targetEpoch,uint256 amount)",
      },
    ],
  },
  {
    name: "OgDividendVault",
    events: [
      { event: "OgHolderDisqualified(address indexed account)" },
      { event: "OgRewardsDeposited(uint256 amount)" },
      { event: "OgRewardsAllocated(uint256 amount,uint256 eligibleSupply)" },
      {
        event: "OgDividendClaimed(address indexed beneficiary,uint256 amount)",
      },
    ],
  },
  {
    name: "Hook",
    events: [
      { event: "PoolRegistered(bytes32 indexed poolId,address indexed token)" },
      {
        event:
          "HookFeesAccrued(address indexed token,address indexed asset,uint256 baseFee,uint256 creatorTax)",
      },
    ],
  },
  {
    name: "SwapRouter",
    events: [
      {
        event:
          "PoolTrade(address indexed token,address indexed trader,address indexed recipient,bool buy,uint256 amountIn,uint256 amountOut)",
      },
      {
        event:
          "DuoPoolTrade(address indexed token,address indexed trader,bytes32 indexed poolId,address recipient,address quoteAsset,bool buy,uint256 amountIn,uint256 amountOut)",
      },
    ],
  },
  {
    name: "PaymentRouter",
    events: [
      {
        event:
          "RoutedTrade(address indexed token,address indexed trader,address indexed paymentAsset,bool buy,uint8 phase,uint256 quoteAmount,uint256 tokenAmount,uint256 paymentAmount,address refundAsset,uint256 refundAmount)",
      },
    ],
  },
  {
    name: "PoolManager",
    events: [
      {
        event:
          "Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
      },
      {
        event:
          "Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
      },
      {
        event:
          "ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
      },
    ],
  },
  {
    name: "Treasury",
    events: [
      {
        event:
          "IncomeAllocated(address indexed asset,uint256 received,uint256 buybackAmount,uint256 opsAmount)",
      },
      {
        event:
          "OpsClaimed(address indexed asset,address indexed recipient,uint256 amount)",
      },
      {
        event:
          "ProtocolBuybackProcessed(address indexed quoteAsset,uint256 quoteSpent,uint256 tokensLocked,uint256 unspent)",
      },
    ],
  },
  {
    name: "ProFactory",
    events: [
      {
        event:
          "GraduationInfrastructureConfigured(address indexed registry,bytes32 codeHash)",
      },
      {
        event:
          "LaunchCreated(address indexed creator,address indexed token,address indexed curveAddress,address policy,uint256 supply,bytes32 configurationHash,bytes32 launchSalt,(string name,string symbol,string description,string image,string website,string twitter,string telegram) metadata,(address quoteAsset,uint256 phantomQuote,uint256 graduationThreshold,uint16 baseFeeBps,uint16 buyTaxBps,uint16 sellTaxBps,bool perpetual,address feeRecipient) curveConfig,(uint8 rule,bytes data)[] rules,address[] walletExemptions,bytes32 requestedSalt,uint64 deadline)",
      },
    ],
  },
  {
    name: "ProSwapRouter",
    events: [
      {
        event:
          "ProPoolTrade(address indexed token,address indexed trader,bytes32 indexed poolId,address recipient,address quoteAsset,bool buy,uint256 amountSpent,uint256 amountOut)",
      },
    ],
  },
  {
    name: "ProCurve",
    events: [
      {
        event:
          "ProBuy(address indexed buyer,address indexed recipient,uint256 tokensOut,uint256 spent,uint256 refund,uint256 fees)",
      },
      {
        event:
          "ProSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fees)",
      },
      {
        event:
          "CurveCompleted(address indexed token,uint256 quoteReserve,uint256 tokenReserve)",
      },
      { event: "FeesSwept(address indexed recipient,uint256 amount)" },
    ],
  },
  {
    name: "ProToken",
    events: [
      {
        event:
          "Transfer(address indexed from,address indexed to,uint256 value)",
      },
    ],
  },
  {
    name: "ProPolicy",
    events: [
      { event: "WalletRegistered(address indexed wallet)" },
      {
        event:
          "RulesDeactivated(address indexed token,address indexed registry)",
      },
    ],
  },
  {
    name: "ProConsentRegistry",
    events: [
      {
        event:
          "ReactiveParticipantRegistered(bytes32 indexed participantId,address indexed token,address indexed creator,bytes32 configurationHash,uint8 role,bytes32 participantSalt)",
      },
      {
        event:
          "ParticipantNonceAdvanced(bytes32 indexed participantId,address indexed creator,uint256 nonce)",
      },
      {
        event:
          "ReactiveConsentFinalized(bytes32 indexed finalPairId,bytes32 indexed participantId0,bytes32 indexed participantId1,address token0,address token1,address creator0,address creator1,uint256 nonce0,uint256 nonce1)",
      },
    ],
  },
  {
    name: "ProGraduationRegistry",
    events: [
      {
        event:
          "GraduatingLaunchRegistered(address indexed token,address indexed curve,address indexed policy,bytes32 configurationHash,bytes32 poolId)",
      },
      {
        event:
          "ReservesRecorded(address indexed token,uint256 quoteAmount,uint256 tokenAmount)",
      },
      { event: "GraduationPending(address indexed token,bytes reason)" },
      {
        event:
          "GraduationCompleted(address indexed token,bytes32 indexed poolId,uint256 indexed positionId,uint128 liquidity,uint256 quoteUsed,uint256 tokensUsed)",
      },
    ],
  },
  { name: "TerminalRouter", events: [{ event: TERMINAL_ROUTER_TRADE_EVENT }] },
];
/** Opt-in subscription to the terminal router's Trade events. The TradeFeed row builder accepts no other emitter, so the identity is pinned. */
export type TerminalRouterSource = Readonly<{
  chainId: number;
  address: string;
  startBlock: string;
}>;
export const TERMINAL_ROUTER_SOURCE: TerminalRouterSource = Object.freeze({
  chainId: TERMINAL_ROUTER_CHAIN_ID,
  address: TERMINAL_ROUTER_ADDRESS,
  startBlock: String(TERMINAL_ROUTER_START),
});
/** Trusted operator input, selected from reviewed Pro deployment records. Never discover factories from RPC or user drafts. */
export type ProIndexerSource = Readonly<{
  chainId: number;
  factory: string;
  startBlock: string;
  poolRouter?: string;
  /** Static opt-in only; every event still requires the private reviewed v3 source effect. */
  consentRegistry?: string;
}>;
export function envioConfiguration(
  deployment?: Deployment,
  proSources: readonly ProIndexerSource[] = [],
  terminalRouter?: TerminalRouterSource,
) {
  const sources = deployment ? deploymentVariants(deployment) : [];
  const start = sources.length
    ? Math.min(...sources.map((source) => Number(source.startBlock)))
    : 0;
  if (!Number.isSafeInteger(start))
    throw new Error(
      "Envio config generation requires a safe integer startBlock.",
    );
  const addresses = (pick: (source: Deployment) => string | undefined) => [
    ...new Map(
      sources.flatMap((source) => {
        const value = pick(source);
        return value ? [[value.toLowerCase(), value] as const] : [];
      }),
    ).values(),
  ];
  const chainId = deployment?.chainId ?? 143;
  if (
    terminalRouter !== undefined &&
    (chainId !== TERMINAL_ROUTER_SOURCE.chainId ||
      terminalRouter.chainId !== chainId ||
      terminalRouter.address.toLowerCase() !== TERMINAL_ROUTER_SOURCE.address ||
      terminalRouter.startBlock !== TERMINAL_ROUTER_SOURCE.startBlock)
  )
    throw new Error(
      "Terminal router source requires its reviewed router, start block and chain.",
    );
  const proFactories = new Map<string, string>();
  const proRouters = new Map<string, { address: string; factory: string }>();
  const factoryRouters = new Map<string, string | undefined>();
  const consentRegistries = new Map<
    string,
    { address: string; factory: string }
  >();
  const factoryConsents = new Map<string, string | undefined>();
  let proStart = start;
  for (const source of proSources) {
    if (
      !source ||
      typeof source !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(source)) ||
      Reflect.ownKeys(source).some(
        (key) =>
          typeof key !== "string" ||
          ![
            "chainId",
            "factory",
            "startBlock",
            "poolRouter",
            "consentRegistry",
          ].includes(key) ||
          !("value" in Object.getOwnPropertyDescriptor(source, key)!),
      ) ||
      !Number.isSafeInteger(source.chainId) ||
      source.chainId <= 0 ||
      source.chainId !== chainId ||
      typeof source.factory !== "string" ||
      !isAddress(source.factory, { strict: true }) ||
      source.factory.toLowerCase() === zeroAddress ||
      typeof source.startBlock !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(source.startBlock) ||
      !Number.isSafeInteger(Number(source.startBlock)) ||
      (Object.hasOwn(source, "poolRouter") &&
        (typeof source.poolRouter !== "string" ||
          !isAddress(source.poolRouter, { strict: true }) ||
          source.poolRouter.toLowerCase() === zeroAddress)) ||
      (Object.hasOwn(source, "consentRegistry") &&
        (typeof source.consentRegistry !== "string" ||
          !isAddress(source.consentRegistry, { strict: true }) ||
          source.consentRegistry.toLowerCase() === zeroAddress))
    )
      throw new Error(
        "Pro indexer sources require a configured factory, matching chain and safe start block.",
      );
    if (
      sources.some(
        (legacy) =>
          legacy.factory.toLowerCase() === source.factory.toLowerCase(),
      )
    )
      throw new Error(
        "Pro and legacy Factory subscriptions must have distinct addresses.",
      );
    const key = source.factory.toLowerCase();
    const router = source.poolRouter?.toLowerCase();
    if (factoryRouters.has(key) && factoryRouters.get(key) !== router)
      throw new Error("Pro factory pool Router configuration is ambiguous.");
    factoryRouters.set(key, router);
    const consent = source.consentRegistry?.toLowerCase();
    if (factoryConsents.has(key) && factoryConsents.get(key) !== consent)
      throw new Error(
        "Pro factory consent Registry configuration is ambiguous.",
      );
    factoryConsents.set(key, consent);
    if (consent) {
      const previous = consentRegistries.get(consent);
      if (previous && previous.factory !== key)
        throw new Error(
          "One Pro consent Registry cannot be paired with multiple factories.",
        );
      consentRegistries.set(consent, {
        address: source.consentRegistry!,
        factory: key,
      });
    }
    if (router) {
      const previous = proRouters.get(router);
      if (previous && previous.factory !== key)
        throw new Error(
          "One Pro pool Router cannot be paired with multiple factories.",
        );
      proRouters.set(router, { address: source.poolRouter!, factory: key });
    }
    proFactories.set(key, source.factory);
    proStart = Math.min(proStart, Number(source.startBlock));
  }
  for (const [router] of proRouters) {
    if (
      proFactories.has(router) ||
      sources.some((legacy) =>
        [legacy.factory, legacy.swapRouter].some(
          (value) => value?.toLowerCase() === router,
        ),
      )
    )
      throw new Error(
        "Pro pool Router must be distinct from Pro/legacy Factory and legacy SwapRouter addresses.",
      );
  }
  for (const [registry] of consentRegistries) {
    if (
      proFactories.has(registry) ||
      proRouters.has(registry) ||
      sources.some((legacy) =>
        Object.values(legacy).some(
          (value) =>
            typeof value === "string" &&
            isAddress(value) &&
            value.toLowerCase() === registry,
        ),
      )
    )
      throw new Error(
        "Pro consent Registry must be distinct from Pro/legacy infrastructure.",
      );
  }
  return {
    name: "xoox",
    description: "XOOX canonical launch, trade, fee and dividend events",
    schema: "schema.graphql",
    handlers: "src/handlers",
    address_format: "lowercase",
    field_selection: { transaction_fields: ["hash"] },
    contracts,
    chains: [
      {
        id: chainId,
        start_block:
          chainId === TRADE_DEX_CHAIN_ID && deployment
            ? Math.min(
                proStart,
                ...TRADE_DEX_SOURCES.map((source) => Number(source.startBlock)),
              )
            : proStart,
        ...(!deployment ? { skip: true } : {}),
        ...(deployment
          ? {
              rpc: [
                {
                  url: deployment.rpcUrl,
                  for: "sync",
                  initial_block_interval:
                    chainId === TRADE_DEX_CHAIN_ID ? 100 : 500,
                  interval_ceiling:
                    chainId === TRADE_DEX_CHAIN_ID ? 100 : 2_000,
                  ...(chainId === TRADE_DEX_CHAIN_ID
                    ? { acceleration_additive: 0 }
                    : {}),
                  backoff_millis: 1_000,
                  query_timeout_millis: 20_000,
                  polling_interval: 2_000,
                },
              ],
            }
          : {}),
        max_reorg_depth: 128,
        contracts: [
          ...tradeDexSubscriptions(chainId),
          { name: "Factory", address: addresses((d) => d.factory) },
          { name: "Curve", address: [] },
          { name: "Token", address: [] },
          { name: "FeeVault", address: addresses((d) => d.feeVault) },
          { name: "DividendVault", address: [] },
          { name: "Hook", address: addresses((d) => d.hook) },
          { name: "SwapRouter", address: addresses((d) => d.swapRouter) },
          { name: "PoolManager", address: addresses((d) => d.poolManager) },
          { name: "Treasury", address: addresses((d) => d.treasury) },
          {
            name: "PaymentRouter",
            address: addresses((d) => d.payments?.router),
          },
          { name: "OgDividendVault", address: [] },
          { name: "LaunchRouter", address: addresses((d) => d.launchRouter) },
          { name: "ProFactory", address: [...proFactories.values()] },
          {
            name: "ProSwapRouter",
            address: [...proRouters.values()].map((source) => source.address),
          },
          { name: "ProCurve", address: [] },
          { name: "ProToken", address: [] },
          { name: "ProPolicy", address: [] },
          { name: "ProGraduationRegistry", address: [] },
          {
            name: "ProConsentRegistry",
            address: [...consentRegistries.values()].map(
              (source) => source.address,
            ),
          },
          {
            name: "TerminalRouter",
            address: terminalRouter ? [TERMINAL_ROUTER_ADDRESS] : [],
            ...(terminalRouter
              ? { start_block: Number(terminalRouter.startBlock) }
              : {}),
          },
        ].map((contract) =>
          chainId === TRADE_DEX_CHAIN_ID &&
          contract.address.length &&
          !contract.name.startsWith("TradeV") &&
          contract.name !== "TerminalRouter"
            ? { ...contract, start_block: proStart }
            : contract,
        ),
      },
    ],
  };
}

/** Generate a runnable public testnet config only after read-only onchain verification. */
export async function verifiedTestnetConfiguration(
  raw: unknown,
  verify: (deployment: Deployment) => Promise<unknown>,
  proSources: readonly ProIndexerSource[] = [],
) {
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { chainId?: unknown }).chainId !== 10143
  )
    throw new Error(
      "Envio testnet configuration requires a Monad 10143 manifest.",
    );
  const deployment = parseDeployment(raw);
  if (deployment.environment !== "configured")
    throw new Error(
      "Envio testnet configuration requires a configured deployment.",
    );
  // Preserve the ordinary manifest/public RPC/Pro-source validation before any
  // network preflight. This projection cannot authorize successor subscriptions.
  envioConfiguration(primaryDuoDeployment(deployment), proSources);
  await verify(deployment);
  // A generation registry's authority is issued privately for this exact parsed
  // object. Generate the union only after its verifier has completed admission.
  const config = envioConfiguration(deployment, proSources);
  config.name = "xoox-monad-testnet";
  for (const rpc of config.chains[0]!.rpc ?? []) rpc.for = "fallback";
  return config;
}

export async function writeVerifiedTestnetConfiguration(
  raw: unknown,
  outputPath: string,
  verify: (deployment: Deployment) => Promise<unknown>,
  proSources: readonly ProIndexerSource[] = [],
): Promise<void> {
  if (basename(outputPath) !== "config.testnet.yaml")
    throw new Error(
      "Testnet configuration output must be config.testnet.yaml.",
    );
  const config = await verifiedTestnetConfiguration(raw, verify, proSources);
  await writeFile(outputPath, JSON.stringify(config, null, 2) + "\n");
}
