import { createEffect, S } from "envio";
import { loadRoyaltyRecipients } from "../royalty-recipients";

export const royaltyRecipientsEffect = createEffect(
  {
    name: "canonicalRoyaltyRecipientsV1",
    input: {
      factory: S.string,
      router: S.string,
      token: S.string,
      quote: S.string,
      splitter: S.string,
      blockNumber: S.bigint,
      blockHash: S.string,
      buyTaxBps: S.number,
      sellTaxBps: S.number,
      minimumHolderBalance: S.bigint,
      optionsHash: S.string,
    },
    output: S.array(S.schema({ account: S.string, shareBps: S.number })),
    rateLimit: { calls: 5, per: "second" },
    crossChain: false,
    cache: true,
  },
  async ({ input, context }) => loadRoyaltyRecipients(context.chain.id, input),
);
