import { main } from "./generate-config-lib";

// The config generator command (see generate-config-lib.ts). `--check` is used as a gate, so it has no entry
// condition: whatever path or symlink Node was started through, main() runs.
process.exitCode = main(process.argv.slice(2));
