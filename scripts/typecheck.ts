import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");

// Each Envio configuration augments the same module with its own chain IDs.
// Generate and compile them separately without rewriting a running indexer's types.
function typecheck(config: string, includeTests: boolean): void {
  const directory = mkdtempSync(join(project, ".envio-typecheck-"));
  try {
    const overlay = JSON.parse(readFileSync(join(project, config), "utf8"));
    const disabled = JSON.parse(
      readFileSync(join(project, "config.codegen.yaml"), "utf8"),
    );
    for (const name of [
      "ProFactory",
      "ProCurve",
      "ProToken",
      "ProPolicy",
      "ProGraduationRegistry",
      "ProSwapRouter",
      "ProConsentRegistry",
      "TradeV3Factory",
      "TradeV4PoolManager",
      "TerminalRouter",
    ]) {
      const known = disabled.contracts.filter(
        (entry: { name: string }) => entry.name === name,
      );
      if (known.length !== 1)
        throw new Error(`Disabled codegen must declare one exact ${name} ABI.`);
      const existing = overlay.contracts.filter(
        (entry: { name: string }) => entry.name === name,
      );
      if (
        existing.length > 1 ||
        (existing.length === 1 &&
          JSON.stringify(existing[0]) !== JSON.stringify(known[0]))
      )
        throw new Error(
          `Type-only ${name} ABI is duplicate or differs from the reviewed declaration.`,
        );
      if (existing.length === 0) overlay.contracts.push(known[0]);
      for (const chain of overlay.chains) {
        const roles = chain.contracts.filter(
          (entry: { name: string }) => entry.name === name,
        );
        if (roles.length > 1)
          throw new Error(`Type-only ${name} chain role is duplicate.`);
        if (roles.length === 0) chain.contracts.push({ name, address: [] });
      }
    }
    // Adds only an empty-address ABI role when absent, in this disposable compiler
    // directory. Actual chain IDs/addresses and runtime ENVIO_CONFIG stay intact.
    writeFileSync(
      join(directory, "config.yaml"),
      JSON.stringify(overlay, null, 2),
    );
    copyFileSync(
      join(project, "schema.graphql"),
      join(directory, "schema.graphql"),
    );
    copyFileSync(
      join(project, "package.json"),
      join(directory, "package.json"),
    );
    symlinkSync(join(project, "src"), join(directory, "src"), "dir");
    execFileSync(
      join(project, "node_modules/.bin/envio"),
      ["codegen", "--directory", directory, "--config", "config.yaml"],
      {
        cwd: project,
        stdio: "inherit",
      },
    );
    const tsconfig = join(directory, "tsconfig.json");
    writeFileSync(
      tsconfig,
      JSON.stringify(
        {
          extends: join(project, "tsconfig.json"),
          include: [
            join(project, "src/**/*.ts"),
            join(project, "scripts/**/*.ts"),
            join(directory, ".envio/types.d.ts"),
          ],
          exclude: includeTests ? [] : [join(project, "src/**/*.test.ts")],
        },
        null,
        2,
      ),
    );
    console.log(
      `Typechecking indexer ${includeTests ? "and tests" : "application"} against ${config}`,
    );
    execFileSync(
      process.execPath,
      [compiler, "--noEmit", "--project", tsconfig],
      { cwd: project, stdio: "inherit" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const activeConfig =
  process.argv[2] ??
  (existsSync(join(project, "config.yaml"))
    ? "config.yaml"
    : "config.codegen.yaml");
if (
  ![
    "config.yaml",
    "config.testnet.yaml",
    "config.codegen.yaml",
    "config.xoox-one.json",
    "config.xoox-one.breakglass.json",
  ].includes(activeConfig)
)
  throw new Error("Typecheck requires a known Envio configuration file.");
typecheck(activeConfig, false);
typecheck("config.test.yaml", true);
