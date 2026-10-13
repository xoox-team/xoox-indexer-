import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envioConfiguration } from "../configuration";
import { terminalRouterConfigured } from "./configured";

describe("terminalRouterConfigured", () => {
  let directory: string | undefined;
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });
  async function config(value: unknown) {
    directory = await mkdtemp(join(tmpdir(), "xoox-terminal-router-"));
    const path = join(directory, "config.yaml");
    await writeFile(
      path,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    vi.stubEnv("ENVIO_CONFIG", path);
  }
  const without = (value: ReturnType<typeof envioConfiguration>) => {
    const copy = structuredClone(value);
    copy.contracts = copy.contracts.filter((c) => c.name !== "TerminalRouter");
    for (const chain of copy.chains)
      chain.contracts = chain.contracts.filter(
        (c) => c.name !== "TerminalRouter",
      );
    return copy;
  };

  it("is on for the active unit-test configuration, which subscribes the router", () => {
    expect(terminalRouterConfigured()).toBe(true);
  });

  it("is on for the explicit disabled codegen declaration", async () => {
    await config(envioConfiguration());
    expect(terminalRouterConfigured()).toBe(true);
  });

  it("is off for a configuration that predates the router", async () => {
    await config(without(envioConfiguration()));
    expect(terminalRouterConfigured()).toBe(false);
  });

  it("is off when the ABI is declared but no chain subscribes the role", async () => {
    const value = structuredClone(envioConfiguration());
    for (const chain of value.chains)
      chain.contracts = chain.contracts.filter(
        (c) => c.name !== "TerminalRouter",
      );
    await config(value);
    expect(terminalRouterConfigured()).toBe(false);
  });

  it.each(["duplicate", "changed ABI"])(
    "rejects a %s declaration before registering the handler",
    async (fault) => {
      const value = structuredClone(envioConfiguration());
      if (fault === "duplicate")
        value.contracts.push(
          value.contracts.find((c) => c.name === "TerminalRouter")!,
        );
      else
        value.contracts.find((c) => c.name === "TerminalRouter")!.events[0] = {
          event: "Invented(bool allowed)",
        };
      await config(value);
      expect(() => terminalRouterConfigured()).toThrow("Terminal router");
    },
  );

  it("rejects an oversized configuration", async () => {
    await config("x".repeat(1024 * 1024 + 1));
    expect(() => terminalRouterConfigured()).toThrow("oversized");
  });
});
