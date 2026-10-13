import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintConfig } from "./config-lint-lib";
import { generate } from "./generate-config-lib";

// Shared by config-lint.test.ts and config-lint-rpc.test.ts: the generated config, mutable copies of it, and a place to
// write them (with the schema the lint reads beside the config). Each test file calls removeScratch() after each test.
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export type Role = { name: string; address: string[]; start_block?: number };
export type Chain = {
  id: number;
  start_block?: number;
  rpc?: { url?: string; for?: string; headers?: object }[];
  contracts: Role[];
  [key: string]: unknown;
};
export type Config = {
  contracts: { name: string; events: { event: string }[] }[];
  chains: Chain[];
  [key: string]: unknown;
};

export const files = generate({ root: ROOT });
export const fresh = (
  variant: "standard" | "breakglass" = "standard",
): Config => JSON.parse(files[variant]);
export const chainOf = (config: Config) => config.chains[0]!;
export const roleOf = (config: Config, name: string) =>
  chainOf(config).contracts.find((role) => role.name === name)!;

const directories: string[] = [];
/** Registers a scratch directory a test made itself, so removeScratch() deletes it too. */
export function track(directory: string) {
  directories.push(directory);
}
export async function removeScratch() {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
}
export async function place(content: Config | string, schema = true) {
  const directory = await mkdtemp(join(tmpdir(), "xoox-one-lint-"));
  track(directory);
  if (schema)
    await copyFile(
      join(ROOT, "schema.graphql"),
      join(directory, "schema.graphql"),
    );
  const path = join(directory, "config.xoox-one.json");
  await writeFile(
    path,
    typeof content === "string"
      ? content
      : JSON.stringify(content, null, 2) + "\n",
  );
  return path;
}
export async function lint(mutate: (config: Config) => void) {
  const config = fresh();
  mutate(config);
  return lintConfig(await place(config), { env: {} });
}
