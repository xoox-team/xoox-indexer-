import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./launch.sh", import.meta.url));
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/**
 * A tree shaped like /workspace in the indexer image, with the real launch.sh and two stubs that only record how they
 * were called: tsx (the guard) and envio. STUB_GUARD_EXIT decides what the guard returns.
 */
function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xoox-one-launch-")));
  directories.push(root);
  const log = join(root, "calls.log");
  const place = (path: string, body: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
    chmodSync(join(root, path), 0o755);
  };
  place(
    "node_modules/.bin/tsx",
    `#!/bin/sh\necho "guard $*" >> "${log}"\nexit "\${STUB_GUARD_EXIT:-0}"\n`,
  );
  place(
    "node_modules/.bin/envio",
    `#!/bin/sh\necho "envio $* | cwd=$(pwd -P) | dotenv=\${DOTENV_CONFIG_PATH-unset} | config=\${ENVIO_CONFIG-unset}" >> "${log}"\n`,
  );
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts/launch.sh"));
  const run = (args: string[] = [], env: Record<string, string> = {}) => {
    const result = spawnSync(
      "sh",
      [join(root, "scripts/launch.sh"), ...args],
      {
        env: { PATH: process.env["PATH"] ?? "", ...env },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    let calls: string[] = [];
    try {
      calls = readFileSync(log, "utf8").trim().split("\n");
    } catch {
      calls = [];
    }
    return { ...result, calls };
  };
  return { root, run };
}

describe("launch.sh", () => {
  it("runs the guard and then execs a bare `envio start` from the indexer directory, with dotenv switched off", () => {
    const { root, run } = workspace();
    const result = run([], { ENVIO_CONFIG: "/etc/xoox/config.json" });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([
      `guard ${join(root, "scripts/launch-guard.ts")}`,
      `envio start | cwd=${root} | dotenv=/dev/null | config=/etc/xoox/config.json`,
    ]);
  });

  it("does not start Envio when the guard refuses", () => {
    const { run } = workspace();
    const result = run([], { STUB_GUARD_EXIT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual([expect.stringMatching(/^guard /)]);
  });

  it.each([[".env"], [".env.local"], [".env.production"]])(
    "refuses before the guard when %s sits in the indexer directory",
    (name) => {
      const { root, run } = workspace();
      writeFileSync(join(root, name), "ENVIO_PG_HOST=x\n");
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Refusing to start");
      expect(result.stderr).toContain(name);
      expect(result.calls).toEqual([]);
    },
  );

  it("starts with the committed .env.example template next to it", () => {
    const { root, run } = workspace();
    writeFileSync(join(root, ".env.example"), "ENVIO_PG_HOST=<postgres host>\n");
    const result = run();
    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(2);
  });

  it("refuses a dangling .env symlink too", () => {
    const { root, run } = workspace();
    symlinkSync("/nonexistent/private.env", join(root, ".env"));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.calls).toEqual([]);
  });

  it.each([
    [["--config", "other.json"]],
    [["-r"]],
    [["--restart"]],
    [["start"]],
  ])("takes no arguments: %j is refused before anything runs", (args) => {
    const { run } = workspace();
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("takes no arguments");
    expect(result.calls).toEqual([]);
  });

  it("never passes a config override or a restart flag to Envio", () => {
    const code = readFileSync(SCRIPT, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/--config|--restart|\s-r\b|--directory|\s-d\b/);
    expect(code).toMatch(/^exec \.\/node_modules\/\.bin\/envio start$/m);
  });
});
