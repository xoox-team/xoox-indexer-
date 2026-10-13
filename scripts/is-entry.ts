import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when `metaUrl` (a module's import.meta.url) is the file Node was started with. Node resolves import.meta.url
 * through symlinks while process.argv[1] stays as typed, so comparing the two spellings directly makes a tool started
 * through a symlinked directory (a `current` release link, a symlinked mount) a silent no-op that exits 0. Both
 * sides are real paths here. The launch gates (launch-guard.ts, config-lint.ts, generate-config.ts) do not use this:
 * they have no entry condition at all.
 */
export function isEntry(
  metaUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}
