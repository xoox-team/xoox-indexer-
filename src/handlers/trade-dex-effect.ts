import { createEffect, S } from "envio";
import { loadTradeDexEvidence, loadTradeDexTokenMetadata } from "../trade-dex-source";

export const tradeDexEvidenceEffect = createEffect(
  {
    name: "canonicalTradeDexEvidenceV1",
    input: { kind: S.string, source: S.string, blockNumber: S.bigint, blockHash: S.string, token0: S.string, token1: S.string, poolAddress: S.string, fee: S.number, tickSpacing: S.number },
    output: { checkedAt: S.bigint },
    rateLimit: { calls: 5, per: "second" }, crossChain: false, cache: true,
  },
  async ({ input, context }) => loadTradeDexEvidence(context.chain.id, input),
);

export const tradeDexTokenMetadataEffect = createEffect(
  {
    name: "currentTradeDexTokenMetadataV1",
    input: { address: S.string, epoch: S.number },
    output: { name: S.nullable(S.string), symbol: S.nullable(S.string), decimals: S.nullable(S.number), status: S.string, updatedAt: S.bigint },
    rateLimit: { calls: 5, per: "second" }, crossChain: false, cache: true,
  },
  async ({ input, context }) => loadTradeDexTokenMetadata(context.chain.id, input),
);
