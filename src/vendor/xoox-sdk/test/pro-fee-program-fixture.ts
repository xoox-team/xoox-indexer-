// Vendored from the XOOX SDK; only what the indexer uses.
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  getContractAddress,
  keccak256,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { proReactiveParticipantAbi } from "../pro-reactive-participant";
import {
  PRO_REACTIVE_PARTICIPANT_DOMAIN,
  PRO_REACTIVE_CONSENT_PAIR_DOMAIN,
  proReactiveConsentTypes,
} from "../pro-reactive-consent";
import {
  PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS,
  PRO_FEE_PROGRAM_VAULT_ARTIFACT,
  PRO_FEE_PROGRAM_CURVE_ARTIFACT,
  type ProBootstrapComponent,
  type ProBootstrapSourceManifest,
  type ProBootstrapConfiguration,
} from "../pro-bootstrap";
import { bootstrapFixture } from "./pro-bootstrap-fixture";

/** Synthetic review records and runtimes for ABI tests; never deployment approvals. */
export function feeProgramBootstrapFixture(
  configuration?: ProBootstrapConfiguration,
  /** ERC20 quotes the fee Factory's owner approved before sealing it (native is implicit). The family has no earlier generation, so the list is always proven; empty means native only. */
  quoteAddresses: readonly Address[] = [],
) {
  const f = bootstrapFixture(configuration, 3, quoteAddresses);
  const previousRegistry = f.components.partnerRegistry;
  const partner = getAddress("0x7100000000000000000000000000000000000000");
  f.components.partnerRegistry = partner;
  const registryCode = f.codes.get(previousRegistry.toLowerCase())!;
  f.codes.delete(previousRegistry.toLowerCase());
  f.codes.set(partner.toLowerCase(), registryCode);
  for (const [key, value] of [...f.values]) {
    const remapped = key.replaceAll(
      previousRegistry.toLowerCase(),
      partner.toLowerCase(),
    );
    const replacement =
      typeof value === "string" &&
      value.toLowerCase() === previousRegistry.toLowerCase()
        ? partner
        : value;
    if (remapped !== key) f.values.delete(key);
    f.values.set(remapped, replacement);
  }
  f.set(f.factory, "partnerRegistry", partner);
  f.set(f.factory, "isSystemAddress", true, [partner]);
  f.components.programDeployer = getAddress(
    "0x7200000000000000000000000000000000000000",
  );
  f.components.claimProcessor = getAddress(
    "0x7300000000000000000000000000000000000000",
  );
  f.components.programVaultCodeChunk0 = getContractAddress({
    from: f.components.programDeployer,
    nonce: 1n,
  });
  f.components.programVaultCodeChunk1 = getContractAddress({
    from: f.components.programDeployer,
    nonce: 2n,
  });
  const creationCode = "0x60006000" as Hex;
  f.codes.set(f.components.programDeployer.toLowerCase(), "0x60116000");
  f.codes.set(f.components.claimProcessor.toLowerCase(), "0x60126000");
  f.codes.set(f.components.programVaultCodeChunk0.toLowerCase(), "0x006000");
  f.codes.set(f.components.programVaultCodeChunk1.toLowerCase(), "0x006000");
  const artifacts = { ...f.manifest.artifacts } as Record<
    ProBootstrapComponent,
    { artifact: string; address: Address; runtimeCodeHash: Hex }
  >;
  for (const [name, artifact] of Object.entries(
    PRO_FEE_PROGRAM_BOOTSTRAP_ARTIFACTS,
  )) {
    const role = name as ProBootstrapComponent;
    artifacts[role] = {
      artifact,
      address: f.components[role],
      runtimeCodeHash: keccak256(
        f.codes.get(f.components[role].toLowerCase())!,
      ),
    };
  }
  const manifest = {
    ...f.manifest,
    version: 4,
    artifacts,
    feePrograms: {
      version: 4,
      vaultArtifact: PRO_FEE_PROGRAM_VAULT_ARTIFACT,
      vaultCreationCodeHash: keccak256(creationCode),
      curveArtifact: PRO_FEE_PROGRAM_CURVE_ARTIFACT,
      curveCreationCodeHash: keccak256("0x60006001"),
      claimPolicies: [
        {
          assetRole: 1,
          asset: zeroAddress,
          runtimeCodeHash: zeroHash,
          decimals: 18,
          minimumClaim: 10n ** 15n,
        },
      ],
    },
  } as ProBootstrapSourceManifest;
  for (const role of [
    "factory",
    "partnerRegistry",
    "tokenDeployer",
    "curveDeployer",
    "router",
    "programDeployer",
    "claimProcessor",
  ] as const)
    f.set(f.components[role], "feeProgramVersion", 4n);
  f.set(f.components.router, "programDeployer", f.components.programDeployer);
  f.set(
    f.components.router,
    "programDeployerCodeHash",
    artifacts.programDeployer.runtimeCodeHash,
  );
  f.set(f.components.programDeployer, "proTokenVersion", 1n);
  f.set(f.components.programDeployer, "factory", f.factory);
  f.set(f.components.programDeployer, "router", f.components.router);
  f.set(
    f.components.programDeployer,
    "claimProcessor",
    f.components.claimProcessor,
  );
  f.set(
    f.components.programDeployer,
    "claimProcessorCodeHash",
    artifacts.claimProcessor.runtimeCodeHash,
  );
  f.set(f.components.claimProcessor, "claimProcessorVersion", 4n);
  f.set(f.components.claimProcessor, "policyCount", 1n);
  f.set(
    f.components.claimProcessor,
    "policyAt",
    [1, zeroAddress, zeroHash, 18, 10n ** 15n],
    [0n],
  );
  f.set(
    f.components.programDeployer,
    "codeChunk0",
    f.components.programVaultCodeChunk0,
  );
  f.set(
    f.components.programDeployer,
    "codeChunk1",
    f.components.programVaultCodeChunk1,
  );
  f.set(
    f.components.programDeployer,
    "codeChunkHash0",
    artifacts.programVaultCodeChunk0.runtimeCodeHash,
  );
  f.set(
    f.components.programDeployer,
    "codeChunkHash1",
    artifacts.programVaultCodeChunk1.runtimeCodeHash,
  );
  f.set(
    f.components.programDeployer,
    "vaultCreationCodeHash",
    keccak256(creationCode),
  );
  f.set(
    f.components.curveDeployer,
    "curveCreationCodeHash",
    keccak256("0x60006001"),
  );
  if (configuration?.reactive) {
    const registry = f.components.linkRegistry;
    f.set(registry, "factoryCodeHash", artifacts.factory.runtimeCodeHash);
    f.set(registry, "PARTICIPANT_DOMAIN", PRO_REACTIVE_PARTICIPANT_DOMAIN);
    f.set(registry, "FINAL_PAIR_DOMAIN", PRO_REACTIVE_CONSENT_PAIR_DOMAIN);
    f.set(
      registry,
      "CONSENT_TYPEHASH",
      keccak256(
        new TextEncoder().encode(
          "ParticipantConsent(" +
            proReactiveConsentTypes.ParticipantConsent.map(
              (field) => field.type + " " + field.name,
            ).join(",") +
            ")",
        ),
      ),
    );
    const client = createPublicClient({
      transport: custom(
        {
          async request({ method, params }) {
            if (method === "eth_call") {
              const [call, pin] = params as [
                { to: Address; data: Hex },
                { blockHash: Hex; requireCanonical: boolean },
              ];
              let decoded;
              try {
                decoded = decodeFunctionData({
                  abi: proReactiveParticipantAbi,
                  data: call.data,
                });
              } catch {
                return f.client.request({ method, params } as never);
              }
              const key =
                call.to.toLowerCase() +
                ":" +
                decoded.functionName +
                ":" +
                (decoded.args ?? [])
                  .map((value) => String(value).toLowerCase())
                  .join(",");
              if (!f.values.has(key))
                return f.client.request({ method, params } as never);
              if (
                f.control.rejectCanonical ||
                pin.blockHash !== f.blockHash ||
                pin.requireCanonical !== true
              )
                throw new Error("Canonical block required");
              return encodeFunctionResult({
                abi: proReactiveParticipantAbi,
                functionName: decoded.functionName,
                result: f.values.get(key),
              } as never);
            }
            return f.client.request({ method, params } as never);
          },
        },
        { retryCount: 0 },
      ),
    });
    return { ...f, client, manifest, creationCode };
  }
  return { ...f, manifest, creationCode };
}
