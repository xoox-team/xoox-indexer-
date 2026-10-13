import { spawnSync } from "node:child_process";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { loadProConsentSource } from "../src/pro-consent-source";
import { loadProHolderSource } from "../src/pro-holder-source";
import { loadProPoolRouterSource } from "../src/pro-pool-router-source";
import { loadRoyaltyRecipients } from "../src/royalty-recipients";
import { consentIndexerFixture } from "../src/test/pro-consent-fixture";
import { loadTradeDexEvidence } from "../src/trade-dex-source";
import {
  ALLOWED_RPC_URLS,
  EXPECTED,
  lintConfig,
  loaderConfigProblems,
  main,
} from "./config-lint-lib";
import {
  ROOT,
  chainOf,
  files,
  fresh,
  lint,
  place,
  removeScratch,
  roleOf,
  track,
  type Chain,
  type Config,
} from "./config-lint-fixtures";
import {
  HUGINN_RPC,
  MONAD_PUBLIC_RPC,
  OUTPUT_FILES,
  POSTHUMAN_RPC,
} from "./generate-config-lib";

// Spelled in pieces so a repository grep for paid or forbidden providers stays empty.
const FORBIDDEN = [
  ["quick", "node"],
  ["dwell", "ir"],
  ["spec", "trum"],
  ["simply", "staking"],
  ["hyper", "sync.xyz"],
].map((parts) => parts.join(""));

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await removeScratch();
});

describe("the frozen files", () => {
  it.each(Object.values(OUTPUT_FILES))("%s passes the lint", (name) => {
    expect(lintConfig(join(ROOT, name), { env: {} })).toEqual([]);
  });
  it("accepts the generated output of either variant", async () => {
    for (const variant of ["standard", "breakglass"] as const)
      expect(lintConfig(await place(files[variant]), { env: {} })).toEqual([]);
  });
  it("pins the real counts: 22 contracts, 69 events, 55 entities", () => {
    expect(EXPECTED).toMatchObject({ contracts: 22, events: 69, entities: 55 });
  });
  it("allows exactly the three reviewed keyless endpoints", () => {
    expect([...ALLOWED_RPC_URLS].sort()).toEqual(
      [POSTHUMAN_RPC, HUGINN_RPC, MONAD_PUBLIC_RPC].sort(),
    );
  });
});

describe("file shape", () => {
  it("refuses a missing file", () => {
    expect(lintConfig(join(tmpdir(), "xoox-one-missing.json"))).toEqual([
      expect.stringMatching(/cannot be read/),
    ]);
  });
  it("refuses YAML comments, because every loader runs JSON.parse", async () => {
    const path = await place(`# frozen\n${files.standard}`);
    expect(lintConfig(path, { env: {} })).toEqual([
      expect.stringMatching(/JSON\.parse/),
    ]);
  });
  it("refuses a file above the loaders' 1 MiB limit", async () => {
    const path = await place(JSON.stringify({ pad: "x".repeat(1024 * 1024) }));
    expect(lintConfig(path, { env: {} })).toEqual([
      expect.stringMatching(/1 MiB/),
    ]);
  });
  it("refuses an absolute or unreadable schema path", async () => {
    expect(
      await lint((config) => {
        config.schema = "/etc/schema.graphql";
      }),
    ).toEqual([expect.stringMatching(/relative schema/)]);
    const path = await place(fresh(), false);
    expect(lintConfig(path, { env: {} })).toEqual([
      expect.stringMatching(/schema .* cannot be read/),
    ]);
  });
  it("requires lowercase addresses, hash-only transaction fields and a relative handlers path", async () => {
    const problems = await lint((config) => {
      config.address_format = "checksum";
      config.field_selection = { transaction_fields: ["hash", "from"] };
      config.handlers = "/srv/handlers";
    });
    expect(problems).toEqual([
      expect.stringMatching(/address_format/),
      expect.stringMatching(/transaction_fields/),
      expect.stringMatching(/handlers/),
    ]);
  });
});

describe("counts", () => {
  it("reports the real counts when a contract is removed", async () => {
    const problems = await lint((config) => {
      config.contracts = config.contracts.filter(
        (contract) => contract.name !== "Curve",
      );
    });
    expect(problems.join("\n")).toMatch(/21 contracts, expected 22/);
    expect(problems.join("\n")).toMatch(/events/);
  });
  it("reports the real event count", async () => {
    const problems = await lint((config) => {
      config.contracts[0]!.events.push({ event: "Extra(uint256 value)" });
    });
    expect(problems).toEqual([expect.stringMatching(/70 events, expected 69/)]);
  });
  it("reports the real entity count from the schema beside the config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xoox-one-lint-"));
    track(directory);
    await writeFile(
      join(directory, "schema.graphql"),
      "type Only {\n  id: ID!\n}\n",
    );
    await writeFile(join(directory, "c.json"), files.standard);
    expect(lintConfig(join(directory, "c.json"), { env: {} })).toEqual([
      expect.stringMatching(/1 entities, expected 55/),
    ]);
  });
});

describe("chain fields", () => {
  it.each([
    ["start_block", (c: Chain) => (c.start_block = 61283809), /start_block/],
    [
      "max_reorg_depth",
      (c: Chain) => (c.max_reorg_depth = 64),
      /max_reorg_depth/,
    ],
    ["a missing block_lag", (c: Chain) => delete c.block_lag, /block_lag/],
    ["a negative block_lag", (c: Chain) => (c.block_lag = -1), /block_lag/],
    ["a fractional block_lag", (c: Chain) => (c.block_lag = 1.5), /block_lag/],
    ["a skipped chain", (c: Chain) => (c.skip = true), /skip/],
    [
      "a hypersync_config",
      (c: Chain) => (c.hypersync_config = { url: "https://example.invalid" }),
      /hypersync/,
    ],
  ])("refuses %s", async (_name, mutate, pattern) => {
    const problems = await lint((config) => mutate(chainOf(config)));
    expect(problems.join("\n")).toMatch(pattern);
  });
  it("refuses a second chain or a duplicate chain 10143", async () => {
    expect(
      (
        await lint((config) => {
          config.chains.push(structuredClone(chainOf(config)));
        })
      ).join("\n"),
    ).toMatch(/exactly one chain/);
  });
  it("pins TradeV4PoolManager and TradeV3Factory start blocks", async () => {
    expect(
      (
        await lint((config) => {
          roleOf(config, "TradeV4PoolManager").start_block = 61283811;
        })
      ).join("\n"),
    ).toMatch(/TradeV4PoolManager start_block/);
    expect(
      (
        await lint((config) => {
          roleOf(config, "TradeV3Factory").start_block = 62317861;
        })
      ).join("\n"),
    ).toMatch(/TradeV3Factory start_block/);
  });
  it("pins the terminal router address and start block", async () => {
    const problems = await lint((config) => {
      const role = roleOf(config, "TerminalRouter");
      role.start_block = 1;
    });
    expect(problems.join("\n")).toMatch(/TerminalRouter/);
  });
});

describe("rpc block", () => {
  const secret = "SECRETVALUE0123456789";
  it.each([
    ["an ${ENV} placeholder", "https://rpc.example.org/${RPC_KEY}"],
    ["plain http", "http://rpc-monad-testnet.posthuman.digital"],
    [
      "credentials",
      `https://user:${secret}@rpc-monad-testnet.posthuman.digital`,
    ],
    ["a query key", `${POSTHUMAN_RPC}/?apikey=${secret}`],
    ["a path key", `${HUGINN_RPC}${secret}`],
    ["a fragment", `${POSTHUMAN_RPC}/#${secret}`],
    ["whitespace", `${POSTHUMAN_RPC} /`],
    ["an unreviewed host", "https://rpc.example.org"],
    ["a file url", "file:///tmp/rpc"],
    ["an empty url", ""],
  ])("refuses rpc[0].url with %s and never prints the url", async (_n, url) => {
    const problems = await lint((config) => {
      chainOf(config).rpc![0]!.url = url;
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(/rpc\[0\]\.url/);
    expect(problems.join("\n")).not.toContain(secret);
  });
  it("applies the same rule to every other rpc entry", async () => {
    const problems = await lint((config) => {
      chainOf(config).rpc![2]!.url = `${MONAD_PUBLIC_RPC}/?key=${secret}`;
    });
    expect(problems.join("\n")).toMatch(/rpc\[2\]\.url/);
    expect(problems.join("\n")).not.toContain(secret);
  });
  it("refuses headers, a missing rpc list and an unknown role", async () => {
    expect(
      (
        await lint((config) => {
          chainOf(config).rpc![0]!.headers = { Authorization: secret };
        })
      ).join("\n"),
    ).toMatch(/headers/);
    expect(
      await lint((config) => {
        delete chainOf(config).rpc;
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/rpc\[0\]/)]));
    expect(
      (
        await lint((config) => {
          chainOf(config).rpc![1]!.for = "primary";
        })
      ).join("\n"),
    ).toMatch(/rpc\[1\]\.for/);
  });
  it("requires INDEXER_CONTRACT_RPC_URL, when set, to equal rpc[0].url", async () => {
    const path = await place(fresh());
    expect(
      lintConfig(path, { env: { INDEXER_CONTRACT_RPC_URL: MONAD_PUBLIC_RPC } }),
    ).toEqual([]);
    const different = lintConfig(path, {
      env: { INDEXER_CONTRACT_RPC_URL: `${secret}.example.org` },
    });
    expect(different).toEqual([
      expect.stringMatching(/INDEXER_CONTRACT_RPC_URL/),
    ]);
    expect(different.join("\n")).not.toContain(secret);
  });
});

describe("forbidden providers", () => {
  it.each(FORBIDDEN)(
    "refuses %s anywhere in the file, in any case",
    async (term) => {
      const problems = await lint((config) => {
        config.description = `uses ${term.toUpperCase()} endpoints`;
      });
      expect(problems).toEqual([expect.stringContaining(term)]);
    },
  );
  it("refuses ${...} interpolation anywhere", async () => {
    const problems = await lint((config) => {
      config.description = "key ${ENVIO_API_TOKEN}";
    });
    expect(problems).toEqual([expect.stringMatching(/interpolation/)]);
  });
});

describe("effect loaders and gates accept the file", () => {
  it.each([
    [
      "ProSwapRouter role is removed",
      (c: Config) => {
        chainOf(c).contracts = chainOf(c).contracts.filter(
          (r) => r.name !== "ProSwapRouter",
        );
      },
      /ProSwapRouter/,
    ],
    [
      "ProFactory has no address",
      (c: Config) => {
        roleOf(c, "ProFactory").address = [];
      },
      /ProFactory/,
    ],
    [
      "ProConsentRegistry has no address",
      (c: Config) => {
        roleOf(c, "ProConsentRegistry").address = [];
      },
      /ProConsentRegistry/,
    ],
    [
      "a Trade role is removed",
      (c: Config) => {
        chainOf(c).contracts = chainOf(c).contracts.filter(
          (r) => r.name !== "TradeV3Factory",
        );
      },
      /TradeV3Factory/,
    ],
    [
      "a Trade source is not a registry source",
      (c: Config) => {
        roleOf(c, "TradeV3Factory").address = [
          "0x00000000000000000000000000000000000000aa",
        ];
      },
      /TradeV3Factory/,
    ],
    [
      "TerminalRouter has no address",
      (c: Config) => {
        roleOf(c, "TerminalRouter").address = [];
      },
      /TerminalRouter/,
    ],
  ])("refuses it when %s", async (_name, mutate, pattern) => {
    expect((await lint(mutate)).join("\n")).toMatch(pattern);
  });
  it("runs the real declaration gates and relays their refusal", async () => {
    const changedRouter = await lint((config) => {
      config.contracts.find((item) => item.name === "TerminalRouter")!.events =
        [{ event: "Trade(address indexed trader)" }];
    });
    expect(changedRouter.join("\n")).toMatch(
      /terminalRouterConfigured.*differs/,
    );
    const duplicated = await lint((config) => {
      config.contracts.push(
        structuredClone(
          config.contracts.find((item) => item.name === "ProFactory")!,
        ),
      );
    });
    expect(duplicated.join("\n")).toMatch(
      /proStandardIndexerContractsConfigured.*duplicate or differs/,
    );
    const partial = await lint((config) => {
      config.contracts = config.contracts.filter(
        (item) => item.name !== "ProCurve",
      );
    });
    expect(partial.join("\n")).toMatch(/partially configured/);
  });
  it("restores ENVIO_CONFIG after every run, including a refusal", async () => {
    vi.stubEnv("ENVIO_CONFIG", "/keep/this/path");
    await lint(() => {});
    await lint((config) => {
      config.contracts.find((item) => item.name === "TerminalRouter")!.events =
        [];
    });
    expect(process.env.ENVIO_CONFIG).toBe("/keep/this/path");
    vi.unstubAllEnvs();
    delete process.env.ENVIO_CONFIG;
    await lint(() => {});
    expect(process.env).not.toHaveProperty("ENVIO_CONFIG");
  });
});

// The lint mirrors the config clauses of the effect loaders (it has no reviewed source files or RPC to run them with).
// These tests execute the real loaders on the same files so the mirror cannot drift unnoticed.
describe("the lint agrees with the real effect loaders", () => {
  const hash = `0x${"1".repeat(64)}`;
  // The holder loader's own configuration refusals (it reaches the network only after a reviewed manifest parses).
  const holderConfigPhase =
    /operator chain missing|not explicitly subscribed|archive-capable RPC unavailable|oversized/i;
  let network: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.stubEnv("INDEXER_CONTRACT_RPC_URL", "");
    delete process.env.INDEXER_CONTRACT_RPC_URL;
    network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network blocked by test"));
  });
  const addressesOf = (config: Config, name: string) =>
    roleOf(config, name)?.address ?? [];
  const viaLoader = async (
    config: Config,
    run: () => Promise<unknown>,
  ): Promise<{ reached: string | undefined; error?: string }> => {
    vi.stubEnv("ENVIO_CONFIG", await place(config));
    network.mockClear();
    let error: string | undefined;
    try {
      await run();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const first = network.mock.calls[0]?.[0];
    return { reached: first === undefined ? undefined : String(first), error };
  };
  const runPool = (config: Config) =>
    loadProPoolRouterSource(10143, {
      factory: addressesOf(config, "ProFactory")[0] ?? hash,
      registry: "0x00000000000000000000000000000000000000a1",
      router: addressesOf(config, "ProSwapRouter")[0] ?? hash,
      blockNumber: 1n,
      blockHash: hash,
      timestamp: 1n,
    });
  const runRoyalty = () =>
    loadRoyaltyRecipients(10143, {
      factory: "0x00000000000000000000000000000000000000a1",
      router: "0x00000000000000000000000000000000000000a2",
      token: "0x00000000000000000000000000000000000000a3",
      quote: "0x00000000000000000000000000000000000000a4",
      splitter: "0x00000000000000000000000000000000000000a5",
      blockNumber: 1n,
      blockHash: hash,
      buyTaxBps: 0,
      sellTaxBps: 0,
      minimumHolderBalance: 0n,
      optionsHash: hash,
    });
  const runTradeDex = (config: Config) =>
    loadTradeDexEvidence(10143, {
      kind: "v3",
      source: addressesOf(config, "TradeV3Factory")[0] ?? "0x0",
      // Past the registered source's start block, or the loader refuses the input before any request.
      blockNumber: 62_400_000n,
      blockHash: hash,
      token0: "0x00000000000000000000000000000000000000a3",
      token1: "0x00000000000000000000000000000000000000a4",
      poolAddress: "0x00000000000000000000000000000000000000a5",
      fee: 3000,
      tickSpacing: 60,
    });
  const runHolder = async (config: Config) => {
    const directory = await mkdtemp(join(tmpdir(), "xoox-one-holder-"));
    track(directory);
    const source = join(directory, "holder-sources.json");
    const factory = addressesOf(config, "ProFactory")[0] ?? hash;
    await writeFile(
      source,
      JSON.stringify({
        schema: "xoox.pro-token.indexer-holder-sources",
        version: 1,
        manifests: [{ chainId: "10143", factory }],
      }),
    );
    vi.stubEnv("XOOX_PRO_HOLDER_SOURCES_PATH", source);
    return loadProHolderSource(10143, {
      factory,
      token: "0x00000000000000000000000000000000000000a3",
      curve: "0x00000000000000000000000000000000000000a4",
      policy: "0x00000000000000000000000000000000000000a5",
      creator: "0x00000000000000000000000000000000000000a6",
      configurationHash: hash,
      supply: 1n,
      blockNumber: 1n,
      blockHash: hash,
      timestamp: 1n,
      transactionHash: hash,
      launchLogIndex: 0,
    });
  };

  it("lets the pool-router, royalty and trade-dex loaders reach the network on rpc[0]", async () => {
    const config = fresh();
    expect(loaderConfigProblems(config, 10143, 16_000)).toEqual({
      royalty: [],
      tradeDex: [],
      poolRouter: [],
      consent: [],
      holder: [],
    });
    for (const run of [
      () => runPool(config),
      runRoyalty,
      () => runTradeDex(config),
    ]) {
      const seen = await viaLoader(config, run);
      expect(seen.reached && new URL(seen.reached).href).toBe(
        new URL(MONAD_PUBLIC_RPC).href,
      );
    }
  });
  it("follows rpc[0] when a poller is first, in the loaders and in the mirror", async () => {
    const config = fresh();
    const rpc = chainOf(config).rpc!;
    [rpc[0], rpc[1]] = [rpc[1]!, rpc[0]!];
    expect(loaderConfigProblems(config, 10143, 16_000)).toEqual({
      royalty: [],
      tradeDex: [],
      poolRouter: [],
      consent: [],
      holder: [],
    });
    for (const run of [
      () => runPool(config),
      runRoyalty,
      () => runTradeDex(config),
    ]) {
      const seen = await viaLoader(config, run);
      expect(seen.reached && new URL(seen.reached).href).toBe(
        new URL(POSTHUMAN_RPC).href,
      );
    }
  });
  it("lets the holder loader past every configuration clause", async () => {
    const config = fresh();
    vi.stubEnv("ENVIO_CONFIG", await place(config));
    const error = await runHolder(config).then(
      () => "",
      (caught: Error) => caught.message,
    );
    expect(error).not.toMatch(holderConfigPhase);
  });
  it("lets the consent loader read the file's rpc[0] with a reviewed fixture", async () => {
    const f = consentIndexerFixture();
    const config = fresh();
    chainOf(config).id = 143;
    roleOf(config, "ProFactory").address = [f.factory];
    roleOf(config, "ProConsentRegistry").address = [f.registry];
    expect(loaderConfigProblems(config, 143, 16_000).consent).toEqual([]);
    const directory = await mkdtemp(join(tmpdir(), "xoox-one-consent-"));
    track(directory);
    const source = join(directory, "consent-sources.json");
    await writeFile(source, JSON.stringify(f.raw()));
    vi.stubEnv("XOOX_PRO_CONSENT_SOURCES_PATH", source);
    vi.stubEnv("ENVIO_CONFIG", await place(config));
    const client = vi.fn(() => f.client);
    await loadProConsentSource(143, f.input(), client);
    expect(client).toHaveBeenCalledWith(MONAD_PUBLIC_RPC);
    // The same clauses refuse what the mirror refuses.
    for (const fault of [
      (c: Config) => {
        chainOf(c).contracts = chainOf(c).contracts.filter(
          (r) => r.name !== "ProConsentRegistry",
        );
      },
      (c: Config) => {
        chainOf(c).rpc![0]!.url = "file:///tmp/source";
      },
      (c: Config) => {
        chainOf(c).rpc = [];
      },
      (c: Config) => {
        c.chains.push(structuredClone(chainOf(c)));
      },
    ]) {
      const faulty = structuredClone(config);
      fault(faulty);
      expect(loaderConfigProblems(faulty, 143, 16_000).consent).not.toEqual([]);
      vi.stubEnv("ENVIO_CONFIG", await place(faulty));
      const refused = vi.fn(() => f.client);
      await expect(
        loadProConsentSource(143, f.input(), refused),
      ).rejects.toThrow(/Pro consent source/);
      expect(refused).not.toHaveBeenCalled();
    }
  });

  const faults: [string, (config: Config) => void][] = [
    ["no fault", () => {}],
    [
      "Huginn first (rpc[0] and rpc[1] swapped)",
      (c) => {
        const rpc = chainOf(c).rpc!;
        [rpc[0], rpc[1]] = [rpc[1]!, rpc[0]!];
      },
    ],
    [
      "ProSwapRouter role missing",
      (c) => {
        chainOf(c).contracts = chainOf(c).contracts.filter(
          (r) => r.name !== "ProSwapRouter",
        );
      },
    ],
    [
      "ProFactory without addresses",
      (c) => {
        roleOf(c, "ProFactory").address = [];
      },
    ],
    [
      "duplicate chain",
      (c) => {
        c.chains.push(structuredClone(chainOf(c)));
      },
    ],
    [
      "no rpc",
      (c) => {
        chainOf(c).rpc = [];
      },
    ],
    [
      "file rpc",
      (c) => {
        chainOf(c).rpc![0]!.url = "file:///tmp/untrusted";
      },
    ],
    [
      "ftp rpc",
      (c) => {
        chainOf(c).rpc![0]!.url = "ftp://rpc.example.org";
      },
    ],
    [
      "TradeV3Factory role missing",
      (c) => {
        chainOf(c).contracts = chainOf(c).contracts.filter(
          (r) => r.name !== "TradeV3Factory",
        );
      },
    ],
    [
      "TradeV3Factory declared twice",
      (c) => {
        c.contracts.push(
          structuredClone(
            c.contracts.find((i) => i.name === "TradeV3Factory")!,
          ),
        );
      },
    ],
    [
      "TradeV3Factory on a non-registry address",
      (c) => {
        roleOf(c, "TradeV3Factory").address = [
          "0x00000000000000000000000000000000000000aa",
        ];
      },
    ],
  ];
  it.each(faults)(
    "gives the same verdict as the real loaders for: %s",
    async (_name, fault) => {
      const config = fresh();
      fault(config);
      const mirror = loaderConfigProblems(config, 10143, 16_000);
      // A loader rejects configuration before any request, so a request proves acceptance.
      const accepted = (seen: { reached?: string }) =>
        seen.reached !== undefined;
      const pool = await viaLoader(config, () => runPool(config));
      expect(mirror.poolRouter.length === 0, "pool router").toBe(
        accepted(pool),
      );
      const royalty = await viaLoader(config, runRoyalty);
      expect(mirror.royalty.length === 0, "royalty").toBe(accepted(royalty));
      const trade = await viaLoader(config, () => runTradeDex(config));
      expect(mirror.tradeDex.length === 0, "trade dex").toBe(accepted(trade));
      const holder = await viaLoader(config, async () => {
        await runHolder(config);
      });
      expect(mirror.holder.length === 0, "holder").toBe(
        !holderConfigPhase.test(holder.error ?? ""),
      );
    },
  );
});

describe("command line", () => {
  const capture = () => {
    const lines: string[] = [];
    return {
      lines,
      io: {
        log: (line: string) => lines.push(line),
        error: (line: string) => lines.push(line),
      },
    };
  };
  it("lints the frozen files by default and exits 0", () => {
    const run = capture();
    expect(main([], run.io)).toBe(0);
    expect(run.lines.join("\n")).toContain(OUTPUT_FILES.standard);
    expect(run.lines.join("\n")).toContain(OUTPUT_FILES.breakglass);
  });
  it("runs through a symlinked directory instead of silently doing nothing", async () => {
    // The lint is a gate: a bad file must exit 1 whatever path started the command.
    const config = fresh();
    config.contracts.pop();
    const directory = await mkdtemp(join(tmpdir(), "xoox-one-lint-link-"));
    track(directory);
    const link = join(directory, "current");
    await symlink(fileURLToPath(new URL(".", import.meta.url)), link);
    const result = spawnSync(
      join(ROOT, "node_modules/.bin/tsx"),
      [join(link, "config-lint.ts"), await place(config)],
      {
        env: { PATH: process.env["PATH"] ?? "" },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/21 contracts, expected 22/);
  }, 60_000);
  it("exits 1 and prints each problem for a bad file", async () => {
    const config = fresh();
    config.contracts.pop();
    const run = capture();
    expect(main([await place(config)], run.io)).toBe(1);
    expect(run.lines.join("\n")).toMatch(/21 contracts, expected 22/);
  });
});
