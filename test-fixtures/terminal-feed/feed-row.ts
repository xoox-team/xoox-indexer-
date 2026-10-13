import { CHAIN_ID, NATIVE, ROUTER, SEQ_SCALE, WMON } from "./constants";

/** The router Trade event fields the feed needs, as Envio delivers them. */
export type RouterTradeEvent = Readonly<{
  chainId: number;
  srcAddress: string;
  logIndex: number;
  block: Readonly<{ number: number; timestamp: number }>;
  transaction: Readonly<{ hash: string }>;
  params: Readonly<{
    trader: string;
    tokenIn: string;
    tokenOut: string;
    recipient: string;
    amountIn: bigint;
    amountOut: bigint;
  }>;
}>;

export type FeedSide = "buy" | "sell" | "swap";

/** One TradeFeed row; the field set is the shared contract with the web. */
export type FeedRow = Readonly<{
  id: string;
  chainId: number;
  seq: bigint;
  blockNumber: bigint;
  timestamp: bigint;
  transactionHash: string;
  logIndex: number;
  router: string;
  wallet: string;
  recipient: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  token: string;
  side: FeedSide;
  quoteAmount: bigint;
}>;

const FIELDS = [
  "id",
  "chainId",
  "seq",
  "blockNumber",
  "timestamp",
  "transactionHash",
  "logIndex",
  "router",
  "wallet",
  "recipient",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "token",
  "side",
  "quoteAmount",
] as const satisfies readonly (keyof FeedRow)[];

function address(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`Router Trade ${field} is not an address.`);
  return value.toLowerCase();
}

function integer(
  value: number,
  field: string,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error(`Router Trade ${field} is out of range.`);
  return value;
}

function amount(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n)
    throw new Error(`Router Trade ${field} is not a uint256.`);
  return value;
}

const isQuote = (token: string) => token === NATIVE || token === WMON;

/** Build the TradeFeed row for one TestnetTradeRouter Trade event. Pure, no RPC. */
export function feedRow(event: RouterTradeEvent): FeedRow {
  if (event.chainId !== CHAIN_ID)
    throw new Error("Router Trade is from another chain.");
  const router = address(event.srcAddress, "emitter");
  // WMON classification is only valid for this router's immutable wrappedNative.
  if (router !== ROUTER)
    throw new Error("Router Trade is from an unexpected emitter.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(event.transaction.hash))
    throw new Error("Router Trade transaction hash is malformed.");
  const transactionHash = event.transaction.hash.toLowerCase();
  const logIndex = integer(event.logIndex, "logIndex", SEQ_SCALE - 1);
  const blockNumber = BigInt(integer(event.block.number, "block number"));
  const timestamp = BigInt(integer(event.block.timestamp, "timestamp"));
  const tokenIn = address(event.params.tokenIn, "tokenIn");
  const tokenOut = address(event.params.tokenOut, "tokenOut");
  const amountIn = amount(event.params.amountIn, "amountIn");
  const amountOut = amount(event.params.amountOut, "amountOut");
  // Contract rule order: a MON/WMON input is a buy, then a MON/WMON output is a sell.
  const [side, token, quoteAmount]: [FeedSide, string, bigint] = isQuote(
    tokenIn,
  )
    ? ["buy", tokenOut, amountIn]
    : isQuote(tokenOut)
      ? ["sell", tokenIn, amountOut]
      : ["swap", tokenOut, 0n];
  return {
    id: `${CHAIN_ID}:${transactionHash}:${logIndex}`,
    chainId: CHAIN_ID,
    seq: blockNumber * BigInt(SEQ_SCALE) + BigInt(logIndex),
    blockNumber,
    timestamp,
    transactionHash,
    logIndex,
    router,
    wallet: address(event.params.trader, "trader"),
    recipient: address(event.params.recipient, "recipient"),
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    token,
    side,
    quoteAmount,
  };
}

export function sameFeedRow(
  left: Readonly<Record<(typeof FIELDS)[number], unknown>>,
  right: FeedRow,
): boolean {
  return FIELDS.every((field) => left[field] === right[field]);
}
