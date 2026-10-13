import { beforeEach, describe, expect, it, vi } from "vitest";
const sourceLoader = vi.hoisted(() => vi.fn());
vi.mock("./pro-pool-router-source", () => ({
  loadProPoolRouterSource: sourceLoader,
}));
import { createTestIndexer } from "envio";
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { proFactoryAbi } from "./vendor/xoox-sdk/pro-token";
import type { Deployment } from "./vendor/xoox-sdk/config";
import { envioConfiguration } from "./configuration";
import { proLaunchId } from "./pro-handlers";
import "./handlers/index";

const factory = "0xe000000000000000000000000000000000000000" as Address;
const token = "0x1000000000000000000000000000000000000001" as Address;
const curve = "0x2000000000000000000000000000000000000001" as Address;
const policy = "0x3000000000000000000000000000000000000001" as Address;
const creator = "0x4000000000000000000000000000000000000001" as Address;
const trader = "0x5000000000000000000000000000000000000001" as Address;
const registry = "0x6000000000000000000000000000000000000001" as Address;
const other = "0x7000000000000000000000000000000000000001" as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const stamp = (n: number, logIndex = 0) => ({
  block: { number: n, timestamp: n * 10, hash: hash(n) },
  transaction: { hash: hash(n + 1000) },
  logIndex,
});
const id = proLaunchId(143, token);
const supply = 1_000_000n * 10n ** 18n;
const unit = 10n ** 6n;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
type Test = ReturnType<typeof createTestIndexer>;

function launchEvent(
  perpetual = true,
  quote: Address = zeroAddress,
  selectedRules = [{ rule: 0, data: hash(8) }],
) {
  const metadata = {
    name: "Pro Example",
    symbol: "PRO",
    description: "Immutable onchain rules",
    image: "https://example.com/pro.png",
    website: "https://example.com",
    twitter: "",
    telegram: "",
  };
  const curveConfig = {
    quoteAsset: quote,
    phantomQuote: 100n * unit,
    graduationThreshold: perpetual ? 0n : 100n * unit,
    baseFeeBps: 100,
    buyTaxBps: 200,
    sellTaxBps: 300,
    perpetual,
    feeRecipient: creator,
  };
  const deadline = 1000n;
  const requestedSalt = hash(55);
  const calldata = encodeFunctionData({
    abi: proFactoryAbi,
    functionName: "createLaunch",
    args: [
      metadata,
      supply,
      curveConfig,
      selectedRules,
      [],
      requestedSalt,
      deadline,
    ],
  });
  const configurationHash = keccak256(`0x${calldata.slice(10)}`);
  const launchSalt = keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"), [
      creator,
      requestedSalt,
      configurationHash,
    ]),
  );
  return {
    contract: "ProFactory" as const,
    event: "LaunchCreated" as const,
    srcAddress: factory,
    ...stamp(2, 5),
    params: {
      creator,
      token,
      curveAddress: curve,
      policy,
      supply,
      configurationHash,
      launchSalt,
      metadata,
      curveConfig: {
        ...curveConfig,
        baseFeeBps: 100n,
        buyTaxBps: 200n,
        sellTaxBps: 300n,
      },
      rules: selectedRules.map((r) => ({ rule: BigInt(r.rule), data: r.data })),
      walletExemptions: [],
      requestedSalt,
      deadline,
    },
  };
}
const installed = () => ({
  contract: "ProFactory" as const,
  event: "GraduationInfrastructureConfigured" as const,
  srcAddress: factory,
  ...stamp(1),
  params: { registry, codeHash: hash(44) },
});
function registered(created: ReturnType<typeof launchEvent>) {
  return {
    contract: "ProGraduationRegistry" as const,
    event: "GraduatingLaunchRegistered" as const,
    srcAddress: registry,
    ...stamp(2, 4),
    params: {
      token,
      curve,
      policy,
      configurationHash: created.params.configurationHash,
      poolId: hash(99),
    },
  };
}
async function create(
  test: Test,
  perpetual = true,
  quote: Address = zeroAddress,
  rules?: { rule: number; data: Hex }[],
) {
  const created = launchEvent(perpetual, quote, rules);
  if (!perpetual)
    await test.process({ chains: { 143: { simulate: [installed()] } } });
  await test.process({
    chains: {
      143: { simulate: perpetual ? [created] : [registered(created), created] },
    },
  });
  return created;
}
function buyEvent(
  spent = 10n * unit,
  refund = 0n,
  priorReal = 0n,
  priorTokens = supply,
) {
  const fees = (spent * 300n) / 10_000n;
  const nextReal = priorReal + spent - fees;
  const tokensOut =
    priorTokens - ceil(supply * 100n * unit, 100n * unit + nextReal);
  return {
    contract: "ProCurve" as const,
    event: "ProBuy" as const,
    srcAddress: curve,
    ...stamp(3, 3),
    params: { buyer: trader, recipient: other, tokensOut, spent, refund, fees },
  };
}
function fillEvent() {
  const target = 100n * unit;
  const spent = ((target - 1n) * 10_000n) / 9700n + 1n;
  return buyEvent(spent, 10n * unit);
}
async function swept(
  test: Test,
  quote: Address = zeroAddress,
  rules?: { rule: number; data: Hex }[],
) {
  await create(test, false, quote, rules);
  const buy = fillEvent();
  const remaining = supply - buy.params.tokensOut;
  const completed = {
    contract: "ProCurve" as const,
    event: "CurveCompleted" as const,
    srcAddress: curve,
    ...stamp(3, 4),
    params: { token, quoteReserve: 100n * unit, tokenReserve: remaining },
  };
  const reserves = {
    contract: "ProGraduationRegistry" as const,
    event: "ReservesRecorded" as const,
    srcAddress: registry,
    ...stamp(3, 5),
    params: { token, quoteAmount: 100n * unit, tokenAmount: remaining },
  };
  await test.process({
    chains: { 143: { simulate: [buy, completed, reserves] } },
  });
  return reserves;
}
const pending = () => ({
  contract: "ProGraduationRegistry" as const,
  event: "GraduationPending" as const,
  srcAddress: registry,
  ...stamp(4, 6),
  params: { token, reason: "0xdeadbeef" },
});
const deactivated = () => ({
  contract: "ProPolicy" as const,
  event: "RulesDeactivated" as const,
  srcAddress: policy,
  ...stamp(5, 1),
  params: { token, registry },
});
const finished = () => ({
  contract: "ProGraduationRegistry" as const,
  event: "GraduationCompleted" as const,
  srcAddress: registry,
  ...stamp(5, 2),
  params: {
    token,
    poolId: hash(99),
    positionId: 1n,
    liquidity: 100_000n,
    quoteUsed: 99n * unit,
    tokensUsed: supply / 2n - 1n,
  },
});

describe("isolated Pro onchain index", () => {
  it("stores complete creation data and rule bytes with canonical source provenance", async () => {
    const test = createTestIndexer();
    const created = await create(test, true, other, [
      { rule: 0, data: hash(8) },
      { rule: 7, data: "0x1234" },
    ]);
    expect(await test.ProLaunch.getOrThrow(id)).toMatchObject({
      factory,
      token,
      curve,
      policy,
      creator,
      quoteAsset: other,
      configurationHash: created.params.configurationHash,
      perpetual: true,
      rulesBitmap: 129n,
      rulesActive: true,
      phase: "Trading",
      tokenReserve: supply,
      realQuoteReserve: 0n,
      createdBlock: 2n,
      createdBlockHash: hash(2),
      creationTransactionHash: hash(1002),
      creationLogIndex: 5,
      priceQuoteX18: (100n * unit * 10n ** 36n) / supply,
      marketCapQuote: 100n * unit,
      progressBps: undefined,
    });
    expect(await test.ProRule.getOrThrow(`${id}:7`)).toMatchObject({
      rule: 7,
      data: "0x1234",
    });
    expect(await test.Launch.getAll()).toHaveLength(0);
    expect(await test.Trade.getAll()).toHaveLength(0);
  });
  it.each([zeroAddress, other])(
    "keeps native and ERC20 amounts in exact raw units (%s)",
    async (quote) => {
      const test = createTestIndexer();
      await create(test, true, quote);
      const buy = buyEvent();
      await test.process({ chains: { 143: { simulate: [buy] } } });
      const bought = await test.ProLaunch.getOrThrow(id);
      const tokensIn = buy.params.tokensOut / 2n;
      const virtual = ceil(
        supply * 100n * unit,
        bought.tokenReserve + tokensIn,
      );
      const grossQuote = 100n * unit + bought.realQuoteReserve - virtual;
      const fees = (grossQuote * 400n) / 10_000n;
      const sell = {
        contract: "ProCurve" as const,
        event: "ProSell" as const,
        srcAddress: curve,
        ...stamp(4, 2),
        params: {
          seller: trader,
          recipient: other,
          tokensIn,
          quoteOut: grossQuote - fees,
          fees,
        },
      };
      await test.process({ chains: { 143: { simulate: [sell] } } });
      expect(await test.ProLaunch.getOrThrow(id)).toMatchObject({
        quoteAsset: quote,
        tokenReserve: bought.tokenReserve + tokensIn,
        realQuoteReserve: bought.realQuoteReserve - grossQuote,
        accruedFees: buy.params.fees + fees,
        quoteVolume: buy.params.spent + grossQuote - fees,
        tradeCount: 2n,
        lastTradeAt: 40n,
      });
      const rows = await test.ProTrade.getAll();
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.side === "Buy")).toMatchObject({
        trader,
        recipient: other,
        quoteAsset: quote,
        quoteAmount: buy.params.spent,
        refund: 0n,
        fees: buy.params.fees,
        blockHash: hash(3),
      });
      expect(rows.find((r) => r.side === "Sell")).toMatchObject({
        trader,
        recipient: other,
        quoteAsset: quote,
        quoteAmount: grossQuote - fees,
        refund: 0n,
        fees,
        blockHash: hash(4),
      });
    },
  );
  it("does not count duplicate event delivery twice", async () => {
    const test = createTestIndexer();
    await create(test);
    const buy = buyEvent();
    await test.process({ chains: { 143: { simulate: [buy] } } });
    await test.process({
      chains: {
        143: { simulate: [{ ...buy, block: { ...buy.block, number: 4 } }] },
      },
    });
    expect((await test.ProLaunch.getOrThrow(id)).tradeCount).toBe(1n);
    expect(await test.ProTrade.getAll()).toHaveLength(1);
  });
  it("binds allowlist wallet registration to the actual active policy", async () => {
    const test = createTestIndexer();
    await create(test);
    const event = {
      contract: "ProPolicy" as const,
      event: "WalletRegistered" as const,
      srcAddress: policy,
      ...stamp(3, 1),
      params: { wallet: other },
    };
    await test.process({ chains: { 143: { simulate: [event] } } });
    await test.process({
      chains: {
        143: { simulate: [{ ...event, block: { ...event.block, number: 4 } }] },
      },
    });
    expect(await test.ProWalletRegistration.getAll()).toHaveLength(1);
    expect((await test.ProWalletRegistration.getAll())[0]).toMatchObject({
      launchId: id,
      policy,
      wallet: other,
      blockHash: hash(3),
    });
  });
  it("does not infer allowlist eligibility when the launch has another rule", async () => {
    const test = createTestIndexer();
    await create(test, true, zeroAddress, [{ rule: 7, data: "0x1234" }]);
    await expect(
      test.process({
        chains: {
          143: {
            simulate: [
              {
                contract: "ProPolicy",
                event: "WalletRegistered",
                srcAddress: policy,
                ...stamp(3),
                params: { wallet: other },
              },
            ],
          },
        },
      }),
    ).rejects.toThrow("Access Pass");
  });
  it("preserves final-buy refund, pending principal and a later positive completion separately", async () => {
    const test = createTestIndexer();
    const reserves = await swept(test);
    await test.process({ chains: { 143: { simulate: [pending()] } } });
    expect(await test.ProLaunch.getOrThrow(id)).toMatchObject({
      phase: "Swept",
      rulesActive: true,
      tokenReserve: 0n,
      realQuoteReserve: 0n,
      sweptQuote: reserves.params.quoteAmount,
      sweptTokens: reserves.params.tokenAmount,
      positionId: undefined,
      liquidity: undefined,
      priceQuoteX18: undefined,
      marketCapQuote: undefined,
      progressBps: 10_000n,
    });
    expect((await test.ProTrade.getAll())[0]).toMatchObject({
      refund: 10n * unit,
      quoteAmount: fillEvent().params.spent,
    });
    await test.process({
      chains: { 143: { simulate: [deactivated(), finished()] } },
    });
    expect(await test.ProLaunch.getOrThrow(id)).toMatchObject({
      phase: "PoolCreated",
      rulesActive: false,
      sweptQuote: 0n,
      sweptTokens: 0n,
      positionId: 1n,
      liquidity: 100_000n,
    });
    expect(
      (await test.ProGraduation.getAll()).map((row) => row.kind).sort(),
    ).toEqual(["GraduationCompleted", "GraduationPending", "ReservesRecorded"]);
    expect((await test.ProRule.getOrThrow(`${id}:0`)).data).toBe(hash(8));
  });
  it("records actual curve fee sweep without changing principal or trade totals", async () => {
    const test = createTestIndexer();
    await create(test);
    const buy = buyEvent();
    await test.process({ chains: { 143: { simulate: [buy] } } });
    const before = await test.ProLaunch.getOrThrow(id);
    await test.process({
      chains: {
        143: {
          simulate: [
            {
              contract: "ProCurve",
              event: "FeesSwept",
              srcAddress: curve,
              ...stamp(4),
              params: { recipient: creator, amount: before.accruedFees },
            },
          ],
        },
      },
    });
    expect(await test.ProLaunch.getOrThrow(id)).toEqual({
      ...before,
      accruedFees: 0n,
    });
  });
  it("rejects creation metadata or rule bytes altered without a new commitment", async () => {
    const test = createTestIndexer();
    const event = launchEvent();
    event.params.metadata.name = "Changed metadata";
    await expect(
      test.process({ chains: { 143: { simulate: [event] } } }),
    ).rejects.toThrow("complete launch configuration");
  });
  it("rejects duplicate rules before publishing a launch", async () => {
    const test = createTestIndexer();
    await expect(
      test.process({
        chains: {
          143: {
            simulate: [
              launchEvent(true, zeroAddress, [
                { rule: 0, data: hash(8) },
                { rule: 0, data: hash(8) },
              ]),
            ],
          },
        },
      }),
    ).rejects.toThrow("duplicate rule");
  });
  it("rejects graduating creation without a matching registry registration", async () => {
    const test = createTestIndexer();
    await expect(
      test.process({ chains: { 143: { simulate: [launchEvent(false)] } } }),
    ).rejects.toThrow("matching registry registration");
  });
  it("rejects registry registrations from an unconfigured source", async () => {
    const test = createTestIndexer();
    await expect(
      test.process({
        chains: { 143: { simulate: [registered(launchEvent(false))] } },
      }),
    ).rejects.toThrow("never reached a handler");
  });
  it("rejects a trade emitted by another component", async () => {
    const test = createTestIndexer();
    await create(test);
    await expect(
      test.process({
        chains: { 143: { simulate: [{ ...buyEvent(), srcAddress: other }] } },
      }),
    ).rejects.toThrow("never reached a handler");
  });
  it("rejects incorrect invariant math or fee accounting", async () => {
    const test = createTestIndexer();
    await create(test);
    const buy = buyEvent();
    buy.params.tokensOut += 1n;
    await expect(
      test.process({ chains: { 143: { simulate: [buy] } } }),
    ).rejects.toThrow("fixed invariant");
  });
  it("rejects a sweep that would change the settled principal", async () => {
    const test = createTestIndexer();
    await create(test, false);
    await test.process({ chains: { 143: { simulate: [fillEvent()] } } });
    await expect(
      test.process({
        chains: {
          143: {
            simulate: [
              {
                contract: "ProGraduationRegistry",
                event: "ReservesRecorded",
                srcAddress: registry,
                ...stamp(4, 5),
                params: {
                  token,
                  quoteAmount: 99n * unit,
                  tokenAmount: supply / 2n,
                },
              },
            ],
          },
        },
      }),
    ).rejects.toThrow("completed curve principal");
  });
  it("rejects completion before active rules are deactivated", async () => {
    const test = createTestIndexer();
    await swept(test);
    await expect(
      test.process({ chains: { 143: { simulate: [finished()] } } }),
    ).rejects.toThrow("positive LP receipt");
  });
  it("rejects LP completion for another registered pool", async () => {
    const test = createTestIndexer();
    await swept(test);
    const completed = finished();
    completed.params.poolId = hash(98);
    await expect(
      test.process({
        chains: { 143: { simulate: [deactivated(), completed] } },
      }),
    ).rejects.toThrow("positive LP receipt");
  });
});

describe("explicit Pro subscriptions", () => {
  const deployment = {
    chainId: 143,
    environment: "configured",
    rpcUrl: "https://example.com/rpc",
    startBlock: "100",
    factory: other,
    feeVault: creator,
    hook: policy,
    swapRouter: curve,
    poolManager: token,
    treasury: registry,
  } as Deployment;
  it("keeps Pro disabled without explicit configured source input", () => {
    expect(
      envioConfiguration(deployment).chains[0].contracts.find(
        (c) => c.name === "ProFactory",
      )?.address,
    ).toEqual([]);
  });
  it("subscribes only to explicit factories and starts before infrastructure installation", () => {
    const configured = envioConfiguration(deployment, [
      { chainId: 143, factory, startBlock: "10" },
    ]);
    expect(configured.chains[0].start_block).toBe(10);
    expect(
      configured.chains[0].contracts.find((c) => c.name === "Factory")?.address,
    ).toEqual([other]);
    expect(
      configured.chains[0].contracts.find((c) => c.name === "ProFactory")
        ?.address,
    ).toEqual([factory]);
    expect(
      configured.chains[0].contracts.find(
        (c) => c.name === "ProGraduationRegistry",
      )?.address,
    ).toEqual([]);
  });
  it.each([
    { chainId: 31337, factory, startBlock: "10" },
    { chainId: 143, factory: zeroAddress, startBlock: "10" },
    { chainId: 143, factory, startBlock: "-1" },
    { chainId: 143, factory, startBlock: "9007199254740992" },
  ])("rejects unbound or unsafe subscriptions %o", (source) => {
    expect(() => envioConfiguration(deployment, [source])).toThrow(
      "Pro indexer sources",
    );
  });
  it("rejects one address pretending to implement both factory families", () => {
    expect(() =>
      envioConfiguration(deployment, [
        { chainId: 143, factory: other, startBlock: "10" },
      ]),
    ).toThrow("distinct addresses");
  });
});

const poolRouter = "0xf000000000000000000000000000000000000000" as Address;
function poolTrade(buy = true, quoteAsset: Address = zeroAddress) {
  return {
    contract: "ProSwapRouter" as const,
    event: "ProPoolTrade" as const,
    srcAddress: poolRouter,
    ...stamp(6, 8),
    params: {
      token,
      trader,
      poolId: hash(99),
      recipient: other,
      quoteAsset,
      buy,
      amountSpent: buy ? 3n * unit : 123n * 10n ** 18n,
      amountOut: buy ? 111n * 10n ** 18n : 2n * unit,
    },
  };
}
async function poolCreated(
  test: Test,
  quote: Address = zeroAddress,
  rules?: { rule: number; data: Hex }[],
) {
  await swept(test, quote, rules);
  await test.process({
    chains: { 143: { simulate: [deactivated(), finished()] } },
  });
}
describe("isolated public Pro pool Router projection", () => {
  beforeEach(() =>
    sourceLoader.mockReset().mockResolvedValue({
      factory,
      registry,
      infrastructure: [poolRouter, factory, registry],
    }),
  );
  it.each([
    [true, zeroAddress],
    [false, zeroAddress],
    [true, "0x8000000000000000000000000000000000000001" as Address],
    [false, "0x8000000000000000000000000000000000000001" as Address],
  ] as const)(
    "indexes exact settled raw amounts for buy=%s quote=%s without modifying curve reserves",
    async (buy, quote) => {
      const test = createTestIndexer();
      await poolCreated(test, quote);
      const previous = await test.ProLaunch.getOrThrow(id),
        event = poolTrade(buy, quote);
      await test.process({ chains: { 143: { simulate: [event] } } });
      const rows = await test.ProPoolTrade.getAll();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        launchId: id,
        token,
        factory,
        router: poolRouter,
        poolId: hash(99),
        quoteAsset: quote,
        side: buy ? "Buy" : "Sell",
        trader,
        recipient: other,
        amountSpent: event.params.amountSpent,
        amountOut: event.params.amountOut,
        tokens: buy ? event.params.amountOut : event.params.amountSpent,
        quoteAmount: buy ? event.params.amountSpent : event.params.amountOut,
        blockNumber: 6n,
        blockHash: hash(6),
        timestamp: 60n,
        transactionHash: hash(1006),
        logIndex: 8,
      });
      expect(Object.keys(rows[0]!)).not.toContain("refund");
      expect(Object.keys(rows[0]!)).not.toContain("fees");
      expect(await test.ProLaunch.getOrThrow(id)).toMatchObject({
        quoteVolume:
          previous.quoteVolume +
          (buy ? event.params.amountSpent : event.params.amountOut),
        tradeCount: previous.tradeCount + 1n,
        tokenReserve: 0n,
        realQuoteReserve: 0n,
        accruedFees: previous.accruedFees,
        positionId: 1n,
        liquidity: 100_000n,
        priceQuoteX18: undefined,
        marketCapQuote: undefined,
        lastTradeAt: 60n,
      });
      expect(await test.ProTrade.getAll()).toHaveLength(1);
      expect(await test.Trade.getAll()).toHaveLength(0);
      expect(sourceLoader).toHaveBeenCalledWith(143, {
        factory,
        registry,
        router: poolRouter,
        blockNumber: 6n,
        blockHash: hash(6),
        timestamp: 60n,
      });
    },
  );
  it.each([
    [20, true, zeroAddress],
    [20, false, zeroAddress],
    [21, true, "0x8000000000000000000000000000000000000001" as Address],
    [21, false, "0x8000000000000000000000000000000000000001" as Address],
    [22, true, zeroAddress],
    [22, false, zeroAddress],
  ] as const)(
    "indexes completed linked R%s buy=%s quote=%s while preserving terminal Curve evidence",
    async (rule, buy, quote) => {
      const test = createTestIndexer();
      const data =
        rule === 20
          ? encodeAbiParameters(
              parseAbiParameters("bytes32,uint8,uint32,uint32"),
              [hash(7), 0, 500_000, 10_000],
            )
          : rule === 21
            ? encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [
                hash(7),
                20_000n * 10n ** 18n,
              ])
            : encodeAbiParameters(parseAbiParameters("bytes32"), [hash(7)]);
      await poolCreated(test, quote, [{ rule, data }]);
      const before = await test.ProLaunch.getOrThrow(id);
      const terminalCurveTrades = await test.ProTrade.getAll();
      const terminalRule = await test.ProRule.getOrThrow(`${id}:${rule}`);
      expect(before).toMatchObject({
        phase: "PoolCreated",
        rulesActive: false,
        rulesBitmap: 1n << BigInt(rule),
        positionId: 1n,
        liquidity: 100_000n,
      });
      const event = poolTrade(buy, quote);
      await test.process({ chains: { 143: { simulate: [event] } } });
      expect(await test.ProPoolTrade.getAll()).toHaveLength(1);
      expect((await test.ProPoolTrade.getAll())[0]).toMatchObject({
        side: buy ? "Buy" : "Sell",
        amountSpent: event.params.amountSpent,
        amountOut: event.params.amountOut,
        quoteAsset: quote,
        poolId: before.poolId,
      });
      expect(await test.ProTrade.getAll()).toEqual(terminalCurveTrades);
      expect(await test.ProRule.getOrThrow(`${id}:${rule}`)).toEqual(
        terminalRule,
      );
      expect(await test.ProLaunch.getOrThrow(id)).toMatchObject({
        phase: "PoolCreated",
        rulesActive: false,
        rulesBitmap: before.rulesBitmap,
        configurationHash: before.configurationHash,
        poolId: before.poolId,
        positionId: before.positionId,
        liquidity: before.liquidity,
        realQuoteReserve: 0n,
        tokenReserve: 0n,
        sweptQuote: 0n,
        sweptTokens: 0n,
        accruedFees: before.accruedFees,
        quoteVolume:
          before.quoteVolume +
          (buy ? event.params.amountSpent : event.params.amountOut),
        tradeCount: before.tradeCount + 1n,
        priceQuoteX18: undefined,
        marketCapQuote: undefined,
      });
    },
  );
  it("counts resumed canonical Router event replay once", async () => {
    const original = createTestIndexer();
    await poolCreated(original);
    await original.process({ chains: { 143: { simulate: [poolTrade()] } } });
    const replay = createTestIndexer();
    await poolCreated(replay);
    for (const row of await original.ProLaunch.getAll())
      replay.ProLaunch.set(row);
    for (const row of await original.ProPoolTrade.getAll())
      replay.ProPoolTrade.set(row);
    for (const row of await original.ProProcessedEvent.getAll())
      replay.ProProcessedEvent.set(row);
    const previous = await replay.ProLaunch.getOrThrow(id);
    await replay.process({ chains: { 143: { simulate: [poolTrade()] } } });
    expect(await replay.ProPoolTrade.getAll()).toHaveLength(1);
    expect(await replay.ProLaunch.getOrThrow(id)).toEqual(previous);
  });
  it("rejects unsubscribed Router sources before projection", async () => {
    const test = createTestIndexer();
    await poolCreated(test);
    await expect(
      test.process({
        chains: { 143: { simulate: [{ ...poolTrade(), srcAddress: other }] } },
      }),
    ).rejects.toThrow("never reached a handler");
    expect(await test.ProPoolTrade.getAll()).toEqual([]);
  });
  it("rejects a configured Router bound to another Factory", async () => {
    sourceLoader.mockResolvedValue({
      factory: other,
      registry,
      infrastructure: [poolRouter],
    });
    const test = createTestIndexer();
    await poolCreated(test);
    await expect(
      test.process({ chains: { 143: { simulate: [poolTrade()] } } }),
    ).rejects.toThrow("another Factory");
    expect(await test.ProPoolTrade.getAll()).toEqual([]);
  });
  it.each(["Trading", "Swept"])(
    "rejects %s before completed LP",
    async (phase) => {
      const test = createTestIndexer();
      if (phase === "Trading") await create(test, false);
      else await swept(test);
      await expect(
        test.process({ chains: { 143: { simulate: [poolTrade()] } } }),
      ).rejects.toThrow("completed positive");
    },
  );
  it.each([
    { rulesActive: true },
    { perpetual: true },
    { rulesBitmap: 1n << 23n },
    { rulesBitmap: (1n << 23n) | (1n << 22n) },
    { poolId: hash(98) },
    { positionId: 0n },
    { liquidity: 0n },
    { sweptQuote: 1n },
    { sweptTokens: 1n },
    { realQuoteReserve: 1n },
    { tokenReserve: 1n },
  ])("rejects incompatible LP projection state %o", async (change) => {
    const test = createTestIndexer();
    await poolCreated(test);
    test.ProLaunch.set({ ...(await test.ProLaunch.getOrThrow(id)), ...change });
    await expect(
      test.process({ chains: { 143: { simulate: [poolTrade()] } } }),
    ).rejects.toThrow("completed positive");
  });
  it.each([
    { token: creator },
    { poolId: hash(0) },
    { poolId: hash(98) },
    { quoteAsset: creator },
    { amountSpent: 0n },
    { amountOut: 0n },
    { trader: zeroAddress },
    { recipient: zeroAddress },
    { recipient: factory },
    { recipient: curve },
    { recipient: policy },
    { recipient: token },
    { recipient: registry },
    { trader: poolRouter },
  ])("rejects foreign or invalid event amounts/accounts %o", async (change) => {
    const test = createTestIndexer();
    await poolCreated(test);
    await expect(
      test.process({
        chains: {
          143: {
            simulate: [
              { ...poolTrade(), params: { ...poolTrade().params, ...change } },
            ],
          },
        },
      }),
    ).rejects.toThrow();
    expect(await test.ProPoolTrade.getAll()).toEqual([]);
  });
  it("rejects source-known infrastructure recipients beyond projected launch components", async () => {
    sourceLoader.mockResolvedValue({
      factory,
      registry,
      infrastructure: [poolRouter, other],
    });
    const test = createTestIndexer();
    await poolCreated(test);
    await expect(
      test.process({ chains: { 143: { simulate: [poolTrade()] } } }),
    ).rejects.toThrow("known infrastructure");
  });
  it("clears old curve valuation on completion even when a resumed projection retained it", async () => {
    const test = createTestIndexer();
    await swept(test);
    test.ProLaunch.set({
      ...(await test.ProLaunch.getOrThrow(id)),
      priceQuoteX18: 123n,
      marketCapQuote: 456n,
    });
    await test.process({
      chains: { 143: { simulate: [deactivated(), finished()] } },
    });
    expect(await test.ProLaunch.getOrThrow(id)).toMatchObject({
      priceQuoteX18: undefined,
      marketCapQuote: undefined,
    });
  });
});
