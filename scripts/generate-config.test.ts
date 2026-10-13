import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  contracts,
  envioConfiguration,
  TERMINAL_ROUTER_SOURCE,
} from "../src/configuration";
import { parseDeployment } from "../src/vendor/xoox-sdk/config";
import {
  DEFAULT_BLOCK_LAG,
  HUGINN_RPC,
  MAX_BLOCK_LAG,
  MONAD_PUBLIC_RPC,
  OUTPUT_FILES,
  POSTHUMAN_RPC,
  XOOX_ONE_MAX_REORG_DEPTH,
  XOOX_ONE_START_BLOCK,
  existingBlockLag,
  generate,
  main,
  readReviewedProInputs,
  serializeConfiguration,
  xooxOneConfiguration,
} from "./generate-config-lib";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = join(ROOT, "deployments/10143.json");
const REVIEWED = join(
  ROOT,
  "output/four-step-integration-2026-10-06/step4-reviewed-inputs.public.json",
);
// Spelled in pieces so a repository grep for paid or forbidden providers stays empty.
const FORBIDDEN = [
  ["quick", "node"],
  ["dwell", "ir"],
  ["spec", "trum"],
  ["simply", "staking"],
  ["hyper", "sync.xyz"],
].map((parts) => parts.join(""));

const deployment = () =>
  parseDeployment(JSON.parse(readFileSync(MANIFEST, "utf8")));
const proSources = () => readReviewedProInputs(REVIEWED);
const standard = (blockLag?: number) =>
  xooxOneConfiguration(
    { deployment: deployment(), proSources: proSources(), blockLag },
    "standard",
  );
const breakglass = (blockLag?: number) =>
  xooxOneConfiguration(
    { deployment: deployment(), proSources: proSources(), blockLag },
    "breakglass",
  );

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), "xoox-one-generate-"));
  directories.push(directory);
  return directory;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value, null, 2) + "\n")
    .digest("hex");
async function reviewedFile(
  mutate: (envelope: Record<string, unknown>) => void = () => {},
  sealed = true,
) {
  const envelope = JSON.parse(readFileSync(REVIEWED, "utf8"));
  mutate(envelope);
  if (sealed) envelope.sourcesSha256 = digest(envelope.orderedSources);
  const path = join(await scratch(), "reviewed.json");
  await writeFile(path, JSON.stringify(envelope));
  return path;
}

describe("reviewed Pro inputs", () => {
  it("returns the ordered sources after checking their recorded digest", () => {
    const sources = proSources();
    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.chainId)).toEqual([10143, 10143]);
    expect(
      sources.every((source) => source.poolRouter && source.consentRegistry),
    ).toBe(true);
  });
  it("refuses a source list that no longer hashes to the reviewed digest", async () => {
    const path = await reviewedFile((envelope) => {
      (envelope.orderedSources as { startBlock: string }[])[0]!.startBlock =
        "1";
    }, false);
    expect(() => readReviewedProInputs(path)).toThrow(/digest/i);
  });
  it.each([
    [
      "a missing source list",
      (e: Record<string, unknown>) => delete e.orderedSources,
    ],
    [
      "a non-array source list",
      (e: Record<string, unknown>) => (e.orderedSources = {}),
    ],
    [
      "more than six sources",
      (e: Record<string, unknown>) =>
        (e.orderedSources = Array.from({ length: 7 }, () => ({}))),
    ],
  ])("refuses %s", async (_name, mutate) => {
    const path = await reviewedFile(mutate, false);
    expect(() => readReviewedProInputs(path)).toThrow(/reviewed Pro/i);
  });
  it("refuses a file that is not a JSON object or exceeds 16 KiB", async () => {
    const directory = await scratch();
    const array = join(directory, "array.json");
    await writeFile(array, "[]");
    expect(() => readReviewedProInputs(array)).toThrow(/reviewed Pro/i);
    const large = join(directory, "large.json");
    await writeFile(large, JSON.stringify({ pad: "x".repeat(16 * 1024) }));
    expect(() => readReviewedProInputs(large)).toThrow(/reviewed Pro/i);
    expect(() =>
      readReviewedProInputs(join(directory, "missing.json")),
    ).toThrow(/reviewed Pro/i);
  });
});

describe("xoox-one configuration", () => {
  it("is the reviewed generator output plus the rpc overlay and chain fields, nothing else", () => {
    const base = envioConfiguration(
      deployment(),
      proSources(),
      TERMINAL_ROUTER_SOURCE,
    );
    const config = standard();
    expect(config.contracts).toEqual(base.contracts);
    expect(config.chains[0]!.contracts).toEqual(base.chains[0]!.contracts);
    expect(config.schema).toBe("schema.graphql");
    expect(config.handlers).toBe("src/handlers");
    expect(config.address_format).toBe("lowercase");
    expect(config.field_selection).toEqual({ transaction_fields: ["hash"] });
    expect(config.description).toBe(base.description);
    expect(Object.keys(config)).toEqual(Object.keys(base));
    expect(Object.keys(config.chains[0]!)).toEqual([
      "id",
      "start_block",
      "rpc",
      "max_reorg_depth",
      "block_lag",
      "contracts",
    ]);
  });
  it("declares 22 contracts and 69 events", () => {
    const config = standard();
    expect(config.contracts).toHaveLength(22);
    expect(
      config.contracts.reduce((sum, item) => sum + item.events.length, 0),
    ).toBe(69);
  });
  it("sets the chain fields", () => {
    const chain = standard().chains[0]!;
    expect(chain.id).toBe(10143);
    expect(chain.start_block).toBe(61283810);
    expect(chain.start_block).toBe(XOOX_ONE_START_BLOCK);
    expect(chain.max_reorg_depth).toBe(128);
    expect(chain.max_reorg_depth).toBe(XOOX_ONE_MAX_REORG_DEPTH);
    expect(chain.block_lag).toBe(2);
    expect(chain.block_lag).toBe(DEFAULT_BLOCK_LAG);
  });
  it("takes the block lag from the caller", () => {
    expect(standard(0).chains[0]!.block_lag).toBe(0);
    expect(standard(3).chains[0]!.block_lag).toBe(3);
    expect(breakglass(1).chains[0]!.block_lag).toBe(1);
  });
  it.each([-1, 1.5, Number.NaN, MAX_BLOCK_LAG + 1, "2" as unknown as number])(
    "refuses block lag %s",
    (value) => {
      expect(() => standard(value)).toThrow(/block_lag/);
    },
  );
  it("writes the rpc overlay: the archive public fallback, then two realtime pollers", () => {
    expect(standard().chains[0]!.rpc).toEqual([
      {
        url: "https://testnet-rpc.monad.xyz",
        for: "fallback",
        initial_block_interval: 100,
        interval_ceiling: 100,
      },
      {
        url: "https://rpc-monad-testnet.posthuman.digital",
        for: "realtime",
        polling_interval: 2000,
        initial_block_interval: 1000,
        interval_ceiling: 1000,
      },
      {
        url: "https://monad-testnet-rpc.huginn.tech/",
        for: "realtime",
        polling_interval: 2000,
        initial_block_interval: 1000,
        interval_ceiling: 1000,
      },
    ]);
    expect([MONAD_PUBLIC_RPC, POSTHUMAN_RPC, HUGINN_RPC]).toEqual(
      standard().chains[0]!.rpc.map((entry) => entry.url),
    );
  });
  it("makes the break-glass variant differ only in its two sync entries", () => {
    const glass = breakglass();
    expect(glass.chains[0]!.rpc.map((entry) => entry.for)).toEqual([
      "fallback",
      "sync",
      "sync",
    ]);
    const restored = {
      ...glass,
      chains: [
        {
          ...glass.chains[0]!,
          rpc: glass.chains[0]!.rpc.map((entry, index) =>
            index > 0 ? { ...entry, for: "realtime" as const } : entry,
          ),
        },
      ],
    };
    expect(restored).toEqual(standard());
  });
  it("has no hypersync configuration and keeps the literal rpc urls keyless", () => {
    for (const config of [standard(), breakglass()]) {
      expect(config).not.toHaveProperty("hypersync_config");
      expect(config.chains[0]).not.toHaveProperty("hypersync_config");
      for (const entry of config.chains[0]!.rpc) {
        expect(entry.url).toMatch(/^https:\/\/[^${}\s]+$/);
        expect(entry).not.toHaveProperty("headers");
        expect(entry).not.toHaveProperty("ws");
      }
    }
  });
  it("keeps the per-contract start blocks the web's TradeDexCoverage id depends on", () => {
    const roles = standard().chains[0]!.contracts;
    const start = (name: string) =>
      roles.find((role) => role.name === name)!.start_block;
    expect(start("TradeV4PoolManager")).toBe(61283810);
    expect(start("TradeV3Factory")).toBe(62317860);
  });
  it("subscribes the router at its reviewed address and start block", () => {
    const role = standard().chains[0]!.contracts.find(
      (item) => item.name === "TerminalRouter",
    );
    expect(role).toEqual({
      name: "TerminalRouter",
      address: ["0x79ad9653c42f8fec1e8191b15288861cedcba3f7"],
      start_block: 69076718,
    });
  });
  it("subscribes every reviewed Pro factory, router and consent registry", () => {
    const roles = standard().chains[0]!.contracts;
    const addresses = (name: string) =>
      roles.find((role) => role.name === name)!.address;
    const reviewed = proSources();
    expect(addresses("ProFactory")).toEqual(reviewed.map((s) => s.factory));
    expect(addresses("ProSwapRouter")).toEqual(
      reviewed.map((s) => s.poolRouter),
    );
    expect(addresses("ProConsentRegistry")).toEqual(
      reviewed.map((s) => s.consentRegistry),
    );
  });
  it("does not mutate the shared contract declarations", () => {
    const before = JSON.stringify(contracts);
    standard();
    breakglass();
    expect(JSON.stringify(contracts)).toBe(before);
  });
  it("refuses a chain start that moved away from the replay origin", () => {
    // An earlier Pro factory would pull the generated start below 61283810; forcing the constant would hide its events.
    const earlier = [
      ...proSources(),
      {
        chainId: 10143,
        factory: "0x1111111111111111111111111111111111111111",
        startBlock: "61283809",
      },
    ];
    expect(() =>
      xooxOneConfiguration(
        { deployment: deployment(), proSources: earlier },
        "standard",
      ),
    ).toThrow(/start_block/);
  });
  it("refuses a deployment that is not Monad testnet", () => {
    const local = { ...deployment(), chainId: 31337 };
    expect(() =>
      xooxOneConfiguration({ deployment: local, proSources: [] }, "standard"),
    ).toThrow();
  });
});

describe("serialized output", () => {
  it("is pure JSON that round-trips unchanged and carries no comment", () => {
    for (const config of [standard(), breakglass()]) {
      const text = serializeConfiguration(config);
      expect(text.startsWith("{\n")).toBe(true);
      expect(text.endsWith("}\n")).toBe(true);
      expect(JSON.parse(text)).toEqual(config);
      expect(text).not.toMatch(/^\s*(#|\/\/)/m);
      expect(text).not.toContain("${");
    }
  });
  it("names no forbidden provider", () => {
    for (const text of [
      serializeConfiguration(standard()),
      serializeConfiguration(breakglass()),
    ])
      for (const term of FORBIDDEN)
        expect(text.toLowerCase(), term).not.toContain(term);
  });
  it("matches the frozen files in the repository root", async () => {
    // block_lag is the one value P1 sets after generation, so the drift check takes it from the frozen file.
    const blockLag = existingBlockLag(join(ROOT, OUTPUT_FILES.standard));
    expect(blockLag).toBeDefined();
    const files = generate({ root: ROOT, blockLag });
    for (const [variant, name] of Object.entries(OUTPUT_FILES))
      expect(
        files[variant as keyof typeof files],
        `${name} is stale; run tsx scripts/generate-config.ts`,
      ).toBe(await readFile(join(ROOT, name), "utf8"));
  });
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
  it("writes both variants and then verifies them with --check", async () => {
    const out = await scratch();
    const first = capture();
    expect(main(["--out-dir", out], first.io)).toBe(0);
    const text = await readFile(join(out, OUTPUT_FILES.standard), "utf8");
    expect(text).toBe(generate({ root: ROOT }).standard);
    expect(await readFile(join(out, OUTPUT_FILES.breakglass), "utf8")).toBe(
      generate({ root: ROOT }).breakglass,
    );
    const second = capture();
    expect(main(["--out-dir", out, "--check"], second.io)).toBe(0);
    await writeFile(
      join(out, OUTPUT_FILES.standard),
      text.replace("2000", "1999"),
    );
    const third = capture();
    expect(main(["--out-dir", out, "--check"], third.io)).toBe(1);
    expect(third.lines.join("\n")).toContain(OUTPUT_FILES.standard);
  });
  it("runs through a symlinked directory instead of silently doing nothing", async () => {
    // --check is a gate: a stale or missing file must exit 1 whatever path started the command.
    const link = join(await scratch(), "current");
    await symlink(fileURLToPath(new URL(".", import.meta.url)), link);
    const result = spawnSync(
      join(ROOT, "node_modules/.bin/tsx"),
      [
        join(link, "generate-config.ts"),
        "--check",
        "--out-dir",
        await scratch(),
      ],
      {
        env: { PATH: process.env["PATH"] ?? "" },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is stale or missing");
  }, 60_000);
  it("keeps the block_lag already on disk unless --block-lag says otherwise", async () => {
    const out = await scratch();
    const lagOf = async (name: string) =>
      JSON.parse(await readFile(join(out, name), "utf8")).chains[0].block_lag;
    expect(main(["--out-dir", out, "--block-lag", "3"], capture().io)).toBe(0);
    expect(main(["--out-dir", out], capture().io)).toBe(0);
    expect(await lagOf(OUTPUT_FILES.standard)).toBe(3);
    expect(await lagOf(OUTPUT_FILES.breakglass)).toBe(3);
    expect(main(["--out-dir", out, "--check"], capture().io)).toBe(0);
    expect(main(["--out-dir", out, "--block-lag", "1"], capture().io)).toBe(0);
    expect(await lagOf(OUTPUT_FILES.standard)).toBe(1);
    // A file with an invalid lag falls back to the default instead of being trusted.
    await writeFile(
      join(out, OUTPUT_FILES.standard),
      JSON.stringify({ chains: [{ block_lag: 99 }] }),
    );
    expect(existingBlockLag(join(out, OUTPUT_FILES.standard))).toBeUndefined();
    expect(main(["--out-dir", out], capture().io)).toBe(0);
    expect(await lagOf(OUTPUT_FILES.standard)).toBe(DEFAULT_BLOCK_LAG);
  });
  it("flags a standard and break-glass file whose block_lag values disagree", async () => {
    const out = await scratch();
    expect(main(["--out-dir", out, "--block-lag", "3"], capture().io)).toBe(0);
    const glass = JSON.parse(
      await readFile(join(out, OUTPUT_FILES.breakglass), "utf8"),
    );
    glass.chains[0].block_lag = 1;
    await writeFile(
      join(out, OUTPUT_FILES.breakglass),
      JSON.stringify(glass, null, 2) + "\n",
    );
    const run = capture();
    expect(main(["--out-dir", out, "--check"], run.io)).toBe(1);
    expect(run.lines.join("\n")).toContain(OUTPUT_FILES.breakglass);
  });
  it("applies --block-lag to both variants", async () => {
    const out = await scratch();
    expect(main(["--out-dir", out, "--block-lag", "3"], capture().io)).toBe(0);
    for (const name of Object.values(OUTPUT_FILES))
      expect(
        JSON.parse(await readFile(join(out, name), "utf8")).chains[0].block_lag,
      ).toBe(3);
  });
  it.each([
    [["--block-lag", "x"]],
    [["--block-lag", "99"]],
    [["--out-dir"]],
    [["--unknown"]],
  ])("refuses arguments %j without writing", async (args) => {
    const out = await scratch();
    const run = capture();
    expect(main(["--out-dir", out, ...args], run.io)).toBe(1);
    await expect(
      readFile(join(out, OUTPUT_FILES.standard), "utf8"),
    ).rejects.toThrow();
  });
});
