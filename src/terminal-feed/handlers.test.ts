import { describe, expect, it } from "vitest";
import { createTestIndexer, type TradeFeed } from "envio";
import { decodeEventLog, parseAbiItem, type Address, type Hex } from "viem";
import real from "../test/router-trades.json";
import terminalFeedFixture from "../../test-fixtures/terminal-feed/router-trades.json";
import { feedRow as terminalFeedRow } from "../../test-fixtures/terminal-feed/feed-row";
import { NATIVE, ROUTER, TRADE_EVENT, WMON } from "./constants";
import "../handlers/index";

const abi = [parseAbiItem(`event ${TRADE_EVENT}`)];
type Log = (typeof real.logs)[number];

function simulated(log: Log) {
  const { args } = decodeEventLog({
    abi,
    data: log.data as Hex,
    topics: log.topics as [Hex, ...Hex[]],
  });
  // viem returns checksummed addresses; the handler must normalize them.
  return {
    contract: "TerminalRouter" as const,
    event: "Trade" as const,
    srcAddress: log.address as Address,
    block: {
      number: Number(BigInt(log.blockNumber)),
      hash: log.blockHash,
      timestamp: Number(BigInt(log.timestamp)),
    },
    transaction: { hash: log.transactionHash },
    logIndex: Number(BigInt(log.logIndex)),
    params: args,
  };
}

async function run(
  test: ReturnType<typeof createTestIndexer>,
  events: ReturnType<typeof simulated>[],
) {
  // Runtime fixture shape is checked by the real Envio ABI registration.
  await test.process({
    chains: { 10143: { simulate: events } },
  } as Parameters<typeof test.process>[0]);
}

describe("TerminalRouter.Trade handler on real testnet logs", () => {
  it("is a real fixture from the deployed router", () => {
    expect(real.router).toBe(ROUTER);
    expect(real.wrappedNative).toBe(WMON);
    expect(real.logs.length).toBeGreaterThanOrEqual(8);
    expect(real.logs.every((log) => log.address.toLowerCase() === ROUTER)).toBe(
      true,
    );
  });

  it("writes one contract-shaped TradeFeed row per router Trade log", async () => {
    const test = createTestIndexer();
    await run(test, real.logs.map(simulated));
    const rows = await test.TradeFeed.getAll();
    expect(rows).toHaveLength(real.logs.length);
    for (const log of real.logs) {
      const { args } = decodeEventLog({
        abi,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const blockNumber = BigInt(log.blockNumber),
        logIndex = Number(BigInt(log.logIndex));
      const id = `10143:${log.transactionHash.toLowerCase()}:${logIndex}`;
      const row = await test.TradeFeed.getOrThrow(id);
      expect(row).toEqual({
        id,
        chainId: 10143,
        seq: blockNumber * 1_000_000n + BigInt(logIndex),
        blockNumber,
        timestamp: BigInt(log.timestamp),
        transactionHash: log.transactionHash.toLowerCase(),
        logIndex,
        router: ROUTER,
        wallet: args.trader.toLowerCase(),
        recipient: args.recipient.toLowerCase(),
        tokenIn: args.tokenIn.toLowerCase(),
        tokenOut: args.tokenOut.toLowerCase(),
        amountIn: args.amountIn,
        amountOut: args.amountOut,
        token: args.tokenOut.toLowerCase(),
        side: "buy",
        quoteAmount: args.amountIn,
      } satisfies TradeFeed);
    }
  });

  it("records real MON-to-token buys and router MON-to-WMON wraps as buys", async () => {
    const test = createTestIndexer();
    await run(test, real.logs.map(simulated));
    const rows = await test.TradeFeed.getAll();
    const wraps = rows.filter((row) => row.tokenOut === WMON);
    expect(wraps.length).toBeGreaterThanOrEqual(1);
    expect(
      wraps.every((row) => row.tokenIn === NATIVE && row.token === WMON),
    ).toBe(true);
    const buys = rows.filter((row) => row.tokenOut !== WMON);
    expect(new Set(buys.map((row) => row.token)).size).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      rows.every(
        (row) => row.side === "buy" && row.quoteAmount === row.amountIn,
      ),
    ).toBe(true);
    expect(rows.every((row) => /^[0-9a-f:x]+$/.test(row.id))).toBe(true);
  });

  it("classifies sells and token-to-token swaps", async () => {
    const test = createTestIndexer();
    const buys = real.logs
      .map(simulated)
      .filter((event) => event.params.tokenOut.toLowerCase() !== WMON);
    const base = buys[0]!;
    const token = base.params.tokenOut;
    const other = buys
      .map((event) => event.params.tokenOut)
      .find((address) => address.toLowerCase() !== token.toLowerCase())!;
    const sell = {
      ...base,
      logIndex: base.logIndex + 1,
      params: {
        ...base.params,
        tokenIn: token,
        tokenOut: WMON as Address,
        amountIn: 5n,
        amountOut: 2n,
      },
    };
    const swap = {
      ...base,
      logIndex: base.logIndex + 2,
      params: {
        ...base.params,
        tokenIn: token,
        tokenOut: other,
        amountIn: 5n,
        amountOut: 9n,
      },
    };
    await run(test, [sell, swap]);
    const tx = base.transaction.hash.toLowerCase();
    expect(
      await test.TradeFeed.getOrThrow(`10143:${tx}:${sell.logIndex}`),
    ).toMatchObject({
      side: "sell",
      token: token.toLowerCase(),
      quoteAmount: 2n,
    });
    expect(
      await test.TradeFeed.getOrThrow(`10143:${tx}:${swap.logIndex}`),
    ).toMatchObject({
      side: "swap",
      token: other.toLowerCase(),
      quoteAmount: 0n,
    });
  });

  it("keeps one row when the same event is delivered again", async () => {
    const test = createTestIndexer();
    const event = simulated(real.logs[0]!);
    await run(test, [event]);
    const replay = createTestIndexer();
    for (const row of await test.TradeFeed.getAll()) replay.TradeFeed.set(row);
    await run(replay, [event]);
    expect(await replay.TradeFeed.getAll()).toEqual(
      await test.TradeFeed.getAll(),
    );
  });

  it("refuses a changed duplicate instead of overwriting it", async () => {
    const test = createTestIndexer();
    const event = simulated(real.logs[0]!);
    await run(test, [event]);
    const replay = createTestIndexer();
    for (const row of await test.TradeFeed.getAll())
      replay.TradeFeed.set({ ...row, amountOut: row.amountOut + 1n });
    await expect(run(replay, [event])).rejects.toThrow(
      /Changed duplicate router Trade/,
    );
  });
});

describe("parity with the deployed terminal-feed source", () => {
  it("runs the terminal-feed fixture logs unchanged", () => {
    expect(real).toEqual(terminalFeedFixture);
  });

  it("writes the rows terminal-feed's own feedRow builds, for fixture buys, sells and swaps", async () => {
    const fixtures = real.logs.map(simulated);
    const buys = fixtures.filter(
      (event) => event.params.tokenOut.toLowerCase() !== WMON,
    );
    const base = buys[0]!;
    const token = base.params.tokenOut;
    const other = buys
      .map((event) => event.params.tokenOut)
      .find((address) => address.toLowerCase() !== token.toLowerCase())!;
    const sell = {
      ...base,
      logIndex: base.logIndex + 1,
      params: {
        ...base.params,
        tokenIn: token,
        tokenOut: WMON as Address,
        amountIn: 5n,
        amountOut: 2n,
      },
    };
    const swap = {
      ...base,
      logIndex: base.logIndex + 2,
      params: {
        ...base.params,
        tokenIn: token,
        tokenOut: other,
        amountIn: 5n,
        amountOut: 9n,
      },
    };
    const events = [...fixtures, sell, swap];
    const test = createTestIndexer();
    await run(test, events);
    const byId = (left: { id: string }, right: { id: string }) =>
      left.id.localeCompare(right.id);
    const expected = events
      .map((event) =>
        terminalFeedRow({
          chainId: 10143,
          srcAddress: event.srcAddress,
          logIndex: event.logIndex,
          block: event.block,
          transaction: event.transaction,
          params: event.params,
        }),
      )
      .sort(byId);
    expect([...(await test.TradeFeed.getAll())].sort(byId)).toEqual(expected);
    expect(new Set(expected.map((row) => row.side))).toEqual(
      new Set(["buy", "sell", "swap"]),
    );
  });
});
