import {expect,it} from "vitest";
import {reconcile,type IndexState} from "./store";
import type { LaunchEvent } from "./vendor/xoox-sdk/events";
const event={token:"0x1",curve:"0x2",creator:"0x3",quoteAsset:"0x4",configId:"0",blockNumber:"12",blockHash:"0xaa",transactionHash:"0xbb",logIndex:0} as LaunchEvent;
it("drops orphaned logs when replaying a reorg window",()=>{
  const state={version:1,chainId:1,factory:"0x1",cursor:"20",cursorHash:"0xaa",events:[{...event,blockNumber:"9"},event]} as IndexState;
  expect(reconcile(state,10n,[],21n,"0xcc").events).toHaveLength(1);
});
