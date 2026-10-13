import { bootstrapFixture } from "../vendor/xoox-sdk/test/pro-bootstrap-fixture";
import { proFactoryAbi } from "../vendor/xoox-sdk/pro-token";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  parseProConsentIndexerSources,
  proConsentIndexerAbi,
  PRO_CONSENT_INDEXER_SOURCE_SCHEMA,
} from "../pro-consent-source";
const address = (n: number) =>
  getAddress(`0x${n.toString(16).padStart(40, "0")}`);
export const consentHash = (n: number) =>
  `0x${n.toString(16).padStart(64, "0")}` as Hex;
export function consentIndexerFixture(
  version: 1 | 2 | 3 = 3,
  sameCreator = false,
) {
  const base = bootstrapFixture(
    { price: false, reactive: true, peak: false },
    version,
  );
  const registry = base.components.linkRegistry,
    helper = base.components.reactiveDeployer;
  const tokens = [address(0x7001), address(0x7002)] as const;
  const creators = [
    address(0x7101),
    address(sameCreator ? 0x7101 : 0x7102),
  ] as const;
  const curves = [address(0x7201), address(0x7202)] as const;
  const policies = [address(0x7301), address(0x7302)] as const;
  const salts = [consentHash(101), consentHash(102)] as const;
  const ids = creators.map((creator, role) =>
    keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "bytes32,uint256,address,address,uint256,address,bytes32,uint8",
        ),
        [
          keccak256(stringToHex("XOOX_PRO_REACTIVE_PARTICIPANT_V2")),
          143n,
          base.factory,
          registry,
          2n,
          creator,
          salts[role]!,
          role,
        ],
      ),
    ),
  ) as [Hex, Hex];
  const rules = ids.map((id, role) =>
    encodeAbiParameters(parseAbiParameters("bytes32,uint8,uint32,uint32"), [
      id,
      role,
      10_000,
      50_000,
    ]),
  );
  const supply = 1_000_000n * 10n ** 18n;
  const launches = tokens.map((token, role) => {
    const metadata = {
      name: `Consent ${role}`,
      symbol: `C${role}`,
      description: "Pending creator consent",
      image: "https://example.com/image.png",
      website: "",
      twitter: "",
      telegram: "",
    };
    const curveConfig = {
      quoteAsset: zeroAddress,
      phantomQuote: 100n * 10n ** 18n,
      graduationThreshold: 0n,
      baseFeeBps: 0,
      buyTaxBps: 0,
      sellTaxBps: 0,
      perpetual: true,
      feeRecipient: creators[role]!,
    };
    const deadline = 1500n,
      requestedSalt = consentHash(201 + role);
    const rule = [{ rule: 20, data: rules[role]! }];
    const data = encodeFunctionData({
      abi: proFactoryAbi,
      functionName: "createLaunch",
      args: [metadata, supply, curveConfig, rule, [], requestedSalt, deadline],
    });
    const configurationHash = keccak256(`0x${data.slice(10)}`);
    const launchSalt = keccak256(
      encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"), [
        creators[role]!,
        requestedSalt,
        configurationHash,
      ]),
    );
    return {
      creator: creators[role]!,
      token,
      curveAddress: curves[role]!,
      policy: policies[role]!,
      supply,
      metadata,
      curveConfig: {
        ...curveConfig,
        baseFeeBps: 0n,
        buyTaxBps: 0n,
        sellTaxBps: 0n,
      },
      rules: [{ rule: 20n, data: rules[role]! }],
      walletExemptions: [] as Address[],
      requestedSalt,
      deadline,
      configurationHash,
      launchSalt,
    };
  });
  const finalPairId = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32,uint256,address,address,uint256,bytes32,bytes32,address,address,bytes32,bytes32",
      ),
      [
        keccak256(stringToHex("XOOX_PRO_REACTIVE_CONSENT_PAIR_V2")),
        143n,
        base.factory,
        registry,
        2n,
        ids[0],
        ids[1],
        tokens[0],
        tokens[1],
        launches[0]!.configurationHash,
        launches[1]!.configurationHash,
      ],
    ),
  );
  const zeroHash = consentHash(0);
  const participants = tokens.map((token, role) => ({
    creator: creators[role]!,
    token,
    configurationHash: launches[role]!.configurationHash,
    role,
    nonce: 0n,
    partnerId: zeroHash,
    finalPairId: zeroHash,
    finalized: false,
  }));
  const pair = {
    participantId0: ids[0],
    participantId1: ids[1],
    token0: tokens[0],
    token1: tokens[1],
    configurationHash0: launches[0]!.configurationHash,
    configurationHash1: launches[1]!.configurationHash,
    creator0: creators[0],
    creator1: creators[1],
  };
  const values = new Map<string, unknown>();
  const key = (to: string, name: string, args: readonly unknown[] = []) =>
    `${to.toLowerCase()}:${name}:${JSON.stringify(args)}`;
  const set = (
    to: string,
    name: string,
    result: unknown,
    args: readonly unknown[] = [],
  ) => values.set(key(to, name, args), result);
  for (const role of [0, 1] as const) {
    set(registry, "participant", participants[role], [ids[role]]);
    set(registry, "participantOfToken", ids[role], [tokens[role]]);
    set(registry, "linkOfToken", zeroHash, [tokens[role]]);
    set(registry, "finalPairIdOfParticipant", zeroHash, [ids[role]]);
    set(base.factory, "curveOf", curves[role], [tokens[role]]);
    set(base.factory, "policyOf", policies[role], [tokens[role]]);
    set(base.factory, "creatorOf", creators[role], [tokens[role]]);
    set(base.factory, "configurationHash", launches[role]!.configurationHash, [
      tokens[role],
    ]);
    set(policies[role], "ruleData", rules[role], [20]);
  }
  set(registry, "finalPair", pair, [finalPairId]);
  set(registry, "deriveFinalPairId", finalPairId, ids);
  const calls: { method: string; params?: readonly unknown[] }[] = [];
  const control = {
    malformed: false,
    before: undefined as ((method: string) => void) | undefined,
  };
  const client = createPublicClient({
    transport: custom(
      {
        async request({ method, params }) {
          calls.push({ method, params });
          control.before?.(method);
          if (method === "eth_call") {
            const [call, selector] = params as readonly [
              { to: Address; data: Hex },
              { blockHash: Hex; requireCanonical: boolean },
            ];
            try {
              const decoded = decodeFunctionData({
                abi: proConsentIndexerAbi,
                data: call.data,
              });
              const id = key(call.to, decoded.functionName, decoded.args ?? []);
              if (values.has(id)) {
                if (
                  selector.blockHash !== base.blockHash ||
                  selector.requireCanonical !== true
                )
                  throw new Error("Noncanonical consent read.");
                const encoded = encodeFunctionResult({
                  abi: proConsentIndexerAbi,
                  functionName: decoded.functionName,
                  result: values.get(id),
                } as never);
                return control.malformed ? `${encoded}00` : encoded;
              }
            } catch (error) {
              if ((error as Error).message === "Noncanonical consent read.")
                throw error;
            }
          }
          return base.client.request({ method, params } as never);
        },
      },
      { retryCount: 0 },
    ),
  });
  const raw = () =>
    JSON.parse(
      JSON.stringify(
        {
          schema: PRO_CONSENT_INDEXER_SOURCE_SCHEMA,
          version: 1,
          sources: [
            {
              chainId: "143",
              factory: base.factory,
              helper,
              registry,
              bootstrapManifest: base.manifest,
            },
          ],
        },
        (_, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    );
  const source = () => parseProConsentIndexerSources(raw())[0]!;
  const input = (participantIds: readonly Hex[] = [ids[0]]) => ({
    registry,
    blockNumber: 123n,
    blockHash: base.blockHash,
    timestamp: 1000n,
    participantIds,
  });
  function finalize(
    nonce0 = participants[0]!.nonce,
    nonce1 = participants[1]!.nonce,
  ) {
    for (const role of [0, 1] as const) {
      Object.assign(participants[role]!, {
        nonce: (role === 0 ? nonce0 : nonce1) + 1n,
        finalized: true,
        partnerId: ids[1 - role],
        finalPairId,
      });
      set(registry, "linkOfToken", ids[role], [tokens[role]]);
      set(registry, "finalPairIdOfParticipant", finalPairId, [ids[role]]);
    }
  }
  return {
    base,
    client,
    control,
    calls,
    values,
    set,
    key,
    raw,
    source,
    input,
    factory: base.factory,
    helper,
    registry,
    tokens,
    creators,
    curves,
    policies,
    salts,
    ids,
    rules,
    launches,
    participants,
    pair,
    finalPairId,
    finalize,
  };
}
