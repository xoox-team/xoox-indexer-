import type { Hash } from "viem";
import { mergeLaunchEvents, type LaunchEvent } from "./vendor/xoox-sdk/events";
export type IndexState={version:1;chainId:number;factory:string;cursor:string;cursorHash:Hash;events:LaunchEvent[]};
export function reconcile(state:IndexState,from:bigint,events:LaunchEvent[],cursor:bigint,cursorHash:Hash):IndexState {
  return {...state,cursor:cursor.toString(),cursorHash,events:mergeLaunchEvents(state.events.filter(e=>BigInt(e.blockNumber)<from),events)};
}
