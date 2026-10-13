// Vendored from the XOOX SDK; only what the indexer uses.
import {
  getAddress,
  isAddress,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

export type ProFeeProgramClaimAssetRole = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** Reserved historical roles remain decodable; new Monad deployments use only
 * the asset families supported by the reviewed network scope. */
export const PRO_FEE_PROGRAM_MONAD_CLAIM_ASSET_ROLES = Object.freeze([
  1, 2, 4, 5,
] as const);
export const PRO_FEE_PROGRAM_CLAIM_ASSET_NAMES = Object.freeze({
  1: "MON",
  2: "BTC",
  3: "ZEC",
  4: "USDC",
  5: "ETH",
  6: "JUP",
  7: "BONK",
  8: "WIF",
} as const);
/** Exact reviewed constructor assets and source-defined holder payout minimums. */
export type ProFeeProgramClaimPolicy = Readonly<{
  assetRole: ProFeeProgramClaimAssetRole;
  asset: Address;
  runtimeCodeHash: Hex;
  decimals: number;
  minimumClaim: bigint;
}>;
const uint256 = 1n << 256n;
function need(value: unknown, message: string): asserts value {
  if (!value) throw new Error("Pro fee program claim policy: " + message + ".");
}
export function proFeeProgramMinimumHolderClaim(
  assetRole: ProFeeProgramClaimAssetRole,
  decimals: number,
): bigint {
  need(
    Number.isInteger(assetRole) && assetRole >= 1 && assetRole <= 8,
    "unknown asset role",
  );
  need(
    Number.isInteger(decimals) && decimals >= 0 && decimals <= 36,
    "invalid actual asset decimals",
  );
  if (assetRole === 1) {
    need(decimals === 18, "native MON requires 18 decimals");
    return 10n ** 15n;
  }
  const scale = 10n ** BigInt(decimals);
  if (assetRole === 7) return 100n * scale;
  const denominator =
    assetRole === 2 || assetRole === 5
      ? 100000n
      : assetRole === 3
        ? 1000n
        : 10n;
  return (scale + denominator - 1n) / denominator;
}
/** The builtin native entry is mandatory; external roles are canonical, distinct and explicit. */
export function captureProFeeProgramClaimPolicies(
  value: unknown,
): readonly ProFeeProgramClaimPolicy[] {
  need(
    Array.isArray(value) && value.length >= 1 && value.length <= 8,
    "an explicit native and approved asset policy list is required",
  );
  const seen = new Set<string>();
  let previous = 0;
  return Object.freeze(
    value.map((input) => {
      need(
        input && typeof input === "object" && !Array.isArray(input),
        "invalid policy entry",
      );
      const raw = input as Record<string, unknown>;
      need(
        Object.keys(raw).length === 5 &&
          [
            "assetRole",
            "asset",
            "runtimeCodeHash",
            "decimals",
            "minimumClaim",
          ].every((key) => Object.hasOwn(raw, key)),
        "unknown or missing policy fields",
      );
      const role = raw.assetRole as ProFeeProgramClaimAssetRole;
      need(
        Number.isInteger(role) &&
          role > previous &&
          role <= 8 &&
          (previous !== 0 || role === 1),
        "policies must begin with native MON and use sorted unique roles",
      );
      previous = role;
      need(
        typeof raw.asset === "string" && isAddress(raw.asset),
        "invalid approved asset address",
      );
      const asset = getAddress(raw.asset);
      need(!seen.has(asset.toLowerCase()), "duplicate approved asset address");
      seen.add(asset.toLowerCase());
      need(
        typeof raw.runtimeCodeHash === "string" &&
          /^0x[\da-f]{64}$/i.test(raw.runtimeCodeHash),
        "invalid reviewed asset runtime hash",
      );
      const runtimeCodeHash = raw.runtimeCodeHash.toLowerCase() as Hex;
      need(
        (role === 1) === (asset === zeroAddress) &&
          (role === 1) === (runtimeCodeHash === zeroHash),
        "native and ERC20 source identities differ",
      );
      need(
        typeof raw.decimals === "number",
        "actual asset decimals must be an integer",
      );
      const minimumClaim = proFeeProgramMinimumHolderClaim(role, raw.decimals);
      need(
        typeof raw.minimumClaim === "bigint" &&
          raw.minimumClaim > 0n &&
          raw.minimumClaim < uint256 &&
          raw.minimumClaim === minimumClaim,
        "minimum does not match the source-defined asset threshold",
      );
      return Object.freeze({
        assetRole: role,
        asset,
        runtimeCodeHash,
        decimals: raw.decimals,
        minimumClaim,
      });
    }),
  );
}
/** New-deployment admission, separate from historical policy decoding. Exact
 * asset code, precision and routes still require independent source approval. */
export function assertProFeeProgramMonadClaimPolicies(
  policies: readonly ProFeeProgramClaimPolicy[],
): void {
  for (const policy of policies)
    need(
      (PRO_FEE_PROGRAM_MONAD_CLAIM_ASSET_ROLES as readonly number[]).includes(
        policy.assetRole,
      ),
      `${PRO_FEE_PROGRAM_CLAIM_ASSET_NAMES[policy.assetRole]} is canceled for new Monad deployments; no verified Monad pair is approved`,
    );
}
const holderRoles: Readonly<
  Partial<Record<number, ProFeeProgramClaimAssetRole>>
> = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  11: 5,
  12: 6,
  13: 7,
  14: 8,
  15: 1,
  18: 1,
  19: 1,
  20: 1,
});
/** Direct treasury/salary credits use their separate immutable recipient accounting. */
export function assertProFeeProgramHolderAssetPolicies(
  policies: readonly ProFeeProgramClaimPolicy[],
  programs: readonly Readonly<{
    moduleId: number;
    asset: Address;
    allowedAssets: readonly Address[];
  }>[],
): void {
  for (const program of programs) {
    const role = holderRoles[program.moduleId];
    if (role !== undefined) {
      const asset = program.asset;
      need(
        policies.some(
          (policy) =>
            policy.assetRole === role &&
            policy.asset.toLowerCase() === asset.toLowerCase(),
        ),
        `${PRO_FEE_PROGRAM_CLAIM_ASSET_NAMES[role]} holder output has no matching reviewed payout policy`,
      );
    }
    // Contests pay a winner's direct ledger only in native currency or a reviewed asset.
    if ([8, 16, 21, 22].includes(program.moduleId))
      need(
        policies.some((policy) => policy.asset.toLowerCase() === program.asset.toLowerCase()),
        "contest payout asset has no matching reviewed payout policy",
      );
  }
}
