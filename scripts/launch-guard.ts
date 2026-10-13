import { lintConfig } from "./config-lint-lib";
import {
  parseLiveEndpoints,
  runLaunchGuard,
  type GuardEnv,
} from "./launch-guard-lib";

// The launch guard command (see launch-guard-lib.ts for what it checks). Exit 0 means "start", so this file has no
// entry condition: whatever path or symlink Node was started through, main() runs. Keep it that way.
async function main(args: readonly string[], env: GuardEnv): Promise<number> {
  const liveEndpoints = parseLiveEndpoints(
    args,
    env["XOOX_ONE_LIVE_HASURA_ENDPOINTS"],
  );
  const report = await runLaunchGuard(
    { env, liveEndpoints },
    { fetch, lintConfig },
  );
  if (!report.ok) {
    console.error("Refusing to start the xoox-one indexer:");
    for (const failure of report.failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log("xoox-one launch guard passed.");
  return 0;
}

main(process.argv.slice(2), process.env).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    console.error(
      "Refusing to start the xoox-one indexer: the guard itself failed.",
    );
    process.exitCode = 1;
  },
);
