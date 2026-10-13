import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  keccak256,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import {
  PRO_FEE_PROGRAM_CONFIG_ABI,
  proFeeProgramConfigHash,
  type ProFeeProgram,
  type ProFeeProgramModule,
} from "./vendor/xoox-sdk/pro-fee-programs";
import { buildProHolderPopulation } from "./pro-program-snapshots";
import {
  deriveProProgramCycle,
  finalizeProProgramReward,
  planVerifiedProProgramCycle,
  ProProgramActionKind as Kind,
  type ProProgramExecutionInput,
  type ProProgramQuote,
} from "./pro-program-execution";

const address = (number: number) =>
  `0x${number.toString(16).padStart(40, "0")}` as Address;
const hash = (number: number) =>
  `0x${number.toString(16).padStart(64, "0")}` as Hex;
const creator = address(90),
  executor = address(91),
  adapter = address(92),
  asset = address(93),
  other = address(94);
function context(module: number): ProProgramExecutionInput {
  const p: ProFeeProgram = {
    moduleId: module as ProFeeProgramModule,
    weightBps: 10000,
    intervalSeconds: 3600,
    authority: executor,
    recipient: creator,
    asset: [2, 3, 4, 7, 10, 11, 12, 13, 14, 24].includes(module)
      ? asset
      : zeroAddress,
    adapter,
    adapterCodeHash: hash(92),
    nftCollection: module === 6 ? address(95) : zeroAddress,
    minHolding: 0n,
    maxHolding: module === 20 ? 50_000_000n * 10n ** 18n : 0n,
    count: module === 15 ? 3 : module === 16 ? 2 : module === 25 ? 4 : 0,
    burnBps: module === 18 ? 4000 : module === 5 ? 5000 : 0,
    holderBps: module === 18 ? 4000 : module === 10 ? 5000 : 0,
    maxCreatorBps: 0,
    maxWaitSeconds: 0,
    dailySalary: module === 26 ? 10n ** 18n : 0n,
    rulesHash: hash(10),
    allowedAssets:
      module === 25 ? [zeroAddress, asset, other, address(96)] : [],
    recipients:
      module === 9
        ? [
            { wallet: creator, weightBps: 3000 },
            { wallet: address(97), weightBps: 7000 },
          ]
        : [],
  };
  const configuration = {
    poolFeeBps: 200,
    snapshotMaxAge: 86400,
    programs: [p],
  };
  const timestamp = 100_000n,
    blockNumber = 100n,
    blockHash = hash(100);
  return {
    configuration,
    configurationHash: proFeeProgramConfigHash(configuration),
    programIndex: 0,
    source: {
      chainId: 143,
      token: address(1),
      factory: address(2),
      curve: address(3),
      vault: address(4),
      creator,
      configurationHash: hash(1),
      tokenCodeHash: hash(2),
      createdBlock: 10n,
      blockNumber,
      blockHash,
      timestamp,
      tokenDecimals: 18,
      genesisSupply: 1000n,
      cumulativeBurned: 10n,
      currentSupply: 990n,
      balancesComplete: true,
      balancesFromBlock: 10n,
      balancesThroughBlock: blockNumber,
      infrastructure: [adapter],
    },
    quoteAsset: zeroAddress,
    quoteDecimals: 18,
    executor,
    now: timestamp,
    state: {
      budget: 1000n,
      holderCarryQuote: 0n,
      lastCycle: 0n,
      lastCycleAt: 0n,
      waitingSince: 90000n,
      salaryAvailable: 400n,
    },
    balances: [
      { account: address(3), balance: 500n },
      { account: address(4), balance: 100n },
      { account: address(10), balance: 90n },
      { account: address(11), balance: 90n },
      { account: address(12), balance: 110n },
      { account: creator, balance: 100n },
    ],
    assetDecimals: [
      { asset: zeroAddress, decimals: 18 },
      { asset, decimals: 6 },
      { asset: other, decimals: 18 },
      { asset: address(96), decimals: 8 },
    ],
    slippageBps: 500,
    quote: async (request) => ({
      adapter,
      adapterCodeHash: hash(92),
      inputAsset: request.inputAsset,
      outputAsset: request.outputAsset,
      amountIn: request.amountIn,
      amountSpent: request.amountIn,
      amountOut: request.amountIn * 2n,
      blockNumber,
      blockHash,
      deadline: request.deadline,
      data: "0x1234",
      evidence: hash(51),
    }),
    lottery: { seed: hash(20), seedEvidence: hash(21), authority: executor },
    trades: {
      buys: [
        {
          id: "buy:1",
          token: address(1),
          buyer: address(10),
          recipient: address(10),
          quoteAmount: 10n,
          blockNumber: 80n,
          blockHash: hash(80),
          timestamp: 95000n,
          logIndex: 1,
          source: "curve",
        },
      ],
      coverage: [
        {
          token: address(1),
          source: "curve",
          scope: "all-public-swaps",
          complete: true,
          fromTimestamp: 90000n,
          throughTimestamp: timestamp,
          throughBlock: blockNumber,
          throughBlockHash: blockHash,
          evidence: hash(31),
        },
      ],
      windowFrom: 90000n,
      requiredSources: ["curve"],
      consumedLastBuyerIds: [],
    },
    listings: {
      collection: address(95),
      blockHash,
      complete: true,
      evidence: hash(40),
      items: [
        {
          collection: address(95),
          tokenId: 5n,
          price: 50n,
          expiresAt: timestamp + 10000n,
          orderHash: hash(41),
          data: "0xab",
        },
        {
          collection: address(95),
          tokenId: 6n,
          price: 25n,
          expiresAt: timestamp + 10000n,
          orderHash: hash(42),
          data: "0xcd",
        },
      ],
    },
  };
}
function changeProgram(
  input: ProProgramExecutionInput,
  changes: Partial<ProFeeProgram>,
): ProProgramExecutionInput {
  const configuration = {
    ...input.configuration,
    programs: [{ ...input.configuration.programs[0]!, ...changes }],
  };
  return {
    ...input,
    configuration,
    configurationHash: proFeeProgramConfigHash(configuration),
  };
}

describe("All twenty-six immutable revenue program cycle mechanisms", () => {
  it.each([27, 28, 29, 30])(
    "refuses retired module %d before deriving any cycle",
    async (id) => {
      const input = context(1);
      const configuration = {
        ...input.configuration,
        programs: [
          {
            ...input.configuration.programs[0]!,
            moduleId: id as ProFeeProgramModule,
            maxWaitSeconds: id === 28 ? 86400 : 0,
            allowedAssets: id === 29 ? [zeroAddress] : [],
          },
        ],
      };
      await expect(
        deriveProProgramCycle({
          ...input,
          configuration,
          configurationHash: keccak256(
            encodeAbiParameters(PRO_FEE_PROGRAM_CONFIG_ABI, [configuration]),
          ),
        }),
      ).rejects.toThrow(/module ID/);
    },
  );
  it.each(Array.from({ length: 26 }, (_, index) => index + 1))(
    "prepares a concrete bounded M%02d cycle",
    async (id) => {
      const input = context(id),
        plan = await deriveProProgramCycle(input);
      expect(plan.status).toBe("ready");
      expect(plan.moduleId).toBe(id);
      expect(plan.cycle!.actions.length).toBeGreaterThan(0);
      expect(plan.cycle!.actions.length).toBeLessThanOrEqual(8);
      expect(plan.cycle!.id).toBe(1n);
      expect(plan.cycle!.observedAt).toBe(input.source.timestamp);
      expect(plan.cycle!.evidence).not.toBe(zeroHash);
    },
  );
  it("keeps intervals and empty pots unsubmitted and rejects stale/foreign authority state", async () => {
    const input = context(1);
    expect(
      (
        await deriveProProgramCycle({
          ...input,
          state: { ...input.state, budget: 0n },
        })
      ).status,
    ).toBe("empty-budget");
    expect(
      (
        await deriveProProgramCycle({
          ...input,
          state: { ...input.state, lastCycleAt: 99999n },
        })
      ).status,
    ).toBe("not-due");
    await expect(
      deriveProProgramCycle({ ...input, now: input.now + 86401n }),
    ).rejects.toThrow("expired");
    await expect(
      deriveProProgramCycle({ ...input, executor: address(99) }),
    ).rejects.toThrow("authority");
    await expect(
      planVerifiedProProgramCycle({} as never, input),
    ).rejects.toThrow("canonical fee program reader");
  });
  it("produces atomic native holder roots but leaves converted output unpublished until actual funding", async () => {
    const native = await deriveProProgramCycle(context(1)),
      converted = await deriveProProgramCycle(context(4));
    expect(native.cycle!.actions[0]!.root).not.toBe(zeroHash);
    expect(native.rewards[0]!.allocation!.total).toBe(1000n);
    expect(converted.cycle!.actions[0]!.root).toBe(zeroHash);
    expect(converted.rewards[0]!.publicationRequired).toBe(true);
    const receipt = {
      vault: address(4),
      programIndex: 0,
      cycleId: 1n,
      asset,
      reserved: 1901n,
      observedAt: 100000n,
      transactionHash: hash(99),
      receiptBlockHash: hash(101),
      receiptCanonical: true,
      root: zeroHash,
      claimed: 0n,
      now: 200000n,
      snapshotMaxAge: 86400,
    };
    const funded = finalizeProProgramReward(converted, 0, receipt);
    expect(funded.allocation.total).toBe(1901n);
    expect(funded.observedAt).toBe(100000n);
    expect(funded.deadline).toBe(200300n);
    expect(() =>
      finalizeProProgramReward(converted, 0, { ...receipt, asset: other }),
    ).toThrow("receipt");
    expect(() =>
      finalizeProProgramReward(converted, 0, { ...receipt, programIndex: 1 }),
    ).toThrow("receipt");
    expect(() =>
      finalizeProProgramReward(converted, 0, {
        ...receipt,
        receiptCanonical: false,
      }),
    ).toThrow("receipt");
  });
  it("segregates empty Combo holder share while burn and creator continue, then recovers old carry without new fees", async () => {
    const base = context(18),
      empty = changeProgram(base, { minHolding: 1000n });
    const plan = await deriveProProgramCycle(empty);
    expect(plan.cycle!.actions.map((row) => [row.kind, row.amount])).toEqual([
      [Kind.BuyAndBurn, 400n],
      [Kind.HolderCarry, 400n],
      [Kind.Direct, 200n],
    ]);
    const recovery = await deriveProProgramCycle({
      ...base,
      state: { ...base.state, budget: 0n, holderCarryQuote: 777n },
    });
    expect(
      recovery.cycle!.actions.map((row) => [row.kind, row.amount]),
    ).toEqual([[Kind.HolderRoot, 777n]]);
    expect(recovery.cycle!.actions[0]!.root).toBe(zeroHash);
  });
  it("chooses cheapest valid NFT listing independent of order and retains an unaffordable complete pot", async () => {
    const input = context(6),
      plan = await deriveProProgramCycle(input);
    expect(plan.cycle!.actions[0]!.nftId).toBe(6n);
    expect(plan.cycle!.actions[0]!.amount).toBe(1000n);
    expect(
      (
        await deriveProProgramCycle({
          ...input,
          state: { ...input.state, budget: 20n },
        })
      ).status,
    ).toBe("retained");
    await expect(
      deriveProProgramCycle({
        ...input,
        listings: { ...input.listings!, complete: false },
      }),
    ).rejects.toThrow("listings");
  });
  it("requires matching immutable adapter, exact quote currencies, canonical block and slippage ceiling", async () => {
    const input = context(7),
      quote = await input.quote({
        program: input.configuration.programs[0]!,
        inputAsset: zeroAddress,
        outputAsset: asset,
        amountIn: 1000n,
        deadline: 100300n,
        blockHash: input.source.blockHash as Hex,
      });
    for (const alteration of [
      { adapter: other },
      { adapterCodeHash: hash(9) },
      { blockHash: hash(101) },
      { amountIn: 1001n },
      { outputAsset: other },
      { deadline: 100299n },
    ]) {
      await expect(
        deriveProProgramCycle({
          ...input,
          quote: async () => ({ ...quote, ...alteration }) as ProProgramQuote,
        }),
      ).rejects.toThrow("quote");
    }
    await expect(
      deriveProProgramCycle({ ...input, slippageBps: 501 }),
    ).rejects.toThrow("slippage");
    expect((await deriveProProgramCycle(input)).cycle!.actions[0]!.minOut).toBe(
      1900n,
    );
  });
  it("never attributes a reviewed Router subset as an exhaustive v4 buyer window", async () => {
    const input = context(21);
    await expect(
      deriveProProgramCycle({
        ...input,
        trades: { ...input.trades!, requiredSources: ["curve", "pool"] },
      }),
    ).rejects.toThrow("pool");
    await expect(
      deriveProProgramCycle({
        ...input,
        trades: {
          ...input.trades!,
          coverage: input.trades!.coverage.map((row) => ({
            ...row,
            complete: false,
          })),
        },
      }),
    ).rejects.toThrow("coverage");
    const last = context(22);
    await expect(
      deriveProProgramCycle({
        ...last,
        trades: { ...last.trades!, consumedLastBuyerIds: ["buy:1"] },
      }),
    ).rejects.toThrow("already paid");
  });
  it("selects distinct noncreator weighted raffle winners and waits for insufficient entrants", async () => {
    const input = context(16),
      plan = await deriveProProgramCycle(input);
    const winners = plan.cycle!.actions[0]!.beneficiaries;
    expect(new Set(winners).size).toBe(2);
    expect(winners).not.toContain(creator);
    expect(
      (await deriveProProgramCycle(changeProgram(input, { minHolding: 100n })))
        .status,
    ).toBe("retained");
  });
  it("shrinks every Index Fund leg to the same executable quote cost rather than investing unequal amounts", async () => {
    const input = context(25);
    const plan = await deriveProProgramCycle({
      ...input,
      quote: async (request) => {
        const quoted = await input.quote(request);
        return {
          ...quoted,
          amountSpent: request.amountIn > 100n ? 100n : request.amountIn,
          amountOut: 200n,
        };
      },
    });
    expect(plan.cycle!.actions.map((row) => row.amount)).toEqual([
      100n,
      100n,
      100n,
      100n,
    ]);
    expect(
      plan.cycle!.actions.reduce((total, row) => total + row.amount, 0n),
    ).toBe(400n);
  });
  it.each([
    [0, 0n, 101n],
    [3333, 33n, 68n],
    [6000, 60n, 41n],
    [10000, 101n, 0n],
  ])(
    "plans native Treasury share %s with exact rounded USDC cost and native remainder",
    async (share, stableCost, nativeRemainder) => {
      const input = changeProgram(context(10), {
        holderBps: share,
        recipient: other,
      });
      const quoted: ProProgramQuote[] = [];
      const plan = await deriveProProgramCycle({
        ...input,
        state: { ...input.state, budget: 101n },
        quote: async (request) => {
          const result = await input.quote(request);
          quoted.push(result);
          return result;
        },
      });
      const actions = plan.cycle!.actions;
      expect(plan.status).toBe("ready");
      expect(actions.reduce((total, row) => total + row.amount, 0n)).toBe(101n);
      expect(
        actions
          .filter((row) => row.kind === Kind.SwapAndSend)
          .map((row) => [row.amount, row.outputAsset]),
      ).toEqual(stableCost ? [[stableCost, asset]] : []);
      expect(
        actions
          .filter((row) => row.kind === Kind.Direct)
          .map((row) => [row.amount, row.outputAsset]),
      ).toEqual(nativeRemainder ? [[nativeRemainder, zeroAddress]] : []);
      expect(quoted).toHaveLength(stableCost ? 1 : 0);
      for (const quote of quoted) {
        expect(quote.inputAsset).toBe(zeroAddress);
        expect(quote.outputAsset).toBe(asset);
        expect(quote.amountIn).toBe(stableCost);
      }
      expect(input.configuration.programs[0]!.recipient).toBe(other);
    },
  );
  it("requotes a smaller native Treasury allocation when the stable route has a partial capacity", async () => {
    const input = changeProgram(context(10), { holderBps: 6000 });
    const plan = await deriveProProgramCycle({
      ...input,
      state: { ...input.state, budget: 101n },
      quote: async (request) => ({
        ...(await input.quote(request)),
        amountSpent: request.amountIn > 30n ? 30n : request.amountIn,
        amountOut: 654321n,
      }),
    });
    expect(
      plan.cycle!.actions.map((row) => [row.kind, row.amount, row.outputAsset]),
    ).toEqual([
      [Kind.SwapAndSend, 30n, asset],
      [Kind.Direct, 20n, zeroAddress],
    ]);
    expect(plan.cycle!.actions[0]!.minOut).toBe(621604n);
    const evidence = JSON.parse(plan.evidenceJson!);
    expect(evidence.dependencies[0]).toMatchObject({
      inputAsset: zeroAddress,
      outputAsset: asset,
      amountIn: "60",
      amountSpent: "30",
      amountOut: "654321",
    });
    expect(evidence.dependencies[1]).toMatchObject({
      amountIn: "30",
      amountSpent: "30",
      amountOut: "654321",
    });
    expect(
      plan.cycle!.actions.reduce((total, row) => total + row.amount, 0n),
    ).toBe(50n);
  });
  it.each([asset, other])(
    "plans genuine ERC20 Treasury quote %s as stable and native outputs with at most two swaps",
    async (quoteAsset) => {
      const input = context(10);
      let calls = 0;
      const plan = await deriveProProgramCycle({
        ...input,
        quoteAsset,
        quoteDecimals: quoteAsset === asset ? 6 : 18,
        quote: async (request) => {
          calls++;
          return input.quote(request);
        },
      });
      expect(
        plan.cycle!.actions.map((row) => [
          row.kind,
          row.amount,
          row.outputAsset,
        ]),
      ).toEqual([
        [quoteAsset === asset ? Kind.Direct : Kind.SwapAndSend, 500n, asset],
        [Kind.SwapAndSend, 500n, zeroAddress],
      ]);
      expect(calls).toBe(quoteAsset === asset ? 1 : 2);
    },
  );
  it.each([asset, other])(
    "keeps ERC20 Treasury capacities proportional by independently requoting a common allocation for %s",
    async (quoteAsset) => {
      const input = changeProgram(context(10), { holderBps: 6000 });
      const requests: { output: Address; amount: bigint }[] = [];
      const plan = await deriveProProgramCycle({
        ...input,
        quoteAsset,
        quoteDecimals: quoteAsset === asset ? 6 : 18,
        state: { ...input.state, budget: 101n },
        quote: async (request) => {
          requests.push({
            output: request.outputAsset,
            amount: request.amountIn,
          });
          const maximum = request.outputAsset === zeroAddress ? 20n : 35n;
          return {
            ...(await input.quote(request)),
            amountSpent:
              request.amountIn > maximum ? maximum : request.amountIn,
            amountOut:
              request.amountIn > maximum ? maximum * 2n : request.amountIn * 2n,
          };
        },
      });
      expect(
        plan.cycle!.actions.map((row) => [row.amount, row.outputAsset]),
      ).toEqual([
        [30n, asset],
        [20n, zeroAddress],
      ]);
      expect(
        plan.cycle!.actions.reduce((total, row) => total + row.amount, 0n),
      ).toBe(50n);
      expect(
        requests.some(
          (row) => row.output === zeroAddress && row.amount === 20n,
        ),
      ).toBe(true);
      if (quoteAsset !== asset)
        expect(
          requests.some((row) => row.output === asset && row.amount === 30n),
        ).toBe(true);
    },
  );
  it.each([0, 10000])(
    "omits zero Treasury share %s and uses no unnecessary route",
    async (holderBps) => {
      const input = changeProgram(context(10), { holderBps });
      for (const quoteAsset of [zeroAddress, asset, other]) {
        let calls = 0;
        const plan = await deriveProProgramCycle({
          ...input,
          quoteAsset,
          quoteDecimals: quoteAsset === asset ? 6 : 18,
          quote: async (request) => {
            calls++;
            return input.quote(request);
          },
        });
        expect(plan.cycle!.actions).toHaveLength(1);
        const expectedAsset = holderBps === 0 ? zeroAddress : asset;
        expect(plan.cycle!.actions[0]!.outputAsset).toBe(expectedAsset);
        expect(calls).toBe(quoteAsset === expectedAsset ? 0 : 1);
      }
    },
  );
  it("retains Treasury budget after bounded incompatible partial quotes", async () => {
    const input = context(10);
    let calls = 0;
    const plan = await deriveProProgramCycle({
      ...input,
      quoteAsset: other,
      state: { ...input.state, budget: 1000000n },
      quote: async (request) => {
        calls++;
        return {
          ...(await input.quote(request)),
          amountSpent: request.amountIn - 1n,
        };
      },
    });
    expect(plan.status).toBe("retained");
    expect(plan.cycle!.actions.map((row) => row.kind)).toEqual([Kind.Keep]);
    expect(calls).toBe(16);
    expect(plan.reason).toContain("same fixed allocation");
  });
  it("caps salary at the canonical rolling allowance and burns the overflow", async () => {
    const plan = await deriveProProgramCycle(context(26));
    expect(plan.cycle!.actions.map((row) => [row.kind, row.amount])).toEqual([
      [Kind.Direct, 400n],
      [Kind.BuyAndBurn, 600n],
    ]);
  });
  it("preserves complete holder accounting as a requirement rather than issuing roots from partial balances", async () => {
    const input = context(1);
    await expect(
      deriveProProgramCycle({
        ...input,
        source: { ...input.source, balancesComplete: false },
      }),
    ).rejects.toThrow("canonical balance");
    expect(
      buildProHolderPopulation(input.source, input.balances, {
        kind: "pro-rata",
        minHolding: 0n,
      }).members,
    ).toHaveLength(4);
  });
});
