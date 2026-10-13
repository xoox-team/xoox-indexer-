import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Deployment } from "../vendor/xoox-sdk/config";
import { envioConfiguration } from "../configuration";
import { TRADE_EVENT } from "./constants";

// Envio only rejects a handler registered for a contract that no chain
// configures when the handlers load against the real configuration, so each
// configuration is booted in its own process the way `envio start` loads it:
// handlers are auto-loaded from src/handlers and a test batch is processed.
const run = promisify(execFile);
const project = fileURLToPath(new URL("../..", import.meta.url));
const fixture = fileURLToPath(
  new URL("../test/router-trades.json", import.meta.url),
);
const loader = createRequire(import.meta.url).resolve("tsx/esm");
const script = `
const { createTestIndexer } = await import("envio");
const { decodeEventLog, parseAbiItem } = await import("viem");
const { readFileSync } = await import("node:fs");
const test = createTestIndexer();
const chain = process.env.BOOT_CHAIN;
const simulate = [];
if (process.env.BOOT_ROUTER_LOGS) {
  const abi = [parseAbiItem("event " + process.env.BOOT_TRADE_EVENT)];
  const real = JSON.parse(readFileSync(process.env.BOOT_ROUTER_LOGS, "utf8"));
  for (const log of real.logs) {
    const { args } = decodeEventLog({ abi, data: log.data, topics: log.topics });
    simulate.push({
      contract: "TerminalRouter",
      event: "Trade",
      srcAddress: log.address,
      block: { number: Number(BigInt(log.blockNumber)), hash: log.blockHash, timestamp: Number(BigInt(log.timestamp)) },
      transaction: { hash: log.transactionHash },
      logIndex: Number(BigInt(log.logIndex)),
      params: args,
    });
  }
}
await test.process({ chains: { [chain]: { simulate } } });
console.log("BOOTED rows=" + (await test.TradeFeed.getAll()).length);
`;

type Config = ReturnType<typeof envioConfiguration>;
const LEGACY = (name: string) => !/^(Pro|TerminalRouter$)/.test(name);
const without = (config: Config, keep: (name: string) => boolean): Config => ({
  ...structuredClone(config),
  contracts: config.contracts.filter((c) => keep(c.name)),
  chains: config.chains.map((chain) => ({
    ...structuredClone(chain),
    contracts: chain.contracts.filter((c) => keep(c.name)),
  })),
});
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const legacyDeployment = {
  chainId: 143,
  startBlock: "1",
  rpcUrl: "http://127.0.0.1:1",
  environment: "configured",
  factory: addr(1),
  feeVault: addr(2),
  hook: addr(3),
  swapRouter: addr(4),
  poolManager: addr(5),
  treasury: addr(6),
} as Deployment;

describe("handlers boot against the configuration they are given", () => {
  let directory: string;
  let testConfig: Config;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "xoox-terminal-boot-"));
    testConfig = JSON.parse(
      await readFile(join(project, "config.test.yaml"), "utf8"),
    ) as Config;
  });
  afterAll(() => rm(directory, { recursive: true, force: true }));

  async function boot(config: Config, chain: number, logs = false) {
    const path = join(
      directory,
      `config-${Math.random().toString(36).slice(2)}.yaml`,
    );
    // Envio resolves a relative schema from the configuration file's directory.
    await writeFile(
      path,
      JSON.stringify({ ...config, schema: join(project, "schema.graphql") }),
    );
    return run(
      process.execPath,
      ["--import", loader, "--input-type=module", "--eval", script],
      {
        cwd: project,
        timeout: 60_000,
        env: {
          ...process.env,
          ENVIO_CONFIG: path,
          BOOT_CHAIN: String(chain),
          BOOT_TRADE_EVENT: TRADE_EVENT,
          ...(logs ? { BOOT_ROUTER_LOGS: fixture } : {}),
        },
      },
    );
  }
  const fixtureLogs = async () =>
    (JSON.parse(await readFile(fixture, "utf8")) as { logs: unknown[] }).logs
      .length;

  it("fails loudly when a handler's contract is missing, so the boots below prove something", async () => {
    const broken = without(testConfig, (name) => name !== "Factory");
    await expect(boot(broken, 143)).rejects.toThrow(
      /"Factory" is not configured on any chain/,
    );
  }, 60_000);

  it("boots config.test.yaml and registers the router: one TradeFeed row per fixture log", async () => {
    const { stdout } = await boot(testConfig, 10143, true);
    expect(stdout).toContain(`BOOTED rows=${await fixtureLogs()}`);
  }, 60_000);

  it("still boots config.test.yaml as it was before the router, without registering it", async () => {
    const before = without(testConfig, (name) => name !== "TerminalRouter");
    const { stdout, stderr } = await boot(before, 10143);
    expect(stdout).toContain("BOOTED rows=0");
    expect(stderr).not.toContain("not configured on any chain");
  }, 60_000);

  it("still boots a legacy-only configuration (no Pro, no router), without registering the router", async () => {
    const legacy = without(envioConfiguration(legacyDeployment), LEGACY);
    expect(
      legacy.chains[0].contracts.some((c) => c.name.startsWith("Pro")),
    ).toBe(false);
    const { stdout, stderr } = await boot(legacy, 143);
    expect(stdout).toContain("BOOTED rows=0");
    expect(stderr).not.toContain("not configured on any chain");
  }, 60_000);

  it("boots the generator's own output with the router role left disabled", async () => {
    const { stdout, stderr } = await boot(
      envioConfiguration(legacyDeployment),
      143,
    );
    expect(stdout).toContain("BOOTED rows=0");
    expect(stderr).not.toContain("not configured on any chain");
  }, 60_000);
});
