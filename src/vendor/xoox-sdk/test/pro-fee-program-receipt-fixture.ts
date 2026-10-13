// Vendored from the XOOX SDK; only what the indexer uses.
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  keccak256,
  zeroAddress,
  zeroHash,
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { feeProgramBootstrapFixture } from "./pro-fee-program-fixture";
import {
  proBootstrapAbi,
  readProBootstrapInfrastructure,
} from "../pro-bootstrap";
import { proDiscoveryAbi } from "../pro-discovery";
import {
  proFeeProgramLaunchAbi,
  readProFeeProgramLaunch,
} from "../pro-fee-program-launch";
import {
  proFeeProgramConfigHash,
  validateProFeeProgramConfig,
  type ProFeeProgramCycle,
} from "../pro-fee-programs";

/** Synthetic runtime attestations and canonical RPC wire data; not deployment approval. */
export async function feeProgramReceiptFixture(
  moduleId = 1,
  optionalCreator?: Address,
  budget = 100n,
) {
  const f = feeProgramBootstrapFixture();
  const token = getAddress("0x9000000000000000000000000000000000000000"),
    curve = getAddress("0x9100000000000000000000000000000000000000"),
    policy = getAddress("0x9200000000000000000000000000000000000000"),
    creator = getAddress(
      optionalCreator ?? "0x9300000000000000000000000000000000000000",
    ),
    vault = getAddress("0x9400000000000000000000000000000000000000"),
    quote =
      moduleId === 18
        ? zeroAddress
        : getAddress("0x9500000000000000000000000000000000000000"),
    adapter = getAddress("0x9600000000000000000000000000000000000000");
  const launchHash = keccak256("0x5566");
  const configuration = validateProFeeProgramConfig({
    poolFeeBps: 50,
    snapshotMaxAge: 3600,
    programs: [
      {
        moduleId,
        weightBps: 10000,
        intervalSeconds: 60,
        authority: creator,
        recipient: moduleId === 18 ? creator : zeroAddress,
        asset: zeroAddress,
        adapter,
        adapterCodeHash: keccak256("0x60116000"),
        nftCollection: zeroAddress,
        minHolding: 0n,
        maxHolding: 0n,
        count: 0,
        burnBps: moduleId === 18 ? 5000 : 0,
        holderBps: moduleId === 18 ? 2500 : 0,
        maxCreatorBps: 0,
        maxWaitSeconds: 0,
        dailySalary: 0n,
        rulesHash: zeroHash,
        allowedAssets: [],
        recipients: [],
      },
    ],
  });
  const configHash = proFeeProgramConfigHash(configuration);
  const key = (target: Address, name: string, args: readonly unknown[] = []) =>
    target.toLowerCase() +
    ":" +
    name +
    ":" +
    args.map((v) => String(v).toLowerCase()).join(",");
  const fields = (target: Address, values: Record<string, unknown>) =>
    Object.entries(values).forEach(([name, value]) =>
      f.set(target, name, value),
    );
  for (const target of [token, curve, policy, vault])
    f.codes.set(target.toLowerCase(), "0x60006000");
  for (const [name, value] of [
    ["curveOf", curve],
    ["policyOf", policy],
    ["creatorOf", creator],
    ["configurationHash", launchHash],
  ] as const) {
    f.set(f.factory, name, value, [token]);
    f.set(f.components.partnerRegistry, name, value, [token]);
  }
  for (const target of [token, curve, policy])
    f.set(f.factory, "isSystemAddress", true, [target]);
  f.set(f.factory, "isCurve", true, [curve]);
  f.set(f.components.curveDeployer, "isDeployedCurve", true, [curve]);
  f.set(f.components.partnerRegistry, "tokenOf", token, [curve]);
  f.set(f.components.partnerRegistry, "supplyOf", 1000n, [token]);
  fields(token, {
    curve,
    policy,
    totalSupply: 1000n,
    genesisSupply: 1000n,
    cumulativeBurned: 0n,
    feeProgramVersion: 4n,
    programVault: vault,
    decimals: 18,
    name: "Receipt",
    symbol: "RCP",
    description: "",
    image: "https://example.invalid/image",
    website: "",
    twitter: "",
    telegram: "",
  });
  fields(curve, {
    factory: f.factory,
    partnerRegistry: f.components.partnerRegistry,
    router: f.components.router,
    token,
    policy,
    creator,
    totalSupply: 1000n,
    perpetual: true,
    quoteAsset: quote,
    feeRecipient: vault,
    feeProgramVersion: 4n,
  });
  fields(policy, {
    factory: f.factory,
    token,
    curve,
    creator,
    supply: 1000n,
    rulesBitmap: 0n,
  });
  f.set(f.components.router, "programVaultOf", vault, [token]);
  f.set(f.components.programDeployer, "isProgramVault", true, [vault]);
  f.set(f.components.programDeployer, "configurationHashOf", configHash, [
    vault,
  ]);
  fields(vault, {
    factory: f.factory,
    router: f.components.router,
    creator,
    quoteAsset: quote,
    token,
    curve,
    feeProgramVersion: 4n,
    configurationHash: configHash,
    launchConfigurationHash: launchHash,
    factoryCodeHash: f.manifest.artifacts.factory.runtimeCodeHash,
    routerCodeHash: f.manifest.artifacts.router.runtimeCodeHash,
    tokenCodeHash: keccak256("0x60006000"),
    curveCodeHash: keccak256("0x60006000"),
    claimProcessor: f.components.claimProcessor,
    claimProcessorCodeHash: f.manifest.artifacts.claimProcessor!.runtimeCodeHash,
    poolHook: zeroAddress,
    poolHookCodeHash: zeroHash,
    poolFeeBps: 50,
    snapshotMaxAge: 3600,
    programCount: 1n,
    totalCurveFees: 100n,
    totalPoolFees: 0n,
  });
  f.set(vault, "programAt", configuration.programs[0], [0n]);
  for (const [name, value] of [
    ["programBudget", budget],
    ["lastCycle", 0n],
    ["lastCycleAt", 0n],
    ["waitingSince", 800n],
    ["holderCarryQuote", moduleId === 18 ? 40n : 0n],
    ["salaryAvailable", 0n],
  ] as const)
    f.set(vault, name, value, [0n]);
  const receiptHash = keccak256("0x8877"),
    publicationHash = keccak256("0x9988");
  const header2 = { hash: f.otherHash, timestamp: 1100n },
    header3 = { hash: keccak256("0x1122"), timestamp: 100000n };
  const headers = new Map([
    [123n, { hash: f.blockHash, timestamp: 1000n }],
    [124n, header2],
    [125n, header3],
  ]);
  const overrides = new Map<Hex, Map<string, unknown>>([
    [header2.hash, new Map()],
    [header3.hash, new Map()],
  ]);
  const setAt = (
    blockHash: Hex,
    target: Address,
    name: string,
    value: unknown,
    args: readonly unknown[] = [],
  ) => overrides.get(blockHash)!.set(key(target, name, args), value);
  for (const header of [header2, header3]) {
    setAt(header.hash, vault, "lastCycle", 1n, [0n]);
    setAt(header.hash, vault, "lastCycleAt", 1100n, [0n]);
    setAt(header.hash, vault, "programBudget", 10n, [0n]);
    setAt(header.hash, vault, "holderCarryQuote", 0n, [0n]);
  }
  setAt(
    header2.hash,
    vault,
    "rewardRoots",
    [zeroHash, zeroAddress, 83n, 0n, 1000n],
    [0n, 1n],
  );
  setAt(header2.hash, vault, "holderPublicationEvidence", zeroHash, [0n, 1n]);
  const evidence = keccak256("0x1234");
  const cycle: ProFeeProgramCycle = {
    id: 1n,
    observedAt: 1000n,
    deadline: 1200n,
    evidence,
    actions: [
      {
        kind: 2,
        amount: 100n,
        outputAsset: zeroAddress,
        minOut: 80n,
        root: zeroHash,
        beneficiaries: [],
        nftId: 0n,
        data: "0x0102",
      },
    ],
  };
  const transactions = new Map<Hex, Record<string, unknown>>(),
    receipts = new Map<Hex, Record<string, unknown>>();
  const makeTransaction = (hash: Hex, blockNumber: bigint, input: Hex) => {
    const header = headers.get(blockNumber)!;
    const tx = {
      hash,
      blockHash: header.hash,
      blockNumber: `0x${blockNumber.toString(16)}`,
      transactionIndex: "0x0",
      from: creator,
      to: vault,
      value: "0x0",
      input,
      nonce: "0x1",
      gas: "0xffffff",
      gasPrice: "0x1",
      type: "0x0",
      v: "0x141",
      r: zeroHash,
      s: zeroHash,
      chainId: "0x8f",
    };
    transactions.set(hash, tx);
    const receipt = {
      transactionHash: hash,
      blockHash: header.hash,
      blockNumber: tx.blockNumber,
      transactionIndex: "0x0",
      from: creator,
      to: vault,
      status: "0x1",
      gasUsed: "0x100",
      cumulativeGasUsed: "0x100",
      effectiveGasPrice: "0x1",
      logsBloom: `0x${"00".repeat(256)}`,
      type: "0x0",
      contractAddress: null,
      logs: [] as Record<string, unknown>[],
    };
    receipts.set(hash, receipt);
    return receipt;
  };
  const event = (
    hash: Hex,
    blockNumber: bigint,
    name: string,
    args: Record<string, unknown>,
    index: number,
  ) => {
    const abiItem = getAbiItem({
      abi: proFeeProgramLaunchAbi as Abi,
      name,
    }) as AbiEvent;
    return {
      address: vault,
      blockHash: headers.get(blockNumber)!.hash,
      blockNumber: `0x${blockNumber.toString(16)}`,
      transactionHash: hash,
      transactionIndex: "0x0",
      logIndex: `0x${index.toString(16)}`,
      removed: false,
      topics: encodeEventTopics({
        abi: [abiItem],
        eventName: name,
        args,
      } as never),
      data: encodeAbiParameters(
        abiItem.inputs.filter((field) => !field.indexed),
        abiItem.inputs
          .filter((field) => !field.indexed)
          .map((field) => args[field.name!]) as never,
      ),
    };
  };
  const receipt = makeTransaction(
    receiptHash,
    124n,
    encodeFunctionData({
      abi: proFeeProgramLaunchAbi,
      functionName: "execute",
      args: [0n, cycle],
    }),
  );
  receipt.logs.push(
    event(
      receiptHash,
      124n,
      "HolderFundsReserved",
      {
        program: 0n,
        cycle: 1n,
        asset: zeroAddress,
        reserved: 83n,
        observedAt: 1000n,
      },
      0,
    ),
    event(
      receiptHash,
      124n,
      "ActionExecuted",
      {
        program: 0n,
        cycle: 1n,
        kind: 2,
        asset: zeroAddress,
        spent: 90n,
        received: 83n,
      },
      1,
    ),
    event(
      receiptHash,
      124n,
      "CycleExecuted",
      { program: 0n, cycle: 1n, evidence, spent: 90n, remaining: 10n },
      2,
    ),
  );
  const abi = [
    ...proBootstrapAbi,
    ...proDiscoveryAbi,
    ...proFeeProgramLaunchAbi,
  ] as Abi;
  const client = createPublicClient({
    transport: custom(
      {
        async request({ method, params }) {
          const args = params as readonly unknown[];
          if (method === "eth_chainId") return "0x8f";
          if (method === "eth_blockNumber") return "0x7b";
          if (method === "eth_getBlockByNumber") {
            const number = BigInt(String(args[0])),
              header = headers.get(number)!;
            return {
              number: args[0],
              hash: header.hash,
              timestamp: `0x${header.timestamp.toString(16)}`,
              transactions: [],
            };
          }
          if (method === "eth_getTransactionByHash")
            return transactions.get(args[0] as Hex);
          if (method === "eth_getTransactionReceipt")
            return receipts.get(args[0] as Hex);
          if (method === "eth_call" || method === "eth_getCode") {
            const pin = args[1] as {
              blockHash: Hex;
              requireCanonical: boolean;
            };
            if (
              !pin.requireCanonical ||
              ![...headers.values()].some(
                (header) => header.hash === pin.blockHash,
              )
            )
              throw new Error("Canonical block required");
            if (method === "eth_getCode")
              return f.codes.get(String(args[0]).toLowerCase()) ?? "0x";
            const call = args[0] as { to: Address; data: Hex },
              decoded = decodeFunctionData({ abi, data: call.data });
            const id = key(call.to, decoded.functionName, decoded.args ?? []),
              map = overrides.get(pin.blockHash);
            const result = map?.has(id) ? map.get(id) : f.values.get(id);
            if (result === undefined)
              throw new Error("Missing fixture getter " + id);
            return encodeFunctionResult({
              abi,
              functionName: decoded.functionName,
              result,
            } as never);
          }
          throw new Error("Unsupported fixture RPC " + method);
        },
      },
      { retryCount: 0 },
    ),
  });
  const source = await readProBootstrapInfrastructure(
      client,
      f.factory,
      f.manifest,
    ),
    launch = await readProFeeProgramLaunch(client, source, token);
  return {
    ...f,
    client,
    launch,
    token,
    curve,
    policy,
    creator,
    vault,
    quote,
    configuration,
    cycle,
    receiptHash,
    publicationHash,
    receipt,
    transactions,
    receipts,
    headers,
    overrides,
    setAt,
    event,
    makeTransaction,
    header2,
    header3,
  };
}
