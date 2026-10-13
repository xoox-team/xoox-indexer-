// Vendored from the XOOX SDK; only what the indexer uses.
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  getContractAddress,
  keccak256,
  numberToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  PRO_BOOTSTRAP_COMPONENT_ARTIFACTS,
  PRO_BOOTSTRAP_SOURCE_SCHEMA,
  proBootstrapComponentArtifact,
  proBootstrapAbi,
  type ProBootstrapComponent,
  type ProBootstrapConfiguration,
  type ProBootstrapSourceManifest,
} from "../pro-bootstrap";

/** Honest old Solidity runtimes have no fallback for these new selectors. */
export function throwLegacyBootstrapSelectorRevert(
  target: Address,
  name: string,
  components: {
    ruleValidator: Address;
    reactiveDeployer: Address;
    factory?: Address;
    linkRegistry?: Address;
  },
): void {
  if (
    (target.toLowerCase() === components.ruleValidator.toLowerCase() &&
      name === "REACTIVE_VALIDATION_CODE_HASH") ||
    (target.toLowerCase() === components.reactiveDeployer.toLowerCase() &&
      name === "validationChild") ||
    (target.toLowerCase() === components.factory?.toLowerCase() &&
      name === "reactiveParticipantVersion") ||
    ([components.reactiveDeployer, components.linkRegistry].some(
      (value) => value?.toLowerCase() === target.toLowerCase(),
    ) &&
      name === "reactiveConsentVersion")
  )
    throw { code: 3, data: "0x", message: "execution reverted" };
}

/** Synthetic reviewed artifact hashes with real viem wire decoding; never a production manifest. */
export function bootstrapFixture(
  configuration: ProBootstrapConfiguration = {
    price: false,
    reactive: false,
    peak: false,
  },
  sourceVersion: 1 | 2 | 3 = 1,
  /** ERC20 quotes of a Factory with the on-chain allowlist (native is implicit); undefined is the earlier Core generation. */
  quoteAddresses?: readonly Address[],
) {
  const factory = getAddress("0x1000000000000000000000000000000000000000");
  const owner = getAddress("0x4000000000000000000000000000000000000000");
  const routerAuthority = getAddress(
    "0x4100000000000000000000000000000000000000",
  );
  const updater = getAddress("0x4200000000000000000000000000000000000000");
  const blockHash = ("0x" + "aa".repeat(32)) as Hex;
  const otherHash = ("0x" + "bb".repeat(32)) as Hex;
  const zeroHash = ("0x" + "00".repeat(32)) as Hex;
  const components = Object.fromEntries(
    Object.keys(PRO_BOOTSTRAP_COMPONENT_ARTIFACTS).map((name, index) => [
      name,
      getAddress(
        "0x" + (0x2000n + BigInt(index)).toString(16).padStart(40, "0"),
      ),
    ]),
  ) as Record<ProBootstrapComponent, Address>;
  components.factory = factory;
  components.marketCalendar = getContractAddress({ from: factory, nonce: 1n });
  components.ruleValidator = getContractAddress({ from: factory, nonce: 2n });
  components.partnerRegistry = getContractAddress({ from: factory, nonce: 3n });
  components.vaultDeployer = getContractAddress({
    from: components.curveDeployer,
    nonce: 1n,
  });
  components.vestingDeployer = getContractAddress({
    from: components.curveDeployer,
    nonce: 2n,
  });
  components.linkRegistry = getContractAddress({
    from: components.reactiveDeployer,
    nonce: 1n,
  });
  components.reactiveValidationChild = getContractAddress({
    from: components.reactiveDeployer,
    nonce: 2n,
  });
  components.peakRegistry = getContractAddress({
    from: components.peakDeployer,
    nonce: 1n,
  });
  const optional = [
    "slidingDeployer",
    "priceOracle",
    "reactiveDeployer",
    "linkRegistry",
    "peakDeployer",
    "peakRegistry",
    "beaconDeployer",
    "entangledDeployer",
    "reactiveValidationChild",
  ];
  const names = (Object.keys(components) as ProBootstrapComponent[]).filter(
    (name) =>
      !optional.includes(name) ||
      (configuration.price &&
        ["slidingDeployer", "priceOracle"].includes(name)) ||
      (configuration.reactive &&
        ["reactiveDeployer", "linkRegistry"].includes(name)) ||
      (sourceVersion >= 2 &&
        configuration.reactive &&
        name === "reactiveValidationChild") ||
      (configuration.peak &&
        [
          "peakDeployer",
          "peakRegistry",
          "beaconDeployer",
          "entangledDeployer",
        ].includes(name)),
  );
  const codes = new Map<string, Hex>(
    names.map((name, index) => [
      components[name].toLowerCase(),
      ((sourceVersion === 3 &&
      ["factory", "reactiveDeployer", "linkRegistry"].includes(name)
        ? "0x62"
        : sourceVersion >= 2 &&
            ["ruleValidator", "reactiveDeployer"].includes(name)
          ? "0x61"
          : "0x60") +
        index.toString(16).padStart(2, "0") +
        "600000") as Hex,
    ]),
  );
  const hashes = Object.fromEntries(
    names.map((name) => [
      name,
      keccak256(codes.get(components[name].toLowerCase())!),
    ]),
  ) as Record<ProBootstrapComponent, Hex>;
  const quoteCodes = new Map<string, Hex>(
    (quoteAddresses ?? []).map((quote, index) => [
      quote.toLowerCase(),
      ("0x63" + (index + 1).toString(16).padStart(2, "0") + "600000") as Hex,
    ]),
  );
  for (const [quote, code] of quoteCodes) codes.set(quote, code);
  const manifest = {
    schema: PRO_BOOTSTRAP_SOURCE_SCHEMA,
    version: sourceVersion,
    reviewId: "reviewed-bootstrap-fixture-v" + sourceVersion,
    chainId: 143n,
    factory,
    configuration: { ...configuration },
    ...(quoteAddresses
      ? {
          quotes: quoteAddresses.map((quote) => ({
            address: quote,
            runtimeCodeHash: keccak256(quoteCodes.get(quote.toLowerCase())!),
          })),
        }
      : {}),
    artifacts: Object.fromEntries(
      names.map((name) => [
        name,
        {
          artifact: proBootstrapComponentArtifact(name, sourceVersion),
          address: components[name],
          runtimeCodeHash: hashes[name],
        },
      ]),
    ),
  } as ProBootstrapSourceManifest;
  const values = new Map<string, unknown>();
  const key = (target: Address, name: string, args: readonly unknown[] = []) =>
    target.toLowerCase() +
    ":" +
    name +
    ":" +
    args.map((arg) => String(arg).toLowerCase()).join(",");
  const set = (
    target: Address,
    name: string,
    value: unknown,
    args: readonly unknown[] = [],
  ) => values.set(key(target, name, args), value);
  set(factory, "proTokenVersion", 1n);
  set(factory, "deploymentReady", true);
  set(factory, "owner", owner);
  if (quoteAddresses) {
    set(factory, "quoteAllowlistVersion", 1n);
    set(factory, "approvedQuoteCount", BigInt(quoteAddresses.length));
    set(factory, "approvedQuotes", true, [zeroAddress]);
    set(factory, "approvedQuoteCodeHash", zeroHash, [zeroAddress]);
    for (const [index, quote] of quoteAddresses.entries()) {
      set(factory, "approvedQuotes", true, [quote]);
      set(
        factory,
        "approvedQuoteCodeHash",
        keccak256(quoteCodes.get(quote.toLowerCase())!),
        [quote],
      );
      set(factory, "approvedQuoteAt", quote, [BigInt(index)]);
      set(factory, "isSystemAddress", false, [quote]);
    }
  }
  set(
    factory,
    "supportedRules",
    ((1n << 23n) - 1n) &
      ~(configuration.price ? 0n : 1n << 4n) &
      ~(configuration.reactive ? 0n : 1n << 20n) &
      ~(configuration.peak ? 0n : (1n << 21n) | (1n << 22n)),
  );
  for (const name of [
    "partnerRegistry",
    "marketCalendar",
    "ruleValidator",
    "tokenDeployer",
    "policyDeployer",
    "curveDeployer",
    "router",
    "vestingDeployer",
  ] as const)
    set(factory, name, components[name]);
  for (const name of names)
    set(factory, "isSystemAddress", true, [components[name]]);
  set(components.partnerRegistry, "factory", factory);
  set(components.partnerRegistry, "registryVersion", 1n);
  set(components.marketCalendar, "calendarVersion", 2n);
  set(components.ruleValidator, "proTokenVersion", 1n);
  set(components.ruleValidator, "supportedRules", (1n << 23n) - 1n);
  if (sourceVersion >= 2) {
    set(
      components.ruleValidator,
      "REACTIVE_VALIDATION_CODE_HASH",
      hashes.reactiveValidationChild ?? keccak256("0x6012600000"),
    );
    if (configuration.reactive) {
      set(
        components.reactiveDeployer,
        "validationChild",
        components.reactiveValidationChild,
      );
      set(
        components.ruleValidator,
        "reactiveValidationChild",
        components.reactiveValidationChild,
        [components.reactiveDeployer],
      );
      set(components.reactiveValidationChild, "validationVersion", 1n);
    }
  }
  if (sourceVersion === 3) {
    set(factory, "reactiveParticipantVersion", 2n);
    if (configuration.reactive) {
      set(components.reactiveDeployer, "reactiveConsentVersion", 2n);
      set(components.linkRegistry, "reactiveConsentVersion", 2n);
    }
  }
  set(components.curveDeployer, "vaultDeployer", components.vaultDeployer);
  set(components.curveDeployer, "vestingDeployer", components.vestingDeployer);
  set(components.vaultDeployer, "curveDeployer", components.curveDeployer);
  set(
    components.vestingDeployer,
    "componentDeployer",
    components.curveDeployer,
  );
  for (const name of [
    "tokenDeployer",
    "policyDeployer",
    "curveDeployer",
    "router",
    "vaultDeployer",
    "vestingDeployer",
  ] as const) {
    set(components[name], "factory", factory);
    set(components[name], "proTokenVersion", 1n);
  }
  set(components.router, "authority", routerAuthority);
  for (const [name, kind] of [
    ["tokenDeployer", 1n],
    ["policyDeployer", 2n],
    ["curveDeployer", 3n],
    ["vestingDeployer", 5n],
    ["slidingDeployer", 4n],
    ["reactiveDeployer", 6n],
    ["peakDeployer", 7n],
  ] as const)
    set(components[name], "deployerKind", kind);
  const groups = {
    price: ["slidingDeployer", "priceOracle"],
    reactive: ["reactiveDeployer", "linkRegistry"],
    peak: ["peakDeployer", "peakRegistry"],
  } as const;
  for (const [group, roles] of Object.entries(groups)) {
    const enabled = configuration[group as keyof ProBootstrapConfiguration];
    set(
      factory,
      group === "price"
        ? "priceInfrastructureConfigured"
        : group === "reactive"
          ? "reactiveInfrastructureConfigured"
          : "peakInfrastructureConfigured",
      enabled,
    );
    for (const name of roles) {
      set(factory, name, enabled ? components[name] : zeroAddress);
      set(factory, name + "CodeHash", enabled ? hashes[name] : zeroHash);
    }
  }
  set(factory, "priceUpdater", configuration.price ? updater : zeroAddress);
  set(factory, "priceMaxAgeSeconds", configuration.price ? 300 : 0);
  if (configuration.price) {
    set(components.slidingDeployer, "factory", factory);
    set(components.slidingDeployer, "proTokenVersion", 1n);
    set(components.priceOracle, "oracleVersion", 1n);
    set(components.priceOracle, "updater", updater);
    set(components.priceOracle, "maxAgeSeconds", 300);
  }
  if (configuration.reactive) {
    set(components.reactiveDeployer, "factory", factory);
    set(components.reactiveDeployer, "proTokenVersion", 1n);
    set(components.reactiveDeployer, "linkRegistry", components.linkRegistry);
    set(
      components.reactiveDeployer,
      "activityRegistry",
      components.partnerRegistry,
    );
    set(components.linkRegistry, "factory", factory);
    set(components.linkRegistry, "deployer", components.reactiveDeployer);
    set(
      components.linkRegistry,
      "activityRegistry",
      components.partnerRegistry,
    );
    set(components.linkRegistry, "linkRegistryVersion", 1n);
  }
  if (configuration.peak) {
    set(components.peakDeployer, "factory", factory);
    set(components.peakDeployer, "proTokenVersion", 1n);
    set(components.peakDeployer, "peakRegistry", components.peakRegistry);
    set(components.peakDeployer, "infrastructureAvailable", true, [
      components.partnerRegistry,
    ]);
    set(components.peakRegistry, "factory", factory);
    set(components.peakRegistry, "registryVersion", 1n);
    set(components.peakRegistry, "deployer", components.peakDeployer);
    set(
      components.peakRegistry,
      "activityRegistry",
      components.partnerRegistry,
    );
    set(components.peakRegistry, "oracle", components.priceOracle);
    set(components.peakRegistry, "oracleCodeHash", hashes.priceOracle);
    set(
      components.peakRegistry,
      "activityRegistryCodeHash",
      hashes.partnerRegistry,
    );
    set(components.peakRegistry, "oracleUpdater", updater);
    set(components.peakRegistry, "oracleMaxAgeSeconds", 300);
    for (const [name, rule] of [
      ["beaconDeployer", 22],
      ["entangledDeployer", 21],
    ] as const) {
      set(components.peakDeployer, name, components[name]);
      set(components.peakDeployer, name + "CodeHash", hashes[name]);
      set(components[name], "peakDeployer", components.peakDeployer);
      set(components[name], "proTokenVersion", 1n);
      set(components[name], "moduleRule", rule);
    }
  }
  const requests: { method: string; params: readonly unknown[] }[] = [];
  const control = {
    blockReads: 0,
    chainReads: 0,
    firstChain: "0x8f",
    finalChain: "0x8f",
    firstHash: blockHash,
    finalHash: blockHash,
    firstNumber: "0x7b",
    finalNumber: "0x7b",
    firstTimestamp: "0x3e8",
    finalTimestamp: "0x3e8",
    rejectCanonical: false,
    beforeRead: undefined as (() => void) | undefined,
    absentSelectorResponse: undefined as (() => unknown) | undefined,
  };
  const client = createPublicClient({
    transport: custom(
      {
        async request({
          method,
          params,
        }: {
          method: string;
          params?: readonly unknown[];
        }) {
          const input = params ?? [];
          requests.push({ method, params: input });
          control.beforeRead?.();
          if (method === "eth_chainId")
            return ++control.chainReads === 1
              ? control.firstChain
              : control.finalChain;
          if (method === "eth_blockNumber") return "0x7b";
          if (method === "eth_getBlockByNumber") {
            if (input[0] !== numberToHex(123n))
              throw new Error("Unexpected block selection.");
            const first = ++control.blockReads === 1;
            return {
              number: first ? control.firstNumber : control.finalNumber,
              hash: first ? control.firstHash : control.finalHash,
              timestamp: first
                ? control.firstTimestamp
                : control.finalTimestamp,
            };
          }
          if (method === "eth_call" || method === "eth_getCode") {
            if (control.rejectCanonical)
              throw new Error("Canonical EIP-1898 unsupported.");
            const pinned = input[1] as {
              blockHash?: Hex;
              requireCanonical?: boolean;
            };
            if (
              pinned.blockHash !== blockHash ||
              pinned.requireCanonical !== true
            )
              throw new Error("Noncanonical source read.");
            if (method === "eth_getCode")
              return codes.get(String(input[0]).toLowerCase()) ?? "0x";
            const call = input[0] as { to: Address; data: Hex };
            const decoded = decodeFunctionData({
              abi: proBootstrapAbi,
              data: call.data,
            });
            const id = key(call.to, decoded.functionName, decoded.args ?? []);
            if (!values.has(id)) {
              if (
                control.absentSelectorResponse &&
                [
                  "REACTIVE_VALIDATION_CODE_HASH",
                  "validationChild",
                  "reactiveParticipantVersion",
                  "reactiveConsentVersion",
                ].includes(decoded.functionName)
              )
                return control.absentSelectorResponse();
              if (sourceVersion < 3)
                throwLegacyBootstrapSelectorRevert(
                  call.to,
                  decoded.functionName,
                  components,
                );
              throw new Error("Unexpected bootstrap getter " + id);
            }
            return encodeFunctionResult({
              abi: proBootstrapAbi,
              functionName: decoded.functionName,
              result: values.get(id) as never,
            } as never);
          }
          throw new Error("Unexpected bootstrap RPC " + method);
        },
      },
      { retryCount: 0 },
    ),
  });
  return {
    client,
    factory,
    owner,
    routerAuthority,
    updater,
    components,
    manifest,
    codes,
    hashes,
    values,
    set,
    control,
    requests,
    blockHash,
    otherHash,
  };
}
