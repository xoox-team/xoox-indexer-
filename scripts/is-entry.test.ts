import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isEntry } from "./is-entry";

const here = fileURLToPath(new URL(".", import.meta.url));
const file = join(here, "is-entry.ts");
const metaUrl = pathToFileURL(file).href;

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), "xoox-one-entry-"));
  directories.push(directory);
  return directory;
};

describe("isEntry", () => {
  it("is true when argv[1] is the module itself", () => {
    expect(isEntry(metaUrl, file)).toBe(true);
  });

  it("is true through a symlinked directory and through a symlinked file", () => {
    const directory = scratch();
    symlinkSync(here, join(directory, "current"));
    symlinkSync(file, join(directory, "link.ts"));
    expect(isEntry(metaUrl, join(directory, "current", "is-entry.ts"))).toBe(
      true,
    );
    expect(isEntry(metaUrl, join(directory, "link.ts"))).toBe(true);
  });

  it("is false for another module, a missing path and no argv[1]", () => {
    expect(isEntry(metaUrl, join(here, "pg-ident.ts"))).toBe(false);
    expect(isEntry(metaUrl, join(here, "does-not-exist.ts"))).toBe(false);
    expect(isEntry(metaUrl, undefined)).toBe(false);
    expect(isEntry(metaUrl, "")).toBe(false);
  });
});

// The read-only tools start only when they are the entry. Run through a symlinked directory they must still start.
describe("read-only tools started through a symlinked directory", () => {
  it("run instead of silently exiting 0", () => {
    const directory = scratch();
    const link = join(directory, "current");
    symlinkSync(here, link);
    for (const tool of [
      "parity-sql.ts",
      "backfill-estimator.ts",
      "effect-cache-export.ts",
      "type-parity.ts",
    ]) {
      const result = spawnSync(
        join(here, "../node_modules/.bin/tsx"),
        [join(link, tool)],
        {
          env: { PATH: process.env["PATH"] ?? "" },
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      // With no arguments each prints its usage or a refusal; silence with status 0 is the bug.
      expect(`${result.stdout}${result.stderr}`, tool).not.toBe("");
    }
  }, 60_000);
});
