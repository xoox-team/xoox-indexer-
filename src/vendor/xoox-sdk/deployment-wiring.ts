// Vendored from the XOOX SDK; only what the indexer uses.
import { verifyPaymentWiring } from "./payment-routing";
import { readDuoCapability } from "./duo";
import { missingCapability } from "./holder-fees";
import { readLaunchSniperExemptionsCapability } from "./sniper-exemptions";
import {
  getAddress,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import type { Deployment } from "./config";
import { assertMonadPaymentDependencies, assertMonadDeploymentDependencies } from "./networks";

const permanentPositionOwner = getAddress(
  "0x000000000000000000000000000000000000dEaD",
);

/** Every contract needed by the complete launch, graduation and reward flow. */
export const deploymentContractRoles = [
  "factory",
  "feeVault",
  "buybackVault",
  "poolManager",
  "positionManager",
  "hook",
  "swapRouter",
  "launchRouter",
  "treasury",
  "locker",
  "graduationExecutor",
  "dividendFactory",
  "weth",
  "permit2",
] as const;
type DeploymentRole = (typeof deploymentContractRoles)[number];
export type DeploymentRelationship = {
  contract: Address;
  getter: string;
  value: Address | string | boolean;
};
export type DeploymentSecurityEvidence = {
  deploymentAuthority: Address;
  governance: Address;
  keeperOperator: Address;
  opsRecipient: Address;
  permissionless: boolean;
  protocolBuyback: { token: Address; executor: Address } | null;
};

/** New factories use this immutable helper for Single launches too. Only the
 * recognized missing getter on an older factory may omit it from verification. */
export async function readDeploymentLaunchPolicy(
  client: PublicClient,
  deployment: Pick<Deployment, "factory" | "duoExecutor" | "environment">,
  blockNumber: bigint,
): Promise<Address | undefined> {
  let policy: Address;
  try {
    policy = await client.readContract({
      address: deployment.factory,
      abi: parseAbi(["function duoLaunchPolicy() view returns(address)"]),
      functionName: "duoLaunchPolicy",
      blockNumber,
    });
  } catch (error) {
    if (!missingCapability(error)) throw error;
    if (deployment.duoExecutor || deployment.environment === "configured")
      throw new Error("Duo policy is missing.");
    return undefined;
  }
  if (!isAddress(policy) || policy.toLowerCase() === zeroAddress)
    throw new Error("Duo policy is missing.");
  policy = getAddress(policy);
  const code = await client.getCode({ address: policy, blockNumber });
  if (!code || code === "0x")
    throw new Error("Duo policy has no deployed code.");
  const policyFactory = await client.readContract({
    address: policy,
    abi: parseAbi(["function factory() view returns(address)"]),
    functionName: "factory",
    blockNumber,
  });
  if (policyFactory.toLowerCase() !== deployment.factory.toLowerCase())
    throw new Error("Duo policy factory mismatch.");
  // Helper presence identifies the new interface. A missing version getter here
  // is inconsistent, unlike a confirmed missing helper on a legacy factory.
  const version = await client.readContract({
    address: deployment.factory,
    abi: parseAbi(["function duoVersion() view returns(uint256)"]),
    functionName: "duoVersion",
    blockNumber,
  });
  if (version !== 0n && version !== 2n)
    throw new Error("Factory Duo version is unsupported.");
  const duo =
    version === 0n
      ? { version: 0 as const }
      : await readDuoCapability(client, deployment.factory, blockNumber);
  if (duo.version === 2 && !deployment.duoExecutor)
    throw new Error(
      "Configured Duo executor is missing from the deployment manifest.",
    );
  if (
    deployment.duoExecutor &&
    (duo.version !== 2 ||
      duo.executor.toLowerCase() !== deployment.duoExecutor.toLowerCase())
  )
    throw new Error("Duo executor does not match the factory capability.");
  return policy;
}

export async function readDeploymentGraduationGuard(
  client: PublicClient,
  policy: Address,
  blockNumber: bigint,
): Promise<Address> {
  const guard = await client.readContract({
    address: policy,
    abi: parseAbi(["function graduationGuard() view returns(address)"]),
    functionName: "graduationGuard",
    blockNumber,
  });
  if (!isAddress(guard) || guard.toLowerCase() === zeroAddress)
    throw new Error("Graduation guard is missing.");
  return getAddress(guard);
}

export async function readDeploymentRecoveryVault(
  client: PublicClient,
  policy: Address,
  factory: Address,
  blockNumber: bigint,
): Promise<Address> {
  const recovery = await client.readContract({
    address: policy,
    abi: parseAbi(["function recoveryVault() view returns(address)"]),
    functionName: "recoveryVault",
    blockNumber,
  });
  if (!isAddress(recovery) || recovery.toLowerCase() === zeroAddress)
    throw new Error("Recovery vault is missing.");
  const recoveryVault = getAddress(recovery);
  const code = await client.getCode({ address: recoveryVault, blockNumber });
  if (!code || code === "0x")
    throw new Error("Recovery vault has no deployed code.");
  const recoveryFactory = await client.readContract({
    address: recoveryVault,
    abi: parseAbi(["function factory() view returns(address)"]),
    functionName: "factory",
    blockNumber,
  });
  if (String(recoveryFactory).toLowerCase() !== factory.toLowerCase())
    throw new Error("Recovery vault factory mismatch.");
  return recoveryVault;
}

export function deploymentContractAddresses(
  deployment: Deployment,
): Record<DeploymentRole, Address> {
  const result = {} as Record<DeploymentRole, Address>;
  for (const role of deploymentContractRoles) {
    const value = deployment[role];
    if (
      !value ||
      !isAddress(value, { strict: false }) ||
      value.toLowerCase() === zeroAddress
    )
      throw new Error(
        `Complete deployment requires a nonzero ${role} address.`,
      );
    result[role] = getAddress(value);
  }
  return result;
}

/** Verify the optional launch and standalone staking module when the manifest declares it. */
export async function verifyStakingFactoryWiring(
  client: PublicClient,
  deployment: Pick<Deployment, "factory" | "stakingFactory">,
  blockNumber: bigint,
): Promise<DeploymentRelationship[]> {
  if (!deployment.stakingFactory) return [];
  const stakingFactory = deployment.stakingFactory;
  const code = await client.getCode({ address: stakingFactory, blockNumber });
  if (!code || code === "0x")
    throw new Error("Staking factory has no deployed code.");
  const [boundFactory, launchFactory, stakingVersion, factoryVersion] =
    await Promise.all([
      client.readContract({
        address: deployment.factory,
        abi: parseAbi(["function stakingFactory() view returns(address)"]),
        functionName: "stakingFactory",
        blockNumber,
      }),
      client.readContract({
        address: stakingFactory,
        abi: parseAbi(["function launchFactory() view returns(address)"]),
        functionName: "launchFactory",
        blockNumber,
      }),
      client.readContract({
        address: stakingFactory,
        abi: parseAbi(["function version() view returns(uint256)"]),
        functionName: "version",
        blockNumber,
      }),
      client.readContract({
        address: deployment.factory,
        abi: parseAbi(["function launchStakingVersion() view returns(uint256)"]),
        functionName: "launchStakingVersion",
        blockNumber,
      }),
    ]);
  if (
    boundFactory.toLowerCase() !== stakingFactory.toLowerCase() ||
    launchFactory.toLowerCase() !== deployment.factory.toLowerCase() ||
    stakingVersion !== 1n ||
    factoryVersion !== 1n
  )
    throw new Error("Staking factory wiring or version mismatch.");
  return [
    { contract: deployment.factory, getter: "stakingFactory", value: stakingFactory },
    { contract: stakingFactory, getter: "launchFactory", value: deployment.factory },
    { contract: stakingFactory, getter: "version", value: "1" },
    { contract: deployment.factory, getter: "launchStakingVersion", value: "1" },
  ];
}

const links = [
  ["factory", "feeVault", "feeVault"],
  ["factory", "hook", "hook"],
  ["factory", "launchRouter", "launchRouter"],
  ["factory", "graduationExecutor", "graduationExecutor"],
  ["factory", "dividendFactory", "dividendFactory"],
  ["launchRouter", "factory", "factory"],
  ["launchDeployer", "factory", "factory"],
  ["feeVault", "factory", "factory"],
  ["feeVault", "buybackVault", "buybackVault"],
  ["feeVault", "protocolRecipient", "treasury"],
  ["feeVault", "buybackExecutor", "swapRouter"],
  ["buybackVault", "feeVault", "feeVault"],
  ["buybackVault", "protocolRecipient", "treasury"],
  ["hook", "poolManager", "poolManager"],
  ["hook", "factory", "factory"],
  ["hook", "feeVault", "feeVault"],
  ["hook", "swapRouter", "swapRouter"],
  ["hook", "graduationExecutor", "graduationExecutor"],
  ["swapRouter", "factory", "factory"],
  ["swapRouter", "poolManager", "poolManager"],
  ["swapRouter", "feeVault", "feeVault"],
  ["swapRouter", "hook", "hook"],
  ["locker", "positionManager", "positionManager"],
  ["locker", "executor", "graduationExecutor"],
  ["locker", "feeHook", "hook"],
  ["graduationExecutor", "factory", "factory"],
  ["graduationExecutor", "poolManager", "poolManager"],
  ["graduationExecutor", "positionManager", "positionManager"],
  ["graduationExecutor", "permit2", "permit2"],
  ["graduationExecutor", "locker", "locker"],
  ["graduationExecutor", "hook", "hook"],
  ["positionManager", "poolManager", "poolManager"],
  ["positionManager", "permit2", "permit2"],
  ["positionManager", "WETH9", "weth"],
  ["dividendFactory", "factory", "factory"],
  ["dividendFactory", "feeVault", "feeVault"],
  ["treasury", "feeVault", "feeVault"],
] as const;

async function verifyDeploymentSecurity(
  client: PublicClient,
  deployment: Deployment,
  blockNumber: bigint,
): Promise<{
  evidence?: DeploymentSecurityEvidence;
  relationships: DeploymentRelationship[];
}> {
  const security = deployment.security;
  if (!security) {
    if (deployment.environment === "configured")
      throw new Error(
        "Configured deployment manifest must declare reviewed security roles.",
      );
    return { relationships: [] };
  }
  if (
    deployment.environment === "configured" &&
    security.protocolBuyback != null
  )
    throw new Error(
      "Protocol buyback release remains closed until its separate executor enforces a governance price bound.",
    );
  if (
    deployment.chainId === 143 &&
    (security.governance.toLowerCase() ===
      security.deploymentAuthority.toLowerCase() ||
      security.governance.toLowerCase() ===
        security.keeperOperator.toLowerCase() ||
      security.deploymentAuthority.toLowerCase() ===
        security.keeperOperator.toLowerCase() ||
      security.opsRecipient.toLowerCase() ===
        security.deploymentAuthority.toLowerCase() ||
      security.opsRecipient.toLowerCase() ===
        security.keeperOperator.toLowerCase())
  )
    throw new Error(
      "Mainnet deployment, governance, keeper and operations roles are not safely separated.",
    );

  const relationships: DeploymentRelationship[] = [];
  for (const [contract, getter, expected] of [
    [deployment.factory, "owner", security.governance],
    [deployment.feeVault, "owner", security.governance],
    [deployment.buybackVault, "owner", security.governance],
    [deployment.treasury!, "owner", security.governance],
    [deployment.factory, "pendingOwner", zeroAddress],
    [deployment.feeVault, "pendingOwner", zeroAddress],
    [deployment.buybackVault, "pendingOwner", zeroAddress],
    [deployment.treasury!, "pendingOwner", zeroAddress],
    [deployment.hook, "setupAuthority", security.deploymentAuthority],
    [deployment.locker!, "setupAuthority", security.deploymentAuthority],
    [deployment.hook, "feeSweepOperator", security.keeperOperator],
    [deployment.feeVault, "feeSweepOperator", security.keeperOperator],
    [deployment.treasury!, "opsRecipient", security.opsRecipient],
    [
      deployment.treasury!,
      "protocolToken",
      security.protocolBuyback?.token ?? zeroAddress,
    ],
    [
      deployment.treasury!,
      "protocolBuybackExecutor",
      security.protocolBuyback?.executor ?? zeroAddress,
    ],
  ] as const) {
    const actual = await client.readContract({
      address: contract,
      abi: parseAbi([`function ${getter}() view returns (address)`]),
      functionName: getter,
      blockNumber,
    });
    if (String(actual).toLowerCase() !== expected.toLowerCase())
      throw new Error(
        `Deployment security mismatch: ${getter}; expected ${expected}.`,
      );
    relationships.push({
      contract: getAddress(contract),
      getter,
      value: getAddress(String(actual)),
    });
  }
  const permissionless = await client.readContract({
    address: deployment.factory,
    abi: parseAbi(["function permissionless() view returns (bool)"]),
    functionName: "permissionless",
    blockNumber,
  });
  if (permissionless !== security.permissionless)
    throw new Error(
      `Deployment security mismatch: permissionless is ${permissionless}, expected ${security.permissionless}.`,
    );
  return {
    evidence: {
      deploymentAuthority: security.deploymentAuthority,
      governance: security.governance,
      keeperOperator: security.keeperOperator,
      opsRecipient: security.opsRecipient,
      permissionless,
      protocolBuyback: security.protocolBuyback ?? null,
    },
    relationships,
  };
}

/** Check constructor and one-time links at the caller's single pinned block. */
export async function verifyDeploymentWiring(
  client: PublicClient,
  deployment: Deployment,
  blockNumber: bigint,
): Promise<{
  relationships: DeploymentRelationship[];
  security?: DeploymentSecurityEvidence;
  derivedContracts: {
    launchDeployer: Address;
    launchCreation?: Address;
    curveDeployer?: Address;
    duoExecutor?: Address;
    duoLaunchPolicy?: Address;
    graduationGuard?: Address;
    recoveryVault?: Address;
    governance?: Address;
    stakingFactory?: Address;
  };
}> {
  assertMonadPaymentDependencies(deployment);
  assertMonadDeploymentDependencies(deployment);
  const hasDuoPairs = (deployment.duoPairs?.length ?? 0) > 0;
  const closedConfiguredStaging =
    deployment.environment === "configured" &&
    deployment.security?.permissionless === false &&
    !hasDuoPairs;
  if (
    deployment.environment === "configured" &&
    ((deployment.payments && !deployment.paymentRouter) ||
      (deployment.paymentRouter &&
        !deployment.payments &&
        !closedConfiguredStaging))
  )
    throw new Error(
      "Configured deployments require paymentRouter and payments together.",
    );
  if (
    deployment.environment === "configured" &&
    (hasDuoPairs ||
      (deployment.security?.permissionless && deployment.duoExecutor)) &&
    (!deployment.paymentRouter || !deployment.payments)
  )
    throw new Error(
      "Permissionless or published Duo deployments require paymentRouter and payments together.",
    );
  if (
    deployment.environment === "configured" &&
    deployment.duoExecutor &&
    !deployment.payments &&
    !closedConfiguredStaging
  )
    throw new Error("Configured Duo requires payments.");
  const contracts = deploymentContractAddresses(deployment);
  await verifyPaymentWiring(client, deployment, blockNumber);
  const configured = await client.readContract({
    address: contracts.factory,
    abi: parseAbi(["function configured() view returns (bool)"]),
    functionName: "configured",
    blockNumber,
  });
  if (!configured) throw new Error("Deployment factory is not configured.");

  // Older manifests omit this deployer. Resolve it from the authenticated factory
  // instead of silently excluding it from runtime and reciprocal-link validation.
  const launchDeployer = await client.readContract({
    address: contracts.factory,
    abi: parseAbi(["function launchDeployer() view returns (address)"]),
    functionName: "launchDeployer",
    blockNumber,
  });
  if (
    !isAddress(launchDeployer, { strict: false }) ||
    launchDeployer.toLowerCase() === zeroAddress
  )
    throw new Error("Deployment factory has no launchDeployer.");
  const addresses = {
    ...contracts,
    launchDeployer: getAddress(launchDeployer),
  };
  const relationships: DeploymentRelationship[] = [
    {
      contract: contracts.factory,
      getter: "launchDeployer",
      value: addresses.launchDeployer,
    },
  ];
  relationships.push(...(await verifyStakingFactoryWiring(client, deployment, blockNumber)));
  for (const [source, getter, target] of links) {
    const actual = await client.readContract({
      address: addresses[source],
      abi: parseAbi([`function ${getter}() view returns (address)`]),
      functionName: getter,
      blockNumber,
    });
    if (String(actual).toLowerCase() !== addresses[target].toLowerCase())
      throw new Error(
        `Deployment wiring mismatch: ${source}.${getter}; expected ${addresses[target]}.`,
      );
    relationships.push({
      contract: addresses[source],
      getter,
      value: getAddress(String(actual)),
    });
  }
  let creationHelpers:
    | { launchCreation: Address; curveDeployer: Address }
    | undefined;
  if (
    await readLaunchSniperExemptionsCapability(
      client,
      contracts.factory,
      blockNumber,
    )
  ) {
    const [launchCreation, curveDeployer] = await Promise.all([
      client.readContract({
        address: contracts.factory,
        abi: parseAbi(["function launchCreation() view returns (address)"]),
        functionName: "launchCreation",
        blockNumber,
      }),
      client.readContract({
        address: addresses.launchDeployer,
        abi: parseAbi(["function curveDeployer() view returns (address)"]),
        functionName: "curveDeployer",
        blockNumber,
      }),
    ]);
    for (const [role, value] of [
      ["launchCreation", launchCreation],
      ["curveDeployer", curveDeployer],
    ] as const)
      if (
        !isAddress(value, { strict: false }) ||
        value.toLowerCase() === zeroAddress
      )
        throw new Error(`Sniper-capable factory has no ${role}.`);
    creationHelpers = {
      launchCreation: getAddress(launchCreation),
      curveDeployer: getAddress(curveDeployer),
    };
    relationships.push(
      {
        contract: contracts.factory,
        getter: "launchCreation",
        value: creationHelpers.launchCreation,
      },
      {
        contract: addresses.launchDeployer,
        getter: "curveDeployer",
        value: creationHelpers.curveDeployer,
      },
    );
    for (const [role, getter, expected] of [
      ["launchCreation", "factory", contracts.factory],
      ["curveDeployer", "factory", contracts.factory],
      ["curveDeployer", "launchDeployer", addresses.launchDeployer],
    ] as const) {
      const contract = creationHelpers[role];
      const actual = await client.readContract({
        address: contract,
        abi: parseAbi([`function ${getter}() view returns (address)`]),
        functionName: getter,
        blockNumber,
      });
      if (actual.toLowerCase() !== expected.toLowerCase())
        throw new Error(
          `Deployment wiring mismatch: ${role}.${getter}; expected ${expected}.`,
        );
      relationships.push({ contract, getter, value: getAddress(actual) });
    }
  }
  const positionOwner = await client.readContract({
    address: contracts.locker,
    abi: parseAbi(["function positionOwner() view returns (address)"]),
    functionName: "positionOwner",
    blockNumber,
  });
  if (
    String(positionOwner).toLowerCase() !== permanentPositionOwner.toLowerCase()
  )
    throw new Error(
      `Deployment liquidity custody mismatch: locker.positionOwner must be ${permanentPositionOwner}.`,
    );
  relationships.push({
    contract: contracts.locker,
    getter: "positionOwner",
    value: getAddress(String(positionOwner)),
  });
  const security = await verifyDeploymentSecurity(
    client,
    deployment,
    blockNumber,
  );
  relationships.push(...security.relationships);
  const duoLaunchPolicy = await readDeploymentLaunchPolicy(
    client,
    deployment,
    blockNumber,
  );
  let graduationGuard: Address | undefined;
  let recoveryVault: Address | undefined;
  if (duoLaunchPolicy) {
    [graduationGuard, recoveryVault] = await Promise.all([
      readDeploymentGraduationGuard(client, duoLaunchPolicy, blockNumber),
      readDeploymentRecoveryVault(
        client,
        duoLaunchPolicy,
        deployment.factory,
        blockNumber,
      ),
    ]);
    relationships.push({
      contract: duoLaunchPolicy,
      getter: "factory",
      value: deployment.factory,
    });
    relationships.push({
      contract: duoLaunchPolicy,
      getter: "graduationGuard",
      value: graduationGuard,
    });
    relationships.push(
      {
        contract: duoLaunchPolicy,
        getter: "recoveryVault",
        value: recoveryVault,
      },
      {
        contract: recoveryVault,
        getter: "factory",
        value: deployment.factory,
      },
    );
    const [
      maxImpact,
      epochDuration,
      strategySupported,
      maintenancePriceGuardVersion,
      maintenancePriceGuardEnabled,
    ] = await Promise.all([
      client.readContract({
        address: contracts.swapRouter,
        abi: parseAbi([
          "function maxInternalPriceImpactBps() view returns(uint16)",
        ]),
        functionName: "maxInternalPriceImpactBps",
        blockNumber,
      }),
      client.readContract({
        address: contracts.dividendFactory,
        abi: parseAbi(["function epochDuration() view returns(uint256)"]),
        functionName: "epochDuration",
        blockNumber,
      }),
      client.readContract({
        address: contracts.feeVault,
        abi: parseAbi(["function strategySupported() view returns(bool)"]),
        functionName: "strategySupported",
        blockNumber,
      }),
      client.readContract({
        address: contracts.feeVault,
        abi: parseAbi([
          "function maintenancePriceGuardVersion() view returns(uint256)",
        ]),
        functionName: "maintenancePriceGuardVersion",
        blockNumber,
      }),
      client.readContract({
        address: contracts.feeVault,
        abi: parseAbi([
          "function maintenancePriceGuardEnabled() view returns(bool)",
        ]),
        functionName: "maintenancePriceGuardEnabled",
        blockNumber,
      }),
    ]);
    if (BigInt(maxImpact) !== 500n)
      throw new Error("Swap router price impact policy must be 500 bps.");
    if (epochDuration !== 3600n)
      throw new Error("Dividend epoch duration must be 3600 seconds.");
    if (!strategySupported)
      throw new Error("Fee strategy support must be enabled.");
    if (maintenancePriceGuardVersion !== 1n || !maintenancePriceGuardEnabled)
      throw new Error(
        "Maintenance price guard version 1 must be irreversibly enabled.",
      );
    relationships.push(
      {
        contract: contracts.swapRouter,
        getter: "maxInternalPriceImpactBps",
        value: String(maxImpact),
      },
      {
        contract: contracts.dividendFactory,
        getter: "epochDuration",
        value: epochDuration.toString(),
      },
      {
        contract: contracts.feeVault,
        getter: "strategySupported",
        value: strategySupported,
      },
      {
        contract: contracts.feeVault,
        getter: "maintenancePriceGuardVersion",
        value: maintenancePriceGuardVersion.toString(),
      },
      {
        contract: contracts.feeVault,
        getter: "maintenancePriceGuardEnabled",
        value: maintenancePriceGuardEnabled,
      },
    );
  }
  if (deployment.duoExecutor) {
    for (const [getter, expected] of [
      ["feeVault", contracts.feeVault],
      ["poolManager", contracts.poolManager],
      ["positionManager", contracts.positionManager],
      ["permit2", contracts.permit2],
      ["locker", contracts.locker],
      ["hook", contracts.hook],
      ["weth", contracts.weth],
      ...(deployment.payments
        ? [["v3Factory", deployment.payments.v3Factory] as const]
        : []),
    ] as const) {
      const actual = await client.readContract({
        address: deployment.duoExecutor,
        abi: parseAbi([`function ${getter}() view returns (address)`]),
        functionName: getter,
        blockNumber,
      });
      if (String(actual).toLowerCase() !== expected.toLowerCase())
        throw new Error(`Duo ${getter} wiring mismatch.`);
      relationships.push({
        contract: deployment.duoExecutor,
        getter,
        value: getAddress(String(actual)),
      });
    }
  }
  return {
    relationships,
    ...(security.evidence ? { security: security.evidence } : {}),
    derivedContracts: {
      launchDeployer: addresses.launchDeployer,
      ...(deployment.stakingFactory
        ? { stakingFactory: deployment.stakingFactory }
        : {}),
      ...creationHelpers,
      ...(deployment.chainId === 143 && security.evidence
        ? { governance: security.evidence.governance }
        : {}),
      ...(duoLaunchPolicy ? { duoLaunchPolicy } : {}),
      ...(graduationGuard ? { graduationGuard } : {}),
      ...(recoveryVault ? { recoveryVault } : {}),
      ...(deployment.duoExecutor
        ? { duoExecutor: deployment.duoExecutor }
        : {}),
    },
  };
}
