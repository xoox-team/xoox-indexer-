import { indexer } from "envio";
import { terminalRouterConfigured } from "./configured";
import { feedRow, sameFeedRow } from "./feed-row";

// One TradeFeed row per router Trade. No RPC, no effects. Registered only where
// the active configuration subscribes TerminalRouter (see ./configured).
if (terminalRouterConfigured())
  indexer.onEvent(
    { contract: "TerminalRouter", event: "Trade" },
    async ({ event, context }) => {
      const row = feedRow(event);
      const existing = await context.TradeFeed.get(row.id);
      if (existing) {
        if (sameFeedRow(existing, row)) return;
        throw new Error("Changed duplicate router Trade; replay required.");
      }
      context.TradeFeed.set(row);
    },
  );
