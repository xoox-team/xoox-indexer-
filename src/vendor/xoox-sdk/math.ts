// Vendored from the XOOX SDK; only what the indexer uses.
export const BPS = 10_000n;
/** Exact user input parsing. Excess precision is rejected instead of rounded. */
export function parseAssetAmount(input:string,decimals:number):bigint {
  if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error("Invalid asset decimals.");
  const value=input.trim();
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new Error("Enter a positive decimal amount without exponent notation.");
  const [whole="0",fraction=""]=value.split(".");
  if(fraction.length>decimals)throw new Error(`This asset supports at most ${decimals} decimal places.`);
  const result=BigInt(whole||"0")*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,"0")||"0");
  if(result>(1n<<256n)-1n)throw new Error("Amount exceeds the supported range.");
  return result;
}
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (a < 0n || b <= 0n) throw new Error("Invalid unsigned division.");
  return (a + b - 1n) / b;
}
export function minimumOutput(expected: bigint, slippageBps: number): bigint {
  if (expected < 0n || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000) throw new Error("Slippage must be between 0 and 50%.");
  return expected * (BPS - BigInt(slippageBps)) / BPS;
}
export function marginalPrice(tokenReserve: bigint, realQuoteReserve: bigint, phantomQuote: bigint): bigint {
  if (tokenReserve <= 0n || realQuoteReserve < 0n || phantomQuote <= 0n) throw new Error("Invalid curve reserves.");
  return (realQuoteReserve + phantomQuote) * 10n ** 18n / tokenReserve;
}
export function progressBps(reserve: bigint, threshold: bigint): bigint {
  if (reserve < 0n || threshold <= 0n) throw new Error("Invalid graduation reserves.");
  const result = reserve * BPS / threshold;
  return result > BPS ? BPS : result;
}
