// Vendored from the XOOX SDK; only what the indexer uses.
/**
 * Contract size limits every size gate in the repository measures against.
 *
 * XOOX targets Monad only (owner decision 2026-10-05), so the gates follow Monad's limits from MIP-2
 * (https://mips.monad.xyz/MIPs/MIP-2, status final; https://docs.monad.xyz/developer-essentials/differences),
 * not the Ethereum EIP-170 and EIP-3860 values of 24,576 and 49,152 bytes. Keep in step with
 * `code_size_limit` in `foundry.toml` and `packages/contracts/test/helpers/MonadCodeLimits.sol`.
 */

/** Maximum deployed runtime bytes: 128 KiB. */
export const MONAD_MAX_CODE_SIZE = 131_072;

/** Maximum initcode bytes, constructor arguments included: 256 KiB. */
export const MONAD_MAX_INITCODE_SIZE = 262_144;

/** Anvil arguments that let a local node deploy up to Monad's runtime limit; Anvil derives the initcode limit at twice it. */
export const MONAD_ANVIL_CODE_SIZE_ARGS: readonly string[] = [
  "--code-size-limit",
  String(MONAD_MAX_CODE_SIZE),
];
