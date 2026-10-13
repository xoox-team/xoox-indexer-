import { describe, expect, it } from "vitest";
import { feedRow, sameFeedRow, type RouterTradeEvent } from "./feed-row";
import { NATIVE, ROUTER, WMON } from "./constants";

const TOKEN = "0x908df33072c7d7cac6126c8a71156ed49567feed";
const OTHER = "0x9b7865106d9a02bd77fea1f0fbe876d21546feed";
const TRADER = "0x9ad4c8c4c6c8ea9e2b5d7b5ad1a9e0f6b2c3d4e5";
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const TX = `0x${"5cde56c335".padEnd(62, "0")}aa`;

function trade(
  overrides: Partial<Omit<RouterTradeEvent, "params">> & {
    params?: Partial<RouterTradeEvent["params"]>;
  } = {},
): RouterTradeEvent {
  const { params, ...rest } = overrides;
  return {
    chainId: 10143,
    srcAddress: ROUTER,
    logIndex: 6,
    block: { number: 70_261_649, timestamp: 1_791_770_153 },
    transaction: { hash: TX },
    ...rest,
    params: {
      trader: TRADER,
      tokenIn: NATIVE,
      tokenOut: TOKEN,
      recipient: RECIPIENT,
      amountIn: 10n ** 18n,
      amountOut: 73_768_523_909_720_019_785_914n,
      ...params,
    },
  };
}

describe("feedRow", () => {
  it("maps native MON in to a buy of tokenOut valued at amountIn", () => {
    expect(feedRow(trade())).toEqual({
      id: `10143:${TX}:6`,
      chainId: 10143,
      seq: 70_261_649_000_006n,
      blockNumber: 70_261_649n,
      timestamp: 1_791_770_153n,
      transactionHash: TX,
      logIndex: 6,
      router: ROUTER,
      wallet: TRADER,
      recipient: RECIPIENT,
      tokenIn: NATIVE,
      tokenOut: TOKEN,
      amountIn: 10n ** 18n,
      amountOut: 73_768_523_909_720_019_785_914n,
      token: TOKEN,
      side: "buy",
      quoteAmount: 10n ** 18n,
    });
  });

  it("treats WMON in as a buy", () => {
    expect(
      feedRow(trade({ params: { tokenIn: WMON, amountIn: 5n } })),
    ).toMatchObject({
      side: "buy",
      token: TOKEN,
      quoteAmount: 5n,
    });
  });

  it("maps native MON out to a sell of tokenIn valued at amountOut", () => {
    expect(
      feedRow(
        trade({
          params: {
            tokenIn: TOKEN,
            tokenOut: NATIVE,
            amountIn: 7n,
            amountOut: 3n,
          },
        }),
      ),
    ).toMatchObject({ side: "sell", token: TOKEN, quoteAmount: 3n });
  });

  it("treats WMON out as a sell", () => {
    expect(
      feedRow(
        trade({
          params: {
            tokenIn: TOKEN,
            tokenOut: WMON,
            amountIn: 7n,
            amountOut: 4n,
          },
        }),
      ),
    ).toMatchObject({ side: "sell", token: TOKEN, quoteAmount: 4n });
  });

  it("maps token to token to a swap of tokenOut with a zero quote", () => {
    expect(
      feedRow(
        trade({
          params: {
            tokenIn: OTHER,
            tokenOut: TOKEN,
            amountIn: 7n,
            amountOut: 9n,
          },
        }),
      ),
    ).toMatchObject({ side: "swap", token: TOKEN, quoteAmount: 0n });
  });

  it("applies the buy rule first when both sides are MON/WMON (router wrap and unwrap)", () => {
    expect(
      feedRow(
        trade({
          params: {
            tokenIn: NATIVE,
            tokenOut: WMON,
            amountIn: 2n,
            amountOut: 2n,
          },
        }),
      ),
    ).toMatchObject({ side: "buy", token: WMON, quoteAmount: 2n });
    expect(
      feedRow(
        trade({
          params: {
            tokenIn: WMON,
            tokenOut: NATIVE,
            amountIn: 2n,
            amountOut: 2n,
          },
        }),
      ),
    ).toMatchObject({ side: "buy", token: NATIVE, quoteAmount: 2n });
  });

  it("lowercases every address, the transaction hash and the id", () => {
    const row = feedRow(
      trade({
        srcAddress: "0x79ad9653c42F8fec1e8191B15288861CEDCbA3F7",
        transaction: { hash: TX.toUpperCase().replace("0X", "0x") },
        params: {
          trader: "0x9AD4C8C4C6C8EA9E2B5D7B5AD1A9E0F6B2C3D4E5",
          recipient: "0x1111111111111111111111111111111111111111",
          tokenIn: "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541",
          tokenOut: "0x908Df33072c7d7CaC6126c8A71156eD49567FEed",
        },
      }),
    );
    expect(row).toMatchObject({
      id: `10143:${TX}:6`,
      transactionHash: TX,
      router: ROUTER,
      wallet: TRADER,
      tokenIn: WMON,
      tokenOut: TOKEN,
      token: TOKEN,
      side: "buy",
    });
  });

  it("builds a sortable seq and rejects log indexes that would overflow it", () => {
    expect(feedRow(trade({ logIndex: 0 })).seq).toBe(70_261_649_000_000n);
    expect(feedRow(trade({ logIndex: 999_999 })).seq).toBe(70_261_649_999_999n);
    expect(
      feedRow(
        trade({ block: { number: 70_261_650, timestamp: 1 }, logIndex: 0 }),
      ).seq,
    ).toBeGreaterThan(feedRow(trade({ logIndex: 999_999 })).seq);
    expect(() => feedRow(trade({ logIndex: 1_000_000 }))).toThrow(/logIndex/);
    expect(() => feedRow(trade({ logIndex: -1 }))).toThrow(/logIndex/);
    expect(() => feedRow(trade({ logIndex: 1.5 }))).toThrow(/logIndex/);
  });

  it.each([
    ["another chain", trade({ chainId: 1 })],
    ["another emitter", trade({ srcAddress: OTHER })],
    ["a malformed trader", trade({ params: { trader: "0x1234" } })],
    ["a malformed token", trade({ params: { tokenOut: `${TOKEN}00` } })],
    ["a malformed transaction hash", trade({ transaction: { hash: "0xabc" } })],
    ["a negative amount", trade({ params: { amountOut: -1n } })],
    [
      "an unsafe block number",
      trade({ block: { number: 2 ** 53, timestamp: 1 } }),
    ],
    ["a negative timestamp", trade({ block: { number: 1, timestamp: -1 } })],
  ])("rejects %s", (_label, event) => {
    expect(() => feedRow(event)).toThrow();
  });
});

describe("sameFeedRow", () => {
  it("compares every contract field", () => {
    const row = feedRow(trade());
    expect(sameFeedRow(row, { ...row })).toBe(true);
    expect(sameFeedRow(row, { ...row, amountOut: row.amountOut + 1n })).toBe(
      false,
    );
    expect(sameFeedRow(row, { ...row, wallet: RECIPIENT })).toBe(false);
  });
});
