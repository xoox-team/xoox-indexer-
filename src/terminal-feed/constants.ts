// Reviewed identities of the deployed testnet terminal router. The tests pin them
// to apps/web/public/trade-deployment.json, router-abi.ts and the Solidity source.
export const CHAIN_ID = 10143;
export const ROUTER = "0x79ad9653c42f8fec1e8191b15288861cedcba3f7";
export const ROUTER_START = 69_076_718;
/** The router's immutable wrappedNative(); never read over RPC from a handler. */
export const WMON = "0xfb8bf4c1cc7a94c73d209a149ea2abea852bc541";
/** The router's native MON sentinel (TestnetTradeRouter uses address(0)). */
export const NATIVE = "0x0000000000000000000000000000000000000000";
export const TRADE_EVENT =
  "Trade(address indexed trader,address indexed tokenIn,address indexed tokenOut,address recipient,uint256 amountIn,uint256 amountOut)";
/** seq = blockNumber * SEQ_SCALE + logIndex keeps the feed key sortable. */
export const SEQ_SCALE = 1_000_000;
