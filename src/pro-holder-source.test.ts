import { beforeEach, describe, expect, it, vi } from "vitest";
const authenticate = vi.hoisted(() => vi.fn());
const authenticateProgram = vi.hoisted(() => vi.fn());
const authenticateGraduation = vi.hoisted(() => vi.fn());
vi.mock("./vendor/xoox-sdk/pro-bootstrap", async (original) => ({
  ...(await original<typeof import("./vendor/xoox-sdk/pro-bootstrap")>()),
  readProBootstrapInfrastructure: authenticate,
}));
vi.mock("./vendor/xoox-sdk/pro-fee-program-launch", async (original) => ({
  ...(await original<
    typeof import("./vendor/xoox-sdk/pro-fee-program-launch")
  >()),
  readProFeeProgramLaunch: authenticateProgram,
}));
vi.mock("./vendor/xoox-sdk/pro-fee-program-graduation", async (original) => ({
  ...(await original<
    typeof import("./vendor/xoox-sdk/pro-fee-program-graduation")
  >()),
  readProFeeProgramGraduationInfrastructure: authenticateGraduation,
}));
import { proOpeningBuyAbi } from "./vendor/xoox-sdk/pro-opening-buy";
import type { ProBootstrapSourceManifest } from "./vendor/xoox-sdk/pro-bootstrap";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  proHolderSourceAbi,
  readProHolderSource,
  type ProHolderSourceInput,
} from "./pro-holder-source";
const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const factory = address(1),
  token = address(2),
  curve = address(3),
  policy = address(4),
  creator = address(5),
  vault = address(6);
const input: ProHolderSourceInput = {
  factory,
  token,
  curve,
  policy,
  creator,
  configurationHash: hash(55),
  supply: 1000n,
  blockNumber: 10n,
  blockHash: hash(10),
  timestamp: 100n,
  transactionHash: hash(1000),
  launchLogIndex: 5,
};
const manifest = (version: 1 | 4) =>
  ({
    schema: "xoox.pro-token.bootstrap-source",
    version,
    reviewId: "unit-source-review",
    chainId: 143n,
    factory,
    configuration: { price: false, reactive: false, peak: false },
    artifacts: {},
  }) as unknown as ProBootstrapSourceManifest;
function fixture(version: 1 | 4 = 1) {
  const values = new Map<string, unknown>([
    [`${factory}:curveOf`, curve],
    [`${factory}:policyOf`, policy],
    [`${factory}:creatorOf`, creator],
    [`${factory}:configurationHash`, input.configurationHash],
    [`${token}:curve`, curve],
    [`${token}:policy`, policy],
    [`${token}:totalSupply`, version === 4 ? 990n : 1000n],
    [`${token}:decimals`, 18],
    [`${token}:programVault`, vault],
    [`${token}:genesisSupply`, 1000n],
    [`${token}:cumulativeBurned`, 10n],
    [`${token}:feeProgramVersion`, 4n],
    [`${vault}:factory`, factory],
    [`${vault}:token`, token],
    [`${vault}:curve`, curve],
    [`${vault}:feeProgramVersion`, 4n],
  ]);
  const event = proOpeningBuyAbi.find(
    (entry) => entry.type === "event" && entry.name === "LaunchCreated",
  )!;
  const metadata = {
    name: "Program",
    symbol: "PRG",
    description: "",
    image: "",
    website: "",
    twitter: "",
    telegram: "",
  };
  const config = {
    quoteAsset: zeroAddress,
    phantomQuote: 100n,
    graduationThreshold: 0n,
    baseFeeBps: 0,
    buyTaxBps: 0,
    sellTaxBps: 0,
    perpetual: true,
    feeRecipient: vault,
  };
  const logs = [
    {
      address: token,
      topics: encodeEventTopics({
        abi: proHolderSourceAbi,
        eventName: "Transfer",
        args: { from: zeroAddress, to: curve },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [1000n]),
      logIndex: "0x1",
      transactionHash: input.transactionHash,
      blockHash: input.blockHash,
      blockNumber: "0xa",
      transactionIndex: "0x0",
      removed: false,
    },
    {
      address: factory,
      topics: encodeEventTopics({
        abi: proOpeningBuyAbi,
        eventName: "LaunchCreated",
        args: { creator, token, curveAddress: curve },
      }),
      data: encodeAbiParameters(
        event.inputs.filter((item) => !("indexed" in item && item.indexed)),
        [
          policy,
          1000n,
          input.configurationHash,
          hash(66),
          metadata,
          config,
          [],
          [],
          hash(77),
          1000n,
        ],
      ),
      logIndex: "0x5",
      transactionHash: input.transactionHash,
      blockHash: input.blockHash,
      blockNumber: "0xa",
      transactionIndex: "0x0",
      removed: false,
    },
  ];
  const state = {
    chain: 143,
    blockHash: input.blockHash,
    finalHash: input.blockHash,
    timestamp: 100n,
    receiptHash: input.blockHash,
    receiptStatus: "0x1",
    malformed: false,
    code: "0x6000",
    reads: 0,
  };
  const calls: { method: string; params: unknown }[] = [];
  const client = createPublicClient({
    transport: custom(
      {
        async request({ method, params }) {
          calls.push({ method, params });
          if (method === "eth_chainId") return toHex(state.chain);
          if (method === "eth_getBlockByNumber")
            return {
              number: "0xa",
              hash: state.reads++ === 0 ? state.blockHash : state.finalHash,
              timestamp: toHex(state.timestamp),
            };
          if (method === "eth_getCode") return state.code;
          if (method === "eth_getTransactionReceipt")
            return {
              status: state.receiptStatus,
              blockNumber: "0xa",
              blockHash: state.receiptHash,
              transactionHash: input.transactionHash,
              logs,
              transactionIndex: "0x0",
              from: creator,
              to: factory,
              cumulativeGasUsed: "0x1",
              gasUsed: "0x1",
              effectiveGasPrice: "0x1",
              logsBloom: `0x${"00".repeat(256)}`,
              type: "0x2",
            };
          if (method === "eth_call") {
            const [{ to, data }] = params as [{ to: Address; data: Hex }];
            const decoded = decodeFunctionData({
              abi: proHolderSourceAbi,
              data,
            });
            const value = values.get(`${to}:${decoded.functionName}`);
            if (value === undefined) throw new Error("unexpected getter");
            const result = encodeFunctionResult({
              abi: proHolderSourceAbi,
              functionName: decoded.functionName,
              result: value,
            } as never);
            return state.malformed ? `${result}00` : result;
          }
          throw new Error(`unexpected RPC ${method}`);
        },
      },
      { retryCount: 0 },
    ),
  });
  return { client, state, values, calls, logs, manifest: manifest(version) };
}
beforeEach(() => {
  authenticateGraduation
    .mockReset()
    .mockResolvedValue({
      blockNumber: input.blockNumber,
      blockHash: input.blockHash,
      components: {
        poolManager: { address: address(80) },
        hook: { address: address(81) },
      },
    });
  authenticate
    .mockReset()
    .mockImplementation(async (_client, _factory, review) => ({
      sourceReview: { version: review.version, reviewId: "unit-source-review" },
      components: {
        factory: { address: factory },
        router: { address: address(8) },
      },
    }));
  authenticateProgram.mockReset().mockResolvedValue({
    factory,
    token,
    curve,
    policy,
    creator,
    vault,
    launchConfigurationHash: input.configurationHash,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    quoteAsset: zeroAddress,
    configuration: {
      programs: [{ adapter: zeroAddress }, { adapter: address(9) }],
    },
  });
});
describe("canonical reviewed Pro holder genesis source", () => {
  it("accepts separately reviewed genuine source4 graduation at the canonical creation snapshot", async () => {
    const f = fixture(4);
    const review = {
      schema: "xoox.pro-token.fee-program-graduation.reviewed-artifacts",
      version: 4,
      reviewId: "independent unit graduation",
      chainId: 143n,
      factory,
      artifacts: {},
    } as unknown as import("./vendor/xoox-sdk/pro-fee-program-graduation").ProFeeProgramGraduationSourceManifest;
    const result = await readProHolderSource(
      f.client,
      143,
      f.manifest,
      input,
      review,
    );
    expect(authenticateGraduation).toHaveBeenCalledWith(
      f.client,
      expect.anything(),
      review,
    );
    expect(authenticateProgram.mock.calls[0]?.[3]).toMatchObject({
      blockHash: input.blockHash,
    });
    expect(result.infrastructure).toEqual(
      expect.arrayContaining([address(80), address(81)]),
    );
    authenticateGraduation.mockResolvedValueOnce({
      blockNumber: input.blockNumber,
      blockHash: hash(99),
      components: {},
    });
    await expect(
      readProHolderSource(f.client, 143, f.manifest, input, review),
    ).rejects.toThrow("snapshot differs");
    const legacy = fixture(1);
    await expect(
      readProHolderSource(legacy.client, 143, legacy.manifest, input, review),
    ).rejects.toThrow("legacy source");
  });
  it("binds reviewed Factory mappings, product getters and exact constructor receipt mint", async () => {
    const f = fixture();
    const result = await readProHolderSource(f.client, 143, f.manifest, input);
    expect(result).toMatchObject({
      sourceVersion: 1,
      tokenDecimals: 18,
      mintLogIndex: 1,
      programVault: "",
      cumulativeBurned: 0n,
    });
    expect(authenticate).toHaveBeenCalledWith(f.client, factory, f.manifest, {
      chainId: 143n,
      blockNumber: 10n,
      blockHash: hash(10),
      blockTimestamp: 100n,
    });
    for (const call of f.calls.filter((c) =>
      ["eth_call", "eth_getCode"].includes(c.method),
    ))
      expect((call.params as unknown[])[1]).toEqual({
        blockHash: input.blockHash,
        requireCanonical: true,
      });
  });
  it("reconciles only explicit reviewed program profile4 and genuine Vault binding", async () => {
    const f = fixture(4);
    expect(
      await readProHolderSource(f.client, 143, f.manifest, input),
    ).toMatchObject({
      sourceVersion: 4,
      programVault: vault,
      cumulativeBurned: 10n,
    });
    f.values.set(`${vault}:token`, address(50));
    await expect(
      readProHolderSource(f.client, 143, f.manifest, input),
    ).rejects.toThrow("Vault binding");
  });
  it.each(["curveOf", "policyOf", "creatorOf", "configurationHash"])(
    "rejects Factory registration mismatch %s",
    async (getter) => {
      const f = fixture();
      f.values.set(
        `${factory}:${getter}`,
        getter === "configurationHash" ? hash(99) : address(99),
      );
      await expect(
        readProHolderSource(f.client, 143, f.manifest, input),
      ).rejects.toThrow("binding differs");
    },
  );
  it("rejects missing, inexact or later constructor mint evidence", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.logs.splice(0, 1);
      },
      (f: ReturnType<typeof fixture>) => {
        f.logs[0]!.data = encodeAbiParameters([{ type: "uint256" }], [999n]);
      },
      (f: ReturnType<typeof fixture>) => {
        f.logs[0]!.logIndex = "0x6";
      },
    ]) {
      const f = fixture();
      mutate(f);
      await expect(
        readProHolderSource(f.client, 143, f.manifest, input),
      ).rejects.toThrow("constructor mint");
    }
  });
  it("rejects stale canonical identity, receipt reorg and end-of-read reorg", async () => {
    for (const change of [
      { blockHash: hash(99) },
      { receiptHash: hash(99) },
      { finalHash: hash(99) },
      { chain: 144 },
    ]) {
      const f = fixture();
      Object.assign(f.state, change);
      await expect(
        readProHolderSource(f.client, 143, f.manifest, input),
      ).rejects.toThrow(/canonical/);
    }
  });
  it("refuses unavailable review, noncanonical getter bytes, failed receipts and changed units", async () => {
    const f = fixture();
    authenticate.mockRejectedValueOnce(new Error("source4 review unavailable"));
    await expect(
      readProHolderSource(f.client, 143, f.manifest, input),
    ).rejects.toThrow("review unavailable");
    for (const change of [
      { malformed: true },
      { receiptStatus: "0x0" },
      { code: "0x" },
    ]) {
      const item = fixture();
      Object.assign(item.state, change);
      await expect(
        readProHolderSource(item.client, 143, item.manifest, input),
      ).rejects.toThrow();
    }
    const units = fixture();
    units.values.set(`${token}:decimals`, 6);
    await expect(
      readProHolderSource(units.client, 143, units.manifest, input),
    ).rejects.toThrow("units");
  });
  it("never treats burned supply as legacy source acceptance", async () => {
    const f = fixture();
    f.values.set(`${token}:totalSupply`, 990n);
    await expect(
      readProHolderSource(f.client, 143, f.manifest, input),
    ).rejects.toThrow("legacy supply");
  });
  it("requires genuine complete source4 launch approval and pins configured adapter exclusions", async () => {
    const f = fixture(4);
    const result = await readProHolderSource(f.client, 143, f.manifest, input);
    expect(result.infrastructure).toContain(address(9));
    expect(authenticateProgram).toHaveBeenCalledOnce();
    authenticateProgram.mockRejectedValueOnce(
      new Error("poolHook requires independently reviewed graduation source"),
    );
    await expect(
      readProHolderSource(f.client, 143, f.manifest, input),
    ).rejects.toThrow("independently reviewed");
  });
});
