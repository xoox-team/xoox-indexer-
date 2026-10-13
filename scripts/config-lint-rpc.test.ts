import { afterEach, describe, expect, it } from "vitest";
import { lintConfig, rpcProblems } from "./config-lint-lib";
import {
  chainOf,
  fresh,
  place,
  removeScratch,
  type Config,
} from "./config-lint-fixtures";
import {
  HUGINN_RPC,
  MONAD_PUBLIC_RPC,
  POSTHUMAN_RPC,
} from "./generate-config-lib";

afterEach(removeScratch);

// Every effect reads rpc[0].url (the Pro loaders) or INDEXER_CONTRACT_RPC_URL (royalty, TradeDex), which must equal it,
// and needs an archive eth_call; P1 found that only on the public node. So the lint pins the whole shape: the archive
// public node first as the logs fallback, then two head pollers in either order that share a role.
describe("rpc order and shape", () => {
  const variants = ["standard", "breakglass"] as const;
  const swapped = (variant: (typeof variants)[number]): Config => {
    const config = fresh(variant);
    const rpc = chainOf(config).rpc!;
    [rpc[1], rpc[2]] = [rpc[2]!, rpc[1]!];
    return config;
  };
  const lintVariant = async (
    variant: (typeof variants)[number],
    mutate: (config: Config) => void,
    env: Record<string, string | undefined> = {},
  ) => {
    const config = fresh(variant);
    mutate(config);
    return lintConfig(await place(config), { env });
  };

  it.each(variants)("accepts the generated %s rpc block", (variant) => {
    expect(rpcProblems(chainOf(fresh(variant)), {})).toEqual([]);
  });

  it.each(variants)(
    "accepts Huginn before POSTHUMAN in the %s variant",
    async (variant) => {
      const config = swapped(variant);
      expect(chainOf(config).rpc!.map((entry) => entry.url)).toEqual([
        MONAD_PUBLIC_RPC,
        HUGINN_RPC,
        POSTHUMAN_RPC,
      ]);
      const path = await place(config);
      expect(lintConfig(path, { env: {} })).toEqual([]);
      expect(
        lintConfig(path, { env: { INDEXER_CONTRACT_RPC_URL: MONAD_PUBLIC_RPC } }),
      ).toEqual([]);
      // INDEXER_CONTRACT_RPC_URL has to be the archive rpc[0], never a poller.
      expect(
        lintConfig(path, { env: { INDEXER_CONTRACT_RPC_URL: HUGINN_RPC } }),
      ).toEqual([expect.stringMatching(/INDEXER_CONTRACT_RPC_URL/)]);
    },
  );

  const faults: [string, (config: Config) => void, RegExp][] = [
    [
      "a poller first",
      (config) => {
        const rpc = chainOf(config).rpc!;
        chainOf(config).rpc = [rpc[1]!, rpc[0]!, rpc[2]!];
      },
      /rpc\[0\]\.url must be the reviewed archive endpoint/,
    ],
    [
      "rpc[0].for set to realtime",
      (config) => {
        chainOf(config).rpc![0]!.for = "realtime";
      },
      /rpc\[0\]\.for must be fallback/,
    ],
    [
      "a single rpc entry",
      (config) => {
        chainOf(config).rpc = [chainOf(config).rpc![0]!];
      },
      /rpc must hold exactly 3 entries, found 1/,
    ],
    [
      "only one poller and no archive entry",
      (config) => {
        chainOf(config).rpc = [chainOf(config).rpc![1]!];
      },
      /rpc must hold exactly 3 entries, found 1/,
    ],
    [
      "no realtime or sync entry among three",
      (config) => {
        for (const entry of chainOf(config).rpc!) entry.for = "fallback";
      },
      /rpc\[1\]\.for and rpc\[2\]\.for must be the same role/,
    ],
    [
      "a duplicated poller url",
      (config) => {
        chainOf(config).rpc![2]!.url = POSTHUMAN_RPC;
      },
      /rpc\[1\] and rpc\[2\] must be the two reviewed head pollers, each once/,
    ],
    [
      "one realtime and one sync poller",
      (config) => {
        chainOf(config).rpc![1]!.for = "realtime";
        chainOf(config).rpc![2]!.for = "sync";
      },
      /rpc\[1\]\.for and rpc\[2\]\.for must be the same role/,
    ],
    [
      "a poller url in the archive slot",
      (config) => {
        chainOf(config).rpc![0]!.url = HUGINN_RPC;
      },
      /rpc\[0\]\.url must be the reviewed archive endpoint/,
    ],
    [
      "the archive url in a poller slot",
      (config) => {
        chainOf(config).rpc![2]!.url = MONAD_PUBLIC_RPC;
      },
      /rpc\[1\] and rpc\[2\] must be the two reviewed head pollers/,
    ],
    [
      "a fourth entry",
      (config) => {
        chainOf(config).rpc!.push({ url: MONAD_PUBLIC_RPC, for: "fallback" });
      },
      /rpc must hold exactly 3 entries, found 4/,
    ],
  ];
  describe.each(variants)("%s variant", (variant) => {
    it.each(faults)("refuses %s", async (_name, mutate, pattern) => {
      const problems = await lintVariant(variant, mutate);
      expect(problems.join("\n")).toMatch(pattern);
      // The messages name an index, never an endpoint.
      expect(problems.join("\n")).not.toMatch(
        /https?:|posthuman|huginn|monad\.xyz/i,
      );
    });
  });

  it("names a keyed rpc[0] by its index only, even when the order is also wrong", async () => {
    const secret = "SECRETVALUE0123456789";
    const problems = await lintVariant("standard", (config) => {
      chainOf(config).rpc![0]!.url = `https://rpc.example.org/${secret}`;
    });
    expect(problems.join("\n")).toMatch(/rpc\[0\]\.url/);
    expect(problems.join("\n")).not.toContain(secret);
  });
});
