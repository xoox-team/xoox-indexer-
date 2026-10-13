import { main } from "./config-lint-lib";

// The config lint command (see config-lint-lib.ts). It is used as a gate, so it has no entry condition: whatever path
// or symlink Node was started through, main() runs.
process.exitCode = main(process.argv.slice(2));
