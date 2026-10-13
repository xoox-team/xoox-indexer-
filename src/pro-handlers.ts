import {
  createEffect,
  indexer,
  S,
  type EvmOnEventContext,
  type ProLaunch,
} from "envio";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  isAddress,
  zeroAddress,
  type Hex,
} from "viem";
import { proFactoryAbi } from "./vendor/xoox-sdk/pro-token";
import { loadProPoolRouterSource } from "./pro-pool-router-source";
import { activateProHolderLedger } from "./pro-holder-handlers";
import {
  loadProConsentSource,
  proConsentContractConfigured,
  proStandardIndexerContractsConfigured,
  proHolderContractConfigured,
} from "./pro-consent-source";

const consentParticipantSchema = {
  id: S.string,
  creator: S.string,
  token: S.string,
  configurationHash: S.string,
  role: S.int32,
  nonce: S.bigint,
  partnerId: S.string,
  finalPairId: S.string,
  finalized: S.boolean,
};
const consentPairSchema = {
  id: S.string,
  participantId0: S.string,
  participantId1: S.string,
  token0: S.string,
  token1: S.string,
  configurationHash0: S.string,
  configurationHash1: S.string,
  creator0: S.string,
  creator1: S.string,
};
const proConsentSourceEffect = createEffect(
  {
    name: "canonicalReviewedProConsentSourceV3",
    input: {
      registry: S.string,
      blockNumber: S.bigint,
      blockHash: S.string,
      timestamp: S.bigint,
      participantIds: S.array(S.string),
    },
    output: S.schema({
      factory: S.string,
      helper: S.string,
      registry: S.string,
      reviewId: S.string,
      participants: S.array(S.schema(consentParticipantSchema)),
      pairs: S.array(S.schema(consentPairSchema)),
    }),
    rateLimit: { calls: 5, per: "second" },
    crossChain: false,
    cache: true,
  },
  async ({ input, context }) => {
    const value = await loadProConsentSource(context.chain.id, input);
    return {
      ...value,
      participants: [...value.participants],
      pairs: [...value.pairs],
    };
  },
);

const proPoolRouterSourceEffect = createEffect(
  {
    name: "canonicalProPoolRouterBindingV1",
    input: {
      factory: S.string,
      registry: S.string,
      router: S.string,
      blockNumber: S.bigint,
      blockHash: S.string,
      timestamp: S.bigint,
    },
    output: S.schema({
      factory: S.string,
      registry: S.string,
      infrastructure: S.array(S.string),
    }),
    rateLimit: { calls: 5, per: "second" },
    crossChain: false,
    cache: true,
  },
  async ({ input, context }) => {
    const source = await loadProPoolRouterSource(context.chain.id, input);
    return { ...source, infrastructure: [...source.infrastructure] };
  },
);

type EventIdentity = {
  chainId: number;
  srcAddress: string;
  block: { number: number; timestamp: number; hash: string };
  transaction: { hash: string };
  logIndex: number;
};
const lower = (value: string) => value.toLowerCase();
const same = (left: string, right: string) => lower(left) === lower(right);
export const proLaunchId = (chainId: number, token: string) =>
  `${chainId}:${lower(token)}`;
const componentId = proLaunchId;
const eventId = (event: EventIdentity) =>
  `${event.chainId}:${lower(event.transaction.hash)}:${event.logIndex}`;
function ensure(valid: boolean, message: string): asserts valid {
  if (!valid) throw new Error(`Pro index: ${message}`);
}
function provenance(event: EventIdentity) {
  ensure(
    Number.isSafeInteger(event.block.number) &&
      event.block.number >= 0 &&
      Number.isSafeInteger(event.block.timestamp) &&
      event.block.timestamp >= 0 &&
      Number.isSafeInteger(event.logIndex) &&
      event.logIndex >= 0 &&
      /^0x[\da-fA-F]{64}$/.test(event.block.hash) &&
      /^0x[\da-fA-F]{64}$/.test(event.transaction.hash),
    "event provenance is unavailable.",
  );
  return {
    blockNumber: BigInt(event.block.number),
    blockHash: lower(event.block.hash),
    timestamp: BigInt(event.block.timestamp),
    transactionHash: lower(event.transaction.hash),
    logIndex: event.logIndex,
  };
}
async function once(context: EvmOnEventContext, event: EventIdentity) {
  provenance(event);
  const id = eventId(event);
  if (await context.ProProcessedEvent.get(id)) return false;
  context.ProProcessedEvent.set({ id });
  return true;
}
function metrics(
  launch: Pick<
    ProLaunch,
    | "phantomQuote"
    | "realQuoteReserve"
    | "tokenReserve"
    | "supply"
    | "perpetual"
    | "graduationThreshold"
  >,
) {
  const virtual = launch.phantomQuote + launch.realQuoteReserve;
  return {
    priceQuoteX18:
      launch.tokenReserve > 0n
        ? (virtual * 10n ** 36n) / launch.tokenReserve
        : undefined,
    marketCapQuote:
      launch.tokenReserve > 0n
        ? (virtual * launch.supply) / launch.tokenReserve
        : undefined,
    progressBps: launch.perpetual
      ? undefined
      : (launch.realQuoteReserve * 10_000n) / launch.graduationThreshold,
  };
}
async function componentLaunch(
  context: EvmOnEventContext,
  event: EventIdentity,
  kind: "curve" | "policy",
) {
  const component = await context.ProComponent.get(
    componentId(event.chainId, event.srcAddress),
  );
  ensure(component?.kind === kind, `unregistered ${kind} event source.`);
  const launch = await context.ProLaunch.get(component.launchId);
  ensure(
    Boolean(launch) &&
      launch!.chainId === event.chainId &&
      same(launch!.factory, component.factory) &&
      same(launch![kind], event.srcAddress),
    `${kind} source differs from its factory launch.`,
  );
  return launch!;
}
async function registryLaunch(
  context: EvmOnEventContext,
  event: EventIdentity,
  token: string,
) {
  const launch = await context.ProLaunch.get(proLaunchId(event.chainId, token));
  const infrastructure = await context.ProInfrastructure.get(
    componentId(event.chainId, event.srcAddress),
  );
  ensure(
    Boolean(launch && infrastructure) &&
      !launch!.perpetual &&
      same(launch!.factory, infrastructure!.factory) &&
      Boolean(launch!.graduationRegistry) &&
      same(launch!.graduationRegistry!, event.srcAddress),
    "graduation event differs from the factory-installed registry.",
  );
  return launch!;
}
function graduationRow(event: EventIdentity, launch: ProLaunch, kind: string) {
  return {
    id: eventId(event),
    launchId: launch.id,
    chainId: event.chainId,
    token: launch.token,
    factory: launch.factory,
    registry: lower(event.srcAddress),
    kind,
    quoteAmount: undefined,
    tokenAmount: undefined,
    poolId: undefined,
    positionId: undefined,
    liquidity: undefined,
    reason: undefined,
    ...provenance(event),
  };
}

if (proStandardIndexerContractsConfigured()) {
  indexer.contractRegister(
    { contract: "ProFactory", event: "GraduationInfrastructureConfigured" },
    async ({ event, context }) =>
      context.chain.ProGraduationRegistry.add(event.params.registry),
  );
  indexer.onEvent(
    { contract: "ProFactory", event: "GraduationInfrastructureConfigured" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const id = componentId(event.chainId, event.params.registry);
      const previous = await context.ProInfrastructure.get(id);
      ensure(
        !previous ||
          (same(previous.factory, event.srcAddress) &&
            same(previous.codeHash, event.params.codeHash)),
        "a graduation registry belongs to multiple factories or source hashes.",
      );
      context.ProInfrastructure.set({
        id,
        chainId: event.chainId,
        registry: lower(event.params.registry),
        factory: lower(event.srcAddress),
        codeHash: lower(event.params.codeHash),
      });
    },
  );
  indexer.contractRegister(
    { contract: "ProFactory", event: "LaunchCreated" },
    async ({ event, context }) => {
      context.chain.ProCurve.add(event.params.curveAddress);
      context.chain.ProPolicy.add(event.params.policy);
      if (proHolderContractConfigured())
        context.chain.ProToken.add(event.params.token);
    },
  );
  indexer.onEvent(
    { contract: "ProFactory", event: "LaunchCreated" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const p = event.params;
      const id = proLaunchId(event.chainId, p.token);
      ensure(
        !(await context.ProLaunch.get(id)),
        "token was already created by a factory.",
      );
      let rulesBitmap = 0n;
      const rules = p.rules.map((entry) => {
        ensure(
          entry.rule >= 0n && entry.rule < 23n,
          "unknown rule identifier.",
        );
        const bit = 1n << entry.rule;
        ensure((rulesBitmap & bit) === 0n, "duplicate rule identifier.");
        rulesBitmap |= bit;
        return { rule: Number(entry.rule), data: entry.data as Hex };
      });
      const curveConfig = {
        ...p.curveConfig,
        baseFeeBps: Number(p.curveConfig.baseFeeBps),
        buyTaxBps: Number(p.curveConfig.buyTaxBps),
        sellTaxBps: Number(p.curveConfig.sellTaxBps),
      };
      const calldata = encodeFunctionData({
        abi: proFactoryAbi,
        functionName: "createLaunch",
        args: [
          p.metadata,
          p.supply,
          curveConfig,
          rules,
          p.walletExemptions,
          p.requestedSalt as Hex,
          p.deadline,
        ],
      });
      const configurationHash = keccak256(`0x${calldata.slice(10)}`);
      const launchSalt = keccak256(
        encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"), [
          p.creator,
          p.requestedSalt as Hex,
          configurationHash,
        ]),
      );
      ensure(
        same(configurationHash, p.configurationHash) &&
          same(launchSalt, p.launchSalt),
        "creation event does not commit its complete launch configuration.",
      );
      ensure(
        p.supply > 0n &&
          p.curveConfig.phantomQuote > 0n &&
          (p.curveConfig.perpetual || p.curveConfig.graduationThreshold > 0n),
        "invalid curve economics.",
      );
      const registration = await context.ProGraduationRegistration.get(id);
      if (!p.curveConfig.perpetual) {
        ensure(
          Boolean(registration) &&
            same(registration!.factory, event.srcAddress) &&
            same(registration!.curve, p.curveAddress) &&
            same(registration!.policy, p.policy) &&
            same(registration!.configurationHash, configurationHash) &&
            same(registration!.transactionHash, event.transaction.hash) &&
            same(registration!.blockHash, event.block.hash),
          "graduating launch is missing its matching registry registration.",
        );
      } else
        ensure(
          !registration,
          "a permanent launch has a graduation registration.",
        );
      const stamp = provenance(event);
      const launch: ProLaunch = {
        id,
        chainId: event.chainId,
        token: lower(p.token),
        factory: lower(event.srcAddress),
        creator: lower(p.creator),
        curve: lower(p.curveAddress),
        policy: lower(p.policy),
        configurationHash,
        launchSalt,
        requestedSalt: lower(p.requestedSalt),
        deadline: p.deadline,
        walletExemptions: p.walletExemptions.map(lower),
        ...p.metadata,
        supply: p.supply,
        quoteAsset: lower(curveConfig.quoteAsset),
        phantomQuote: curveConfig.phantomQuote,
        graduationThreshold: curveConfig.graduationThreshold,
        baseFeeBps: curveConfig.baseFeeBps,
        buyTaxBps: curveConfig.buyTaxBps,
        sellTaxBps: curveConfig.sellTaxBps,
        feeRecipient: lower(curveConfig.feeRecipient),
        perpetual: curveConfig.perpetual,
        rulesBitmap,
        rulesActive: true,
        phase: "Trading",
        tokenReserve: p.supply,
        realQuoteReserve: 0n,
        accruedFees: 0n,
        quoteVolume: 0n,
        tradeCount: 0n,
        priceQuoteX18: (curveConfig.phantomQuote * 10n ** 36n) / p.supply,
        marketCapQuote: curveConfig.phantomQuote,
        progressBps: curveConfig.perpetual ? undefined : 0n,
        graduationRegistry: registration?.registry,
        sweptQuote: 0n,
        sweptTokens: 0n,
        poolId: registration?.poolId,
        positionId: undefined,
        liquidity: undefined,
        createdAt: stamp.timestamp,
        createdBlock: stamp.blockNumber,
        createdBlockHash: stamp.blockHash,
        creationTransactionHash: stamp.transactionHash,
        creationLogIndex: stamp.logIndex,
        lastTradeAt: undefined,
      };
      context.ProLaunch.set(launch);
      for (const [kind, address] of [
        ["curve", launch.curve],
        ["policy", launch.policy],
      ] as const) {
        const key = componentId(event.chainId, address);
        ensure(
          !(await context.ProComponent.get(key)),
          "launch component was already registered.",
        );
        context.ProComponent.set({
          id: key,
          chainId: event.chainId,
          address,
          token: launch.token,
          launchId: id,
          factory: launch.factory,
          kind,
        });
      }
      for (const rule of rules)
        context.ProRule.set({
          id: `${id}:${rule.rule}`,
          launchId: id,
          ...rule,
        });
      if (await context.ProPendingMint.get(id))
        await activateProHolderLedger(context, launch);
    },
  );
  indexer.onEvent(
    { contract: "ProCurve", event: "ProBuy" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await componentLaunch(context, event, "curve");
      const p = event.params;
      ensure(
        launch.phase === "Trading" &&
          launch.rulesActive &&
          p.tokensOut > 0n &&
          p.tokensOut < launch.tokenReserve &&
          p.spent > p.fees &&
          p.fees >= 0n &&
          p.refund >= 0n,
        "buy is inconsistent with active curve reserves.",
      );
      const next = {
        ...launch,
        tokenReserve: launch.tokenReserve - p.tokensOut,
        realQuoteReserve: launch.realQuoteReserve + p.spent - p.fees,
        accruedFees: launch.accruedFees + p.fees,
        quoteVolume: launch.quoteVolume + p.spent,
        tradeCount: launch.tradeCount + 1n,
        lastTradeAt: BigInt(event.block.timestamp),
      };
      ensure(
        next.perpetual || next.realQuoteReserve <= next.graduationThreshold,
        "buy exceeds graduation threshold.",
      );
      ensure(
        p.fees ===
          (p.spent * BigInt(launch.baseFeeBps + launch.buyTaxBps)) / 10_000n &&
          next.tokenReserve ===
            (launch.supply * launch.phantomQuote +
              launch.phantomQuote +
              next.realQuoteReserve -
              1n) /
              (launch.phantomQuote + next.realQuoteReserve) &&
          (p.refund === 0n ||
            (!next.perpetual &&
              next.realQuoteReserve === next.graduationThreshold)),
        "buy differs from the fixed invariant or raw quote fees.",
      );
      context.ProLaunch.set({ ...next, ...metrics(next) });
      context.ProTrade.set({
        id: eventId(event),
        launchId: launch.id,
        chainId: event.chainId,
        token: launch.token,
        factory: launch.factory,
        curve: launch.curve,
        quoteAsset: launch.quoteAsset,
        side: "Buy",
        trader: lower(p.buyer),
        recipient: lower(p.recipient),
        tokens: p.tokensOut,
        quoteAmount: p.spent,
        refund: p.refund,
        fees: p.fees,
        ...provenance(event),
      });
    },
  );
  indexer.onEvent(
    { contract: "ProCurve", event: "ProSell" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await componentLaunch(context, event, "curve");
      const p = event.params;
      ensure(
        launch.phase === "Trading" &&
          launch.rulesActive &&
          p.tokensIn > 0n &&
          p.tokensIn <= launch.supply - launch.tokenReserve &&
          p.quoteOut > 0n &&
          p.fees >= 0n &&
          p.quoteOut + p.fees <= launch.realQuoteReserve,
        "sell is inconsistent with active curve reserves.",
      );
      const next = {
        ...launch,
        tokenReserve: launch.tokenReserve + p.tokensIn,
        realQuoteReserve: launch.realQuoteReserve - p.quoteOut - p.fees,
        accruedFees: launch.accruedFees + p.fees,
        quoteVolume: launch.quoteVolume + p.quoteOut,
        tradeCount: launch.tradeCount + 1n,
        lastTradeAt: BigInt(event.block.timestamp),
      };
      const nextVirtual =
        (launch.supply * launch.phantomQuote + next.tokenReserve - 1n) /
        next.tokenReserve;
      const grossQuote =
        launch.phantomQuote + launch.realQuoteReserve - nextVirtual;
      ensure(
        grossQuote > 0n &&
          p.quoteOut + p.fees === grossQuote &&
          p.fees ===
            (grossQuote * BigInt(launch.baseFeeBps + launch.sellTaxBps)) /
              10_000n,
        "sell differs from the fixed invariant or raw quote fees.",
      );
      context.ProLaunch.set({ ...next, ...metrics(next) });
      context.ProTrade.set({
        id: eventId(event),
        launchId: launch.id,
        chainId: event.chainId,
        token: launch.token,
        factory: launch.factory,
        curve: launch.curve,
        quoteAsset: launch.quoteAsset,
        side: "Sell",
        trader: lower(p.seller),
        recipient: lower(p.recipient),
        tokens: p.tokensIn,
        quoteAmount: p.quoteOut,
        refund: 0n,
        fees: p.fees,
        ...provenance(event),
      });
    },
  );
  indexer.onEvent(
    { contract: "ProCurve", event: "FeesSwept" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await componentLaunch(context, event, "curve");
      ensure(
        same(event.params.recipient, launch.feeRecipient) &&
          event.params.amount === launch.accruedFees,
        "fee sweep differs from recorded accrual.",
      );
      context.ProLaunch.set({ ...launch, accruedFees: 0n });
    },
  );
  indexer.onEvent(
    { contract: "ProCurve", event: "CurveCompleted" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await componentLaunch(context, event, "curve");
      ensure(
        !launch.perpetual &&
          same(event.params.token, launch.token) &&
          event.params.quoteReserve === launch.realQuoteReserve &&
          event.params.tokenReserve === launch.tokenReserve &&
          launch.realQuoteReserve === launch.graduationThreshold,
        "curve completion differs from settled reserves.",
      );
    },
  );
  indexer.onEvent(
    { contract: "ProPolicy", event: "WalletRegistered" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await componentLaunch(context, event, "policy");
      ensure(
        launch.rulesActive && (launch.rulesBitmap & 1n) !== 0n,
        "wallet registration requires an active Access Pass rule.",
      );
      context.ProWalletRegistration.set({
        id: eventId(event),
        launchId: launch.id,
        chainId: event.chainId,
        token: launch.token,
        policy: launch.policy,
        wallet: lower(event.params.wallet),
        ...provenance(event),
      });
    },
  );
  indexer.onEvent(
    { contract: "ProGraduationRegistry", event: "GraduatingLaunchRegistered" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const infrastructure = await context.ProInfrastructure.get(
        componentId(event.chainId, event.srcAddress),
      );
      ensure(Boolean(infrastructure), "unconfigured graduation registry.");
      const id = proLaunchId(event.chainId, event.params.token);
      ensure(
        !(await context.ProGraduationRegistration.get(id)),
        "duplicate graduation registration.",
      );
      const p = event.params;
      context.ProGraduationRegistration.set({
        id,
        registry: lower(event.srcAddress),
        factory: infrastructure!.factory,
        curve: lower(p.curve),
        policy: lower(p.policy),
        configurationHash: lower(p.configurationHash),
        poolId: lower(p.poolId),
        blockNumber: BigInt(event.block.number),
        blockHash: lower(event.block.hash),
        transactionHash: lower(event.transaction.hash),
      });
    },
  );
  indexer.onEvent(
    { contract: "ProGraduationRegistry", event: "ReservesRecorded" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await registryLaunch(context, event, event.params.token);
      const p = event.params;
      ensure(
        launch.phase === "Trading" &&
          launch.rulesActive &&
          p.quoteAmount === launch.realQuoteReserve &&
          p.quoteAmount === launch.graduationThreshold &&
          p.tokenAmount === launch.tokenReserve &&
          p.tokenAmount > 0n,
        "sweep differs from completed curve principal.",
      );
      context.ProLaunch.set({
        ...launch,
        phase: "Swept",
        realQuoteReserve: 0n,
        tokenReserve: 0n,
        sweptQuote: p.quoteAmount,
        sweptTokens: p.tokenAmount,
        priceQuoteX18: undefined,
        marketCapQuote: undefined,
        progressBps: 10_000n,
      });
      context.ProGraduation.set({
        ...graduationRow(event, launch, "ReservesRecorded"),
        quoteAmount: p.quoteAmount,
        tokenAmount: p.tokenAmount,
      });
    },
  );
  indexer.onEvent(
    { contract: "ProGraduationRegistry", event: "GraduationPending" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await registryLaunch(context, event, event.params.token);
      ensure(
        launch.phase === "Swept" &&
          launch.rulesActive &&
          launch.positionId === undefined,
        "pending migration already contains an LP completion.",
      );
      context.ProGraduation.set({
        ...graduationRow(event, launch, "GraduationPending"),
        reason: event.params.reason,
      });
    },
  );
  indexer.onEvent(
    { contract: "ProPolicy", event: "RulesDeactivated" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await componentLaunch(context, event, "policy");
      ensure(
        launch.phase === "Swept" &&
          launch.rulesActive &&
          same(event.params.token, launch.token) &&
          Boolean(launch.graduationRegistry) &&
          same(event.params.registry, launch.graduationRegistry!),
        "rule deactivation differs from the registered migration.",
      );
      context.ProLaunch.set({ ...launch, rulesActive: false });
    },
  );
  indexer.onEvent(
    { contract: "ProGraduationRegistry", event: "GraduationCompleted" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const launch = await registryLaunch(context, event, event.params.token);
      const p = event.params;
      ensure(
        launch.phase === "Swept" &&
          !launch.rulesActive &&
          Boolean(launch.poolId) &&
          same(p.poolId, launch.poolId!) &&
          p.positionId > 0n &&
          p.liquidity > 0n &&
          p.quoteUsed > 0n &&
          p.quoteUsed <= launch.sweptQuote &&
          p.tokensUsed > 0n &&
          p.tokensUsed <= launch.sweptTokens,
        "completion differs from the registered positive LP receipt.",
      );
      context.ProLaunch.set({
        ...launch,
        phase: "PoolCreated",
        sweptQuote: 0n,
        sweptTokens: 0n,
        priceQuoteX18: undefined,
        marketCapQuote: undefined,
        positionId: p.positionId,
        liquidity: p.liquidity,
      });
      context.ProGraduation.set({
        ...graduationRow(event, launch, "GraduationCompleted"),
        poolId: lower(p.poolId),
        positionId: p.positionId,
        liquidity: p.liquidity,
        quoteAmount: p.quoteUsed,
        tokenAmount: p.tokensUsed,
      });
    },
  );

  indexer.onEvent(
    { contract: "ProSwapRouter", event: "ProPoolTrade" },
    async ({ event, context }) => {
      if (!(await once(context, event))) return;
      const p = event.params;
      const launch = await context.ProLaunch.get(
        proLaunchId(event.chainId, p.token),
      );
      ensure(
        Boolean(launch) &&
          launch!.chainId === event.chainId &&
          same(launch!.token, p.token),
        "pool trade belongs to an unregistered Pro launch.",
      );
      ensure(
        launch!.phase === "PoolCreated" &&
          !launch!.perpetual &&
          !launch!.rulesActive &&
          launch!.rulesBitmap >= 0n &&
          launch!.rulesBitmap >> 23n === 0n &&
          Boolean(launch!.poolId && launch!.graduationRegistry) &&
          /^0x[\da-fA-F]{64}$/.test(p.poolId) &&
          BigInt(p.poolId) !== 0n &&
          same(launch!.poolId!, p.poolId) &&
          same(launch!.quoteAsset, p.quoteAsset) &&
          launch!.positionId !== undefined &&
          launch!.positionId > 0n &&
          launch!.liquidity !== undefined &&
          launch!.liquidity > 0n &&
          launch!.sweptQuote === 0n &&
          launch!.sweptTokens === 0n &&
          launch!.realQuoteReserve === 0n &&
          launch!.tokenReserve === 0n,
        "pool trade differs from the completed positive locked LP.",
      );
      ensure(
        p.amountSpent > 0n && p.amountOut > 0n,
        "pool settled amounts must be positive.",
      );
      const stamp = provenance(event);
      const source = await context.effect(proPoolRouterSourceEffect, {
        factory: launch!.factory,
        registry: launch!.graduationRegistry!,
        router: event.srcAddress,
        blockNumber: stamp.blockNumber,
        blockHash: stamp.blockHash,
        timestamp: stamp.timestamp,
      });
      ensure(
        same(source.factory, launch!.factory) &&
          same(source.registry, launch!.graduationRegistry!),
        "pool Router belongs to another Factory or Registry.",
      );
      const forbidden = [
        launch!.token,
        launch!.curve,
        launch!.policy,
        launch!.factory,
        launch!.graduationRegistry!,
        event.srcAddress,
        launch!.quoteAsset,
        ...source.infrastructure,
      ];
      for (const account of [p.trader, p.recipient]) {
        ensure(
          isAddress(account, { strict: true }) &&
            !same(account, zeroAddress) &&
            !forbidden.some((value) => same(value, account)) &&
            !(await context.ProComponent.get(
              componentId(event.chainId, account),
            )) &&
            !(await context.ProInfrastructure.get(
              componentId(event.chainId, account),
            )),
          "pool trader/recipient is zero or known infrastructure.",
        );
      }
      const quoteAmount = p.buy ? p.amountSpent : p.amountOut;
      const tokens = p.buy ? p.amountOut : p.amountSpent;
      context.ProPoolTrade.set({
        id: eventId(event),
        launchId: launch!.id,
        chainId: event.chainId,
        token: launch!.token,
        factory: launch!.factory,
        router: lower(event.srcAddress),
        poolId: lower(p.poolId),
        quoteAsset: launch!.quoteAsset,
        side: p.buy ? "Buy" : "Sell",
        trader: lower(p.trader),
        recipient: lower(p.recipient),
        amountSpent: p.amountSpent,
        amountOut: p.amountOut,
        tokens,
        quoteAmount,
        ...stamp,
      });
      context.ProLaunch.set({
        ...launch!,
        quoteVolume: launch!.quoteVolume + quoteAmount,
        tradeCount: launch!.tradeCount + 1n,
        lastTradeAt: stamp.timestamp,
        priceQuoteX18: undefined,
        marketCapQuote: undefined,
      });
    },
  );
}

export const proConsentParticipantId = (
  chainId: number,
  registry: string,
  id: string,
) => `${chainId}:${lower(registry)}:${lower(id)}`;
const consentPairId = proConsentParticipantId;
const consentHash = (value: string) =>
  /^0x[\da-fA-F]{64}$/.test(value) && !/^0x0{64}$/.test(value);

async function consentSource(
  context: EvmOnEventContext,
  event: EventIdentity,
  participantIds: readonly string[],
) {
  const stamp = provenance(event);
  const source = await context.effect(proConsentSourceEffect, {
    registry: event.srcAddress,
    participantIds: [...participantIds],
    blockNumber: stamp.blockNumber,
    blockHash: stamp.blockHash,
    timestamp: stamp.timestamp,
  });
  ensure(
    same(source.registry, event.srcAddress) &&
      source.participants.length === participantIds.length &&
      participantIds.every((id) =>
        source.participants.some((p) => same(p.id, id)),
      ),
    "consent effect differs from its event identities.",
  );
  return source;
}
export async function onceProConsentEvent(
  context: {
    ProConsentEvent: Pick<EvmOnEventContext["ProConsentEvent"], "get">;
  },
  event: EventIdentity,
) {
  const stamp = provenance(event);
  const previous = await context.ProConsentEvent.get(eventId(event));
  if (!previous) return true;
  ensure(
    same(previous.registry, event.srcAddress) &&
      previous.blockNumber === stamp.blockNumber &&
      same(previous.blockHash, stamp.blockHash),
    "duplicate consent event has different canonical provenance.",
  );
  return false;
}
function consentEventRow(
  event: EventIdentity,
  factory: string,
  kind: string,
  participantId0: string,
) {
  return {
    id: eventId(event),
    chainId: event.chainId,
    factory: lower(factory),
    registry: lower(event.srcAddress),
    kind,
    participantId0: lower(participantId0),
    participantId1: undefined,
    finalPairId: undefined,
    nonce0: 0n,
    nonce1: undefined,
    ...provenance(event),
  };
}
function advancedParticipant<
  T extends { updatedBlock: bigint; updatedLogIndex: number },
>(value: T, event: EventIdentity) {
  const stamp = provenance(event);
  ensure(
    stamp.blockNumber > value.updatedBlock ||
      (stamp.blockNumber === value.updatedBlock &&
        stamp.logIndex > value.updatedLogIndex),
    "consent events are out of order.",
  );
  return {
    ...value,
    updatedBlock: stamp.blockNumber,
    updatedBlockHash: stamp.blockHash,
    updatedTransactionHash: stamp.transactionHash,
    updatedLogIndex: stamp.logIndex,
  };
}

// Existing operator configurations do not declare this ABI. They continue to
// register only their old handlers; an explicitly subscribed Registry still
// needs a genuine private v3 source review before any consent entity is written.
if (proConsentContractConfigured()) {
  indexer.onEvent(
    { contract: "ProConsentRegistry", event: "ReactiveParticipantRegistered" },
    async ({ event, context }) => {
      if (!(await onceProConsentEvent(context, event))) return;
      const p = event.params,
        source = await consentSource(context, event, [p.participantId]);
      const state = source.participants[0]!;
      const launchId = proLaunchId(event.chainId, p.token);
      const launch = await context.ProLaunch.get(launchId);
      const rule = await context.ProRule.get(`${launchId}:20`);
      const expectedId = keccak256(
        encodeAbiParameters(
          parseAbiParameters(
            "bytes32,uint256,address,address,uint256,address,bytes32,uint8",
          ),
          [
            keccak256(
              new TextEncoder().encode("XOOX_PRO_REACTIVE_PARTICIPANT_V2"),
            ),
            BigInt(event.chainId),
            source.factory as `0x${string}`,
            event.srcAddress as `0x${string}`,
            2n,
            p.creator,
            p.participantSalt as Hex,
            Number(p.role),
          ],
        ),
      );
      ensure(
        consentHash(p.participantId) &&
          same(expectedId, p.participantId) &&
          (p.role === 0n || p.role === 1n) &&
          same(state.token, p.token) &&
          same(state.creator, p.creator) &&
          same(state.configurationHash, p.configurationHash) &&
          state.role === Number(p.role) &&
          Boolean(launch && rule) &&
          same(launch!.factory, source.factory) &&
          same(launch!.creator, p.creator) &&
          same(launch!.configurationHash, p.configurationHash) &&
          launch!.rulesBitmap === 1n << 20n &&
          /^0x[\da-fA-F]{256}$/.test(rule!.data) &&
          same(`0x${rule!.data.slice(2, 66)}`, p.participantId) &&
          BigInt(`0x${rule!.data.slice(66, 130)}`) === p.role,
        "participant registration differs from its committed Factory launch.",
      );
      const id = proConsentParticipantId(
        event.chainId,
        event.srcAddress,
        p.participantId,
      );
      ensure(
        !(await context.ProConsentParticipant.get(id)) &&
          !(await context.ProConsentToken.get(launchId)),
        "participant/token namespace was already registered.",
      );
      const stamp = provenance(event);
      context.ProConsentParticipant.set({
        id,
        chainId: event.chainId,
        registry: lower(event.srcAddress),
        factory: source.factory,
        helper: source.helper,
        reviewId: source.reviewId,
        participantId: lower(p.participantId),
        token: lower(p.token),
        launchId,
        creator: lower(p.creator),
        configurationHash: lower(p.configurationHash),
        role: Number(p.role),
        participantSalt: lower(p.participantSalt),
        nonce: 0n,
        status: "AwaitingConsent",
        partnerId: undefined,
        finalPairId: undefined,
        registeredBlock: stamp.blockNumber,
        registeredBlockHash: stamp.blockHash,
        registrationTransactionHash: stamp.transactionHash,
        registrationLogIndex: stamp.logIndex,
        updatedBlock: stamp.blockNumber,
        updatedBlockHash: stamp.blockHash,
        updatedTransactionHash: stamp.transactionHash,
        updatedLogIndex: stamp.logIndex,
      });
      context.ProConsentToken.set({
        id: launchId,
        participantEntityId: id,
        factory: source.factory,
        registry: lower(event.srcAddress),
      });
      context.ProConsentEvent.set(
        consentEventRow(event, source.factory, "Registered", p.participantId),
      );
    },
  );
  indexer.onEvent(
    { contract: "ProConsentRegistry", event: "ParticipantNonceAdvanced" },
    async ({ event, context }) => {
      if (!(await onceProConsentEvent(context, event))) return;
      const p = event.params,
        source = await consentSource(context, event, [p.participantId]);
      const state = source.participants[0]!;
      const id = proConsentParticipantId(
        event.chainId,
        event.srcAddress,
        p.participantId,
      );
      const previous = await context.ProConsentParticipant.get(id);
      ensure(
        Boolean(previous) &&
          previous!.status === "AwaitingConsent" &&
          same(previous!.factory, source.factory) &&
          same(previous!.creator, p.creator) &&
          same(state.creator, p.creator) &&
          same(state.token, previous!.token) &&
          same(state.configurationHash, previous!.configurationHash) &&
          state.role === previous!.role &&
          p.nonce === previous!.nonce + 1n &&
          state.nonce >= p.nonce &&
          (!state.finalized || state.nonce > p.nonce),
        "nonce event differs from the registered pending participant.",
      );
      context.ProConsentParticipant.set({
        ...advancedParticipant(previous!, event),
        nonce: p.nonce,
      });
      context.ProConsentEvent.set({
        ...consentEventRow(
          event,
          source.factory,
          "NonceAdvanced",
          p.participantId,
        ),
        nonce0: p.nonce,
      });
    },
  );
  indexer.onEvent(
    { contract: "ProConsentRegistry", event: "ReactiveConsentFinalized" },
    async ({ event, context }) => {
      if (!(await onceProConsentEvent(context, event))) return;
      const p = event.params,
        source = await consentSource(context, event, [
          p.participantId0,
          p.participantId1,
        ]);
      const own = [p.participantId0, p.participantId1].map(
        (id) => source.participants.find((state) => same(state.id, id))!,
      );
      const previous = await Promise.all(
        [p.participantId0, p.participantId1].map((id) =>
          context.ProConsentParticipant.get(
            proConsentParticipantId(event.chainId, event.srcAddress, id),
          ),
        ),
      );
      const pair = source.pairs.find((value) => same(value.id, p.finalPairId));
      ensure(
        consentHash(p.finalPairId) &&
          !same(p.participantId0, p.participantId1) &&
          !same(p.token0, p.token1) &&
          Boolean(pair) &&
          same(pair!.participantId0, p.participantId0) &&
          same(pair!.participantId1, p.participantId1) &&
          same(pair!.token0, p.token0) &&
          same(pair!.token1, p.token1) &&
          same(pair!.creator0, p.creator0) &&
          same(pair!.creator1, p.creator1),
        "finalization event differs from its genuine ordered pair.",
      );
      for (const i of [0, 1] as const) {
        const row = previous[i],
          state = own[i],
          token = i === 0 ? p.token0 : p.token1,
          creator = i === 0 ? p.creator0 : p.creator1,
          nonce = i === 0 ? p.nonce0 : p.nonce1,
          other = i === 0 ? p.participantId1 : p.participantId0;
        ensure(
          Boolean(row) &&
            row!.status === "AwaitingConsent" &&
            same(row!.factory, source.factory) &&
            row!.role === i &&
            same(row!.token, token) &&
            same(row!.creator, creator) &&
            row!.nonce === nonce &&
            same(
              row!.configurationHash,
              i === 0 ? pair!.configurationHash0 : pair!.configurationHash1,
            ) &&
            state.finalized &&
            state.role === i &&
            state.nonce === nonce + 1n &&
            same(state.token, token) &&
            same(state.creator, creator) &&
            same(state.configurationHash, row!.configurationHash) &&
            same(state.partnerId, other) &&
            same(state.finalPairId, p.finalPairId),
          "finalization does not consume both exact pending participant nonces.",
        );
      }
      const id = consentPairId(event.chainId, event.srcAddress, p.finalPairId);
      ensure(
        !(await context.ProConsentPair.get(id)),
        "shared final pair was already indexed.",
      );
      const updated = previous.map((row, i) => ({
        ...advancedParticipant(row!, event),
        nonce: row!.nonce + 1n,
        status: "Finalized",
        partnerId: lower(i === 0 ? p.participantId1 : p.participantId0),
        finalPairId: lower(p.finalPairId),
      }));
      for (const row of updated) context.ProConsentParticipant.set(row);
      context.ProConsentPair.set({
        id,
        chainId: event.chainId,
        factory: source.factory,
        registry: lower(event.srcAddress),
        finalPairId: lower(p.finalPairId),
        participantId0: lower(p.participantId0),
        participantId1: lower(p.participantId1),
        token0: lower(p.token0),
        token1: lower(p.token1),
        creator0: lower(p.creator0),
        creator1: lower(p.creator1),
        configurationHash0: lower(pair!.configurationHash0),
        configurationHash1: lower(pair!.configurationHash1),
        consumedNonce0: p.nonce0,
        consumedNonce1: p.nonce1,
        ...provenance(event),
      });
      context.ProConsentEvent.set({
        ...consentEventRow(
          event,
          source.factory,
          "Finalized",
          p.participantId0,
        ),
        participantId1: lower(p.participantId1),
        finalPairId: lower(p.finalPairId),
        nonce0: p.nonce0,
        nonce1: p.nonce1,
      });
    },
  );
}
