// Vendored from the XOOX SDK; only what the indexer uses.
import {BPS,ceilDiv,minimumOutput} from "./math";

export type CurveState={supply:bigint;phantomQuote:bigint;graduationThreshold:bigint;tokenReserve:bigint;realQuoteReserve:bigint;feeBps:bigint;creatorTaxBps:bigint;sellTaxBps?:bigint;readyToGraduate?:boolean;graduated?:boolean;feeSplitVersion?:1|2};
export type BuyQuote={tokensOut:bigint;spent:bigint;refund:bigint;baseFee:bigint;creatorTax:bigint;snipeTax:bigint};
export type SellQuote={quoteOut:bigint;grossQuote:bigint;baseFee:bigint;creatorTax:bigint};
const UINT256_MAX=(1n<<256n)-1n;
function uint(value:bigint,label:string):void {if(value<0n||value>UINT256_MAX) throw new Error(`${label} is outside uint256.`);}
function fees(base:bigint,creator:bigint,snipe=0n):void {if(base<0n||creator<0n||snipe<0n||base+creator+snipe>9_900n) throw new Error("Fees must preserve at least 1% net input.");}
function trading(state:CurveState):void {
  for(const [key,value] of Object.entries(state)) if(typeof value==="bigint") uint(value,key);
  if(state.readyToGraduate||state.graduated||state.realQuoteReserve>=state.graduationThreshold) throw new Error("Trading is closed.");
  if(state.supply===0n||state.phantomQuote===0n||state.tokenReserve===0n||state.tokenReserve>state.supply) throw new Error("Invalid curve reserves.");
  fees(state.feeBps,state.creatorTaxBps);
}
export function tokenReserveAt(supply:bigint,phantomQuote:bigint,realQuote:bigint):bigint {
  return ceilDiv(supply*phantomQuote,phantomQuote+realQuote);
}
export function virtualQuoteAt(supply:bigint,phantomQuote:bigint,tokens:bigint):bigint {
  return ceilDiv(supply*phantomQuote,tokens);
}
export function netFromGross(gross:bigint,totalFeeBps:bigint):bigint {
  uint(gross,"gross");fees(totalFeeBps,0n);
  return gross-gross*totalFeeBps/BPS;
}
export function grossForExactNet(net:bigint,totalFeeBps:bigint):bigint {
  if(net<=0n) throw new Error("Net amount must be positive.");
  fees(totalFeeBps,0n);
  const gross=(net-1n)*BPS/(BPS-totalFeeBps)+1n;
  uint(gross,"gross");return gross;
}
export function splitFees(gross:bigint,baseBps:bigint,creatorBps:bigint,snipeBps=0n,version:1|2=1) {
  uint(gross,"gross");fees(baseBps,creatorBps,snipeBps);
  const total=gross*(baseBps+creatorBps+snipeBps)/BPS;
  const creator=gross*creatorBps/BPS;
  if(version!==1&&version!==2) throw new Error("Unknown fee split version.");
  const snipe=version===2&&baseBps===0n&&snipeBps>0n ? total-creator : gross*snipeBps/BPS;
  return {net:gross-total,base:total-creator-snipe,creator,snipe};
}

/** Recipient-based anti-snipe fee. Omitted version preserves legacy quotes.
 * New curves expose snipeDecayVersion() = 2; use their version explicitly or
 * read currentSnipeTaxBps(recipient) directly for transaction quotes. */
export function currentSnipeTaxBps(params:{elapsed:bigint;duration:bigint;startBps:bigint;feeBps:bigint;creatorTaxBps:bigint;exempt:boolean;decayVersion?:1|2}):bigint {
  const {elapsed,duration,startBps,feeBps,creatorTaxBps,exempt}=params;
  fees(feeBps,creatorTaxBps);
  if(params.decayVersion!==undefined&&params.decayVersion!==1&&params.decayVersion!==2) throw new Error("Unknown snipe decay version.");
  if(elapsed<0n||duration<0n||startBps<0n||startBps>9_900n) throw new Error("Invalid snipe policy.");
  if(exempt||duration===0n||elapsed>=duration) return 0n;
  const stage=elapsed*5n/duration;
  const exponent=params.decayVersion===2 ? elapsed*14n/duration : stage*(stage+3n)/2n;
  const tax=startBps>>exponent,cap=9_900n-feeBps-creatorTaxBps;
  return tax<cap?tax:cap;
}

/** Quotes the original fixed-invariant curve. All inputs are raw integer units.
 * The final buy is clamped to the exact remaining net reserve and unused gross
 * is returned. Use minForQuotedBuy to express the caller's minimum price rate
 * relative to the original gross input, including when the buy is clamped. */
export function quoteBuy(state:CurveState,quoteIn:bigint,snipeBps=0n):BuyQuote {
  trading(state);uint(quoteIn,"quoteIn");
  if(quoteIn===0n) throw new Error("Amount must be positive.");
  const cap=9_900n-state.feeBps-state.creatorTaxBps;
  const snipe=snipeBps>cap?cap:snipeBps;
  fees(state.feeBps,state.creatorTaxBps,snipe);
  const total=state.feeBps+state.creatorTaxBps+snipe;
  const remaining=state.graduationThreshold-state.realQuoteReserve;
  const spent=netFromGross(quoteIn,total)>=remaining?grossForExactNet(remaining,total):quoteIn;
  const fee=splitFees(spent,state.feeBps,state.creatorTaxBps,snipe,state.feeSplitVersion);
  const next=tokenReserveAt(state.supply,state.phantomQuote,state.realQuoteReserve+fee.net);
  const tokensOut=state.tokenReserve-next;
  if(tokensOut<=0n) throw new Error("Trade is below the smallest supported output.");
  return {tokensOut,spent,refund:quoteIn-spent,baseFee:fee.base,creatorTax:fee.creator,snipeTax:fee.snipe};
}
export function quoteSell(state:CurveState,tokensIn:bigint):SellQuote {
  trading(state);uint(tokensIn,"tokensIn");
  if(tokensIn===0n) throw new Error("Amount must be positive.");
  if(tokensIn>state.supply-state.tokenReserve) throw new Error("Sell amount exceeds circulating supply.");
  const next=virtualQuoteAt(state.supply,state.phantomQuote,state.tokenReserve+tokensIn);
  const grossQuote=state.phantomQuote+state.realQuoteReserve-next;
  if(grossQuote<=0n) throw new Error("Trade is below the smallest supported output.");
  const fee=splitFees(grossQuote,state.feeBps,state.sellTaxBps??state.creatorTaxBps,0n,state.feeSplitVersion);
  if(fee.net===0n) throw new Error("Trade is below the smallest supported output.");
  return {quoteOut:fee.net,grossQuote,baseFee:fee.base,creatorTax:fee.creator};
}
/** minTokensOut is a price-rate bound expressed at the original gross input.
 * The contract scales it by spent / quoteIn (rounding up) on a partial fill. */
export function minForQuotedBuy(quoteIn:bigint,spent:bigint,tokensOut:bigint,slippageBps:number):bigint {
  if(quoteIn<=0n||spent<=0n||spent>quoteIn||tokensOut<=0n) throw new Error("Invalid partial-fill quote.");
  const result=minimumOutput(tokensOut*quoteIn,slippageBps)/spent;
  uint(result,"minTokensOut");return result;
}

/** Indicative fully diluted curve cap at the net quote-reserve threshold.
 * All results use raw quote/token units. This is not a USD oracle trigger or a
 * guarantee of the price after migration, and excludes creator/protocol fees.
 */
export function graduationMetrics(config: Pick<CurveState, "supply" | "phantomQuote" | "graduationThreshold">, totalSupply = config.supply) {
  if (totalSupply <= 0n || config.supply <= 0n || config.phantomQuote <= 0n || config.graduationThreshold <= 0n) throw new Error("Invalid graduation configuration.");
  const tokensForLiquidity = tokenReserveAt(config.supply, config.phantomQuote, config.graduationThreshold);
  return {
    quoteTarget: config.graduationThreshold,
    tokensForLiquidity,
    tokensSold: config.supply - tokensForLiquidity,
    indicativeMarketCap: (config.phantomQuote + config.graduationThreshold) * totalSupply / tokensForLiquidity,
  };
}
