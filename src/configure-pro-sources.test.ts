import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { envioConfiguration, type ProIndexerSource } from "./configuration";
import { consentIndexerFixture } from "./test/pro-consent-fixture";
import { ROUTER } from "./terminal-feed/constants";
import { TRADE_DEX_SOURCES } from "./trade-dex-registry";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  verifyDeployment: vi.fn(async () => {}),
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
}));
vi.mock("./vendor/xoox-sdk/preflight", async (original) => ({
  ...(await original<typeof import("./vendor/xoox-sdk/preflight")>()),
  verifyDeployment: mocks.verifyDeployment,
}));
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const manifest = {
  chainId: 10143,
  chainName: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  factory: address(1),
  feeVault: address(2),
  buybackVault: address(3),
  poolManager: address(4),
  positionManager: address(5),
  hook: address(6),
  swapRouter: address(7),
  launchRouter: address(8),
  startBlock: "70000000",
  quoteAssets: [{ address: address(0), symbol: "MON", decimals: 18 }],
  environment: "configured",
};
const sources: ProIndexerSource[] = [
  {
    chainId: 10143,
    factory: address(201),
    startBlock: "69900000",
    poolRouter: address(202),
    consentRegistry: address(203),
  },
  {
    chainId: 10143,
    factory: address(211),
    startBlock: "71000000",
    poolRouter: address(212),
    consentRegistry: address(213),
  },
];
let directory: string;
let oldArgv: string[];
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  directory = mkdtempSync(
    join(dirname(fileURLToPath(import.meta.url)), ".configure-test-"),
  );
  oldArgv = process.argv;
  vi.resetModules();
  mocks.readFile.mockReset().mockImplementation(async (path: string) => {
    if (path.endsWith(".env.local")) return "";
    return JSON.stringify(manifest);
  });
  mocks.writeFile.mockReset().mockResolvedValue(undefined);
  mocks.verifyDeployment.mockClear();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = oldArgv;
  log.mockRestore();
  rmSync(directory, { recursive: true, force: true });
});
async function run(
  entry: "configure" | "configure-testnet",
  body?: string | Buffer,
) {
  const sourceFile = join(directory, "reviewed-pro-sources.json");
  if (body !== undefined) writeFileSync(sourceFile, body);
  process.argv = [
    "node",
    "configuration-entrypoint",
    "reviewed-deployment.json",
    ...(body === undefined ? [] : [sourceFile]),
  ];
  if (entry === "configure") await import("./configure");
  else await import("./configure-testnet");
  return JSON.parse(mocks.writeFile.mock.calls[0]![1]);
}
function addresses(
  config: ReturnType<typeof envioConfiguration>,
  role: string,
) {
  return config.chains[0]!.contracts.find((contract) => contract.name === role)!
    .address;
}
describe.each(["configure", "configure-testnet"] as const)(
  "%s reviewed Pro source selection",
  (entry) => {
    it("subscribes to both reviewed factories and their distinct paired routers and consent registries", async () => {
      const config = await run(entry, JSON.stringify(sources));
      expect(addresses(config, "ProFactory")).toEqual(
        sources.map((source) => source.factory),
      );
      expect(addresses(config, "ProSwapRouter")).toEqual(
        sources.map((source) => source.poolRouter),
      );
      expect(addresses(config, "ProConsentRegistry")).toEqual(
        sources.map((source) => source.consentRegistry),
      );
      expect(addresses(config, "Factory")).toEqual([manifest.factory]);
      expect(config.chains[0]!.start_block).toBe(61_283_810);
      for (const role of ["ProFactory", "ProSwapRouter", "ProConsentRegistry"])
        expect(
          config.chains[0]!.contracts.find(
            (contract: { name: string }) => contract.name === role,
          )!.start_block,
        ).toBe(69_900_000);
    });
    it("preserves the complete old default configuration when no source file is supplied", async () => {
      const config = await run(entry);
      const expected = envioConfiguration(
        manifest as unknown as Parameters<typeof envioConfiguration>[0],
      );
      if (entry === "configure-testnet") {
        expected.name = "xoox-monad-testnet";
        for (const rpc of expected.chains[0]!.rpc ?? []) rpc.for = "fallback";
      }
      expect(config).toEqual(expected);
    });
    it.each([
      ["non-array JSON", "{}"],
      ["malformed JSON", "["],
      [
        "too many generations",
        JSON.stringify(Array.from({ length: 7 }, () => sources[0])),
      ],
      ["oversized file", " ".repeat(16 * 1024 + 1)],
      ["invalid UTF-8", Buffer.from([0xff])],
      ["wrong source chain", JSON.stringify([{ ...sources[0], chainId: 143 }])],
      [
        "missing explicit start block",
        JSON.stringify([{ chainId: 10143, factory: address(201) }]),
      ],
      [
        "unreviewed extra field",
        JSON.stringify([{ ...sources[0], discovered: true }]),
      ],
      [
        "shared router across factories",
        JSON.stringify([
          sources[0],
          { ...sources[1], poolRouter: sources[0]!.poolRouter },
        ]),
      ],
      [
        "shared consent registry across factories",
        JSON.stringify([
          sources[0],
          { ...sources[1], consentRegistry: sources[0]!.consentRegistry },
        ]),
      ],
    ])("refuses %s before writing a configuration", async (_name, body) => {
      await expect(run(entry, body)).rejects.toThrow();
      expect(mocks.writeFile).not.toHaveBeenCalled();
      expect(mocks.verifyDeployment).not.toHaveBeenCalled();
    });
  },
);
it("refuses source selection without a deployment manifest", async () => {
  const sourceFile = join(directory, "reviewed-pro-sources.json");
  writeFileSync(sourceFile, JSON.stringify(sources));
  process.argv = ["node", "configuration-entrypoint", "", sourceFile];
  await expect(import("./configure")).rejects.toThrow("deployment manifest");
  expect(mocks.writeFile).not.toHaveBeenCalled();
});

it("preserves disabled codegen and unit-test configuration when called without arguments", async () => {
  process.argv = ["node", "configuration-entrypoint"];
  await import("./configure");
  expect(mocks.writeFile).toHaveBeenCalledTimes(2);
  expect(mocks.writeFile.mock.calls[0]![0]).toBe("config.codegen.yaml");
  expect(JSON.parse(mocks.writeFile.mock.calls[0]![1])).toEqual(
    envioConfiguration(),
  );
  expect(mocks.writeFile.mock.calls[1]![0]).toBe("config.test.yaml");
  expect(JSON.parse(mocks.writeFile.mock.calls[1]![1]).chains[0].skip).toBe(
    false,
  );
  const fixture = JSON.parse(mocks.writeFile.mock.calls[1]![1]);
  const roles = {
    Factory: "0x4000000000000000000000000000000000000000",
    FeeVault: "0x5000000000000000000000000000000000000000",
    Hook: "0x6000000000000000000000000000000000000000",
    SwapRouter: "0x7000000000000000000000000000000000000000",
    PoolManager: "0x8000000000000000000000000000000000000000",
    Treasury: "0x9000000000000000000000000000000000000000",
    PaymentRouter: "0xb000000000000000000000000000000000000000",
    LaunchRouter: "0xd000000000000000000000000000000000000000",
    ProSwapRouter: "0xf000000000000000000000000000000000000000",
  };
  for (const [role, address] of Object.entries(roles))
    expect(addresses(fixture, role), role).toEqual([address]);
  for (const role of ["TradeV3Factory", "TradeV4PoolManager", "TerminalRouter"])
    expect(addresses(fixture, role), role).toEqual([]);
  const consent = consentIndexerFixture();
  expect(addresses(fixture, "ProFactory")).toEqual([
    "0xe000000000000000000000000000000000000000",
    consent.factory.toLowerCase(),
  ]);
  expect(addresses(fixture, "ProConsentRegistry")).toEqual([
    consent.registry.toLowerCase(),
  ]);
  const trade = fixture.chains.find((chain: { id: number }) => chain.id === 10143);
  expect(trade).toBeDefined();
  expect(trade.rpc[0].url).toBe("http://127.0.0.1:1");
  expect(trade.skip).toBe(false);
  expect(trade.contracts.find((role: { name: string }) => role.name === "TradeV3Factory")?.address)
    .toEqual([TRADE_DEX_SOURCES[1]!.address]);
  expect(trade.contracts.find((role: { name: string }) => role.name === "TradeV4PoolManager")?.address)
    .toEqual([TRADE_DEX_SOURCES[0]!.address]);
  expect(trade.contracts.find((role: { name: string }) => role.name === "TerminalRouter")?.address)
    .toEqual([ROUTER]);
  expect(trade.contracts.filter((role: { name: string }) => !role.name.startsWith("TradeV") && role.name !== "TerminalRouter")
    .every((role: { address: string[] }) => role.address.length === 0)).toBe(true);
});
