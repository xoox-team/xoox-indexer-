// Vendored from the XOOX SDK; only what the indexer uses.
import { parseAbiItem, type Address, type Hash, type PublicClient } from "viem";
import type { Deployment } from "./config";

export type LaunchEvent = {token:Address;curve:Address;creator:Address;quoteAsset:Address;configId:string;blockNumber:string;blockHash:Hash;transactionHash:Hash;logIndex:number};
export const tokenLaunchedEvent = parseAbiItem("event TokenLaunched(address indexed token,address indexed curve,address indexed creator,address quoteAsset,uint256 configId)");
export function eventKey(event:{transactionHash:Hash;logIndex:number}):string { return `${event.transactionHash.toLowerCase()}:${event.logIndex}`; }
export function mergeLaunchEvents(previous:readonly LaunchEvent[],incoming:readonly LaunchEvent[]):LaunchEvent[] {
  const unique = new Map(previous.map(event=>[eventKey(event),event]));
  for (const event of incoming) unique.set(eventKey(event),event);
  return [...unique.values()].sort((a,b)=>BigInt(a.blockNumber)===BigInt(b.blockNumber) ? a.logIndex-b.logIndex : BigInt(a.blockNumber)<BigInt(b.blockNumber) ? -1 : 1);
}
export function blockRanges(from:bigint,to:bigint,size:bigint):Array<readonly [bigint,bigint]> {
  if (from<0n || size<=0n) throw new Error("Invalid block range.");
  const ranges:Array<readonly [bigint,bigint]> = [];
  for (let start=from;start<=to;start+=size) ranges.push([start,start+size-1n>to?to:start+size-1n]);
  return ranges;
}
export async function loadLaunchEvents(client:PublicClient,deployment:Deployment,options:{fromBlock?:bigint;toBlock?:bigint;chunkSize?:bigint;signal?:AbortSignal}={}):Promise<LaunchEvent[]> {
  const head=options.toBlock ?? await client.getBlockNumber();
  const ranges=blockRanges(options.fromBlock ?? BigInt(deployment.startBlock),head,options.chunkSize ?? 2_000n);
  let events:LaunchEvent[]=[];
  for (const [fromBlock,toBlock] of ranges) {
    options.signal?.throwIfAborted();
    const logs=await client.getLogs({address:deployment.factory,event:tokenLaunchedEvent,fromBlock,toBlock,strict:true});
    events=mergeLaunchEvents(events,logs.filter(log=>!log.removed).map(log=>({token:log.args.token,curve:log.args.curve,creator:log.args.creator,quoteAsset:log.args.quoteAsset,configId:log.args.configId.toString(),blockNumber:log.blockNumber.toString(),blockHash:log.blockHash,transactionHash:log.transactionHash,logIndex:log.logIndex})));
  }
  return events;
}
