import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contracts } from "../configuration";

const MAX_CONFIG_BYTES = 1024 * 1024;
const NAME = "TerminalRouter";

/**
 * Whether the active configuration subscribes the optional TerminalRouter role.
 * Envio rejects a handler whose contract no chain configures, so the handler is
 * registered only when this holds; configurations that predate the router keep
 * booting. A declaration that is duplicated or differs from the reviewed ABI is
 * refused outright, as for the Pro roles in pro-consent-source.ts.
 */
export function terminalRouterConfigured(): boolean {
  const bytes = readFileSync(
    resolve(process.env.ENVIO_CONFIG ?? "config.yaml"),
  );
  if (bytes.length > MAX_CONFIG_BYTES)
    throw new Error("Terminal router: operator configuration is oversized.");
  const config = JSON.parse(bytes.toString("utf8")) as {
    contracts?: { name?: string; events?: { event?: string }[] }[];
    chains?: { contracts?: { name?: string }[] }[];
  };
  const declared = config.contracts?.filter((item) => item.name === NAME) ?? [];
  const known = contracts.find((item) => item.name === NAME)!;
  if (
    declared.length > 1 ||
    (declared.length === 1 &&
      JSON.stringify(declared[0]) !== JSON.stringify(known))
  )
    throw new Error(
      "Terminal router: ABI declaration is duplicate or differs.",
    );
  return (
    declared.length === 1 &&
    Boolean(
      config.chains?.some((chain) =>
        chain.contracts?.some((item) => item.name === NAME),
      ),
    )
  );
}
