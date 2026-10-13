import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as configuration from "./configuration";
import type { Deployment } from "./vendor/xoox-sdk/config";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
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
const build = (
  configuration as typeof configuration & {
    verifiedTestnetConfiguration: (
      raw: unknown,
      verify: (deployment: Deployment) => Promise<unknown>,
    ) => Promise<ReturnType<typeof configuration.envioConfiguration>>;
  }
).verifiedTestnetConfiguration;
const writeConfig = (
  configuration as typeof configuration & {
    writeVerifiedTestnetConfiguration: (
      raw: unknown,
      outputPath: string,
      verify: (deployment: Deployment) => Promise<unknown>,
    ) => Promise<void>;
  }
).writeVerifiedTestnetConfiguration;

describe("verified Monad testnet Envio configuration", () => {
  it("indexes verified 10143 sources from the earliest deployment block", async () => {
    const verify = vi.fn(async (_deployment: Deployment) => {});
    const config = await build(manifest, verify);
    expect(config.name).toBe("xoox-monad-testnet");
    expect(verify).toHaveBeenCalledOnce();
    expect(verify.mock.calls[0]?.[0].chainId).toBe(10143);
    expect(config.chains[0]).toMatchObject({
      id: 10143,
      start_block: 61_283_810,
      rpc: [{ url: manifest.rpcUrl, for: "fallback" }],
    });
    expect(
      config.chains[0].contracts.find((contract) => contract.name === "Factory")
        ?.address,
    ).toEqual([manifest.factory]);
  });

  it("rejects 31337 and 143 manifests before the network verifier runs", async () => {
    const verify = vi.fn(async (_deployment: Deployment) => {});
    await expect(build({ ...manifest, chainId: 143 }, verify)).rejects.toThrow(
      "10143",
    );
    await expect(
      build(
        {
          ...manifest,
          chainId: 31337,
          environment: "local",
          rpcUrl: "http://127.0.0.1:9545",
        },
        verify,
      ),
    ).rejects.toThrow("10143");
    expect(verify).not.toHaveBeenCalled();
  });

  it("refuses credential-bearing RPC URLs and failed onchain verification", async () => {
    const verify = vi.fn(async (_deployment: Deployment) => {
      throw new Error("Missing deployed code");
    });
    await expect(
      build(
        {
          ...manifest,
          rpcUrl: "https://provider.example/a-very-long-private-credential",
        },
        verify,
      ),
    ).rejects.toThrow("anonymous public RPC URL");
    expect(verify).not.toHaveBeenCalled();
    await expect(build(manifest, verify)).rejects.toThrow(
      "Missing deployed code",
    );
  });

  it("writes only the separate testnet config after verification", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xoox-envio-testnet-"));
    try {
      const localPath = join(directory, "config.yaml");
      const testnetPath = join(directory, "config.testnet.yaml");
      await writeFile(localPath, "local 31337 fixture\n");
      await expect(
        writeConfig(manifest, localPath, async () => {}),
      ).rejects.toThrow("config.testnet.yaml");
      await writeConfig(manifest, testnetPath, async () => {});
      expect(await readFile(localPath, "utf8")).toBe("local 31337 fixture\n");
      expect(JSON.parse(await readFile(testnetPath, "utf8")).chains[0].id).toBe(
        10143,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not create a config when onchain verification fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xoox-envio-testnet-"));
    try {
      await expect(
        writeConfig(
          manifest,
          join(directory, "config.testnet.yaml"),
          async () => {
            throw new Error("No bytecode");
          },
        ),
      ).rejects.toThrow("No bytecode");
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
