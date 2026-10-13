import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  loadProPoolRouterSource,
  readProPoolRouterSource,
} from "./pro-pool-router-source";

const address = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as Address;
const factory = address(1),
  registry = address(2),
  router = address(3);
const blockHash = `0x${"ab".repeat(32)}` as Hex;
const input = {
  factory,
  registry,
  router,
  blockNumber: 5n,
  blockHash,
  timestamp: 100n,
};
const abi = parseAbi([
  "function factory() view returns(address)",
  "function registry() view returns(address)",
  "function graduationRegistry() view returns(address)",
  "function partnerRegistry() view returns(address)",
  "function poolManager() view returns(address)",
  "function hook() view returns(address)",
  "function executor() view returns(address)",
  "function verifier() view returns(address)",
  "function proTokenVersion() view returns(uint256)",
]);
function fixture() {
  const calls: { method: string; params: unknown }[] = [];
  const values = new Map<string, unknown>([
    [`${router}:factory`, factory],
    [`${router}:registry`, registry],
    [`${registry}:factory`, factory],
    [`${factory}:graduationRegistry`, registry],
    ...(
      [
        "partnerRegistry",
        "poolManager",
        "hook",
        "executor",
        "verifier",
      ] as const
    ).map(
      (name, i) => [`${router}:${name}`, address(i + 4)] as [string, unknown],
    ),
    ...[router, registry, factory].map(
      (target) => [`${target}:proTokenVersion`, 1n] as [string, unknown],
    ),
  ]);
  const state = {
    hash: blockHash,
    chain: 143,
    timestamp: 100n,
    code: "0x6000",
    malformed: false,
    fail: false,
    before: undefined as ((method: string) => void) | undefined,
  };
  const client = createPublicClient({
    transport: custom(
      {
        async request({ method, params }) {
          calls.push({ method, params });
          state.before?.(method);
          if (state.fail) throw new Error("archive unavailable");
          if (method === "eth_chainId") return toHex(state.chain);
          if (method === "eth_getBlockByNumber")
            return {
              number: "0x5",
              hash: state.hash,
              timestamp: toHex(state.timestamp),
            };
          if (method === "eth_getCode") return state.code;
          if (method === "eth_call") {
            const [{ to, data }] = params as readonly [
              { to: Address; data: Hex },
              unknown,
            ];
            const { functionName } = decodeFunctionData({ abi, data });
            const value = values.get(`${to.toLowerCase()}:${functionName}`);
            if (value === undefined) throw new Error("unexpected getter");
            const encoded = encodeFunctionResult({
              abi,
              functionName,
              result: value,
            } as never);
            return state.malformed ? `${encoded}00` : encoded;
          }
          throw new Error(`unsupported method ${method}`);
        },
      },
      { retryCount: 0 },
    ),
  });
  return { client, state, values, calls };
}

describe("Pro subscribed Router canonical source binding", () => {
  it("binds trusted Router/Registry/Factory reciprocally and pins every wire read to the event block", async () => {
    const f = fixture();
    const result = await readProPoolRouterSource(f.client, 143, input);
    expect(result).toEqual({
      factory,
      registry,
      infrastructure: Array.from({ length: 8 }, (_, i) =>
        address(i < 3 ? [3, 1, 2][i]! : i + 1),
      ),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.infrastructure)).toBe(true);
    for (const call of f.calls.filter((c) =>
      ["eth_call", "eth_getCode"].includes(c.method),
    ))
      expect((call.params as unknown[])[1]).toEqual({
        blockHash,
        requireCanonical: true,
      });
  });
  it.each([
    [`${router}:factory`, address(20)],
    [`${router}:registry`, address(20)],
    [`${registry}:factory`, address(20)],
    [`${factory}:graduationRegistry`, address(20)],
  ])("rejects reciprocal mismatch %s", async (key, value) => {
    const f = fixture();
    f.values.set(key, value);
    await expect(readProPoolRouterSource(f.client, 143, input)).rejects.toThrow(
      "binding differs",
    );
  });
  it.each([router, registry, factory])(
    "rejects unsupported source version %s",
    async (target) => {
      const f = fixture();
      f.values.set(`${target}:proTokenVersion`, 2n);
      await expect(
        readProPoolRouterSource(f.client, 143, input),
      ).rejects.toThrow("runtime/version");
    },
  );
  it.each(["0x", "0x1", "garbage"])(
    "rejects missing or malformed source runtime %s",
    async (code) => {
      const f = fixture();
      f.state.code = code;
      await expect(
        readProPoolRouterSource(f.client, 143, input),
      ).rejects.toThrow("runtime/version");
    },
  );
  it("rejects zero or aliased infrastructure getter identities", async () => {
    const f = fixture();
    f.values.set(`${router}:hook`, zeroAddress);
    await expect(readProPoolRouterSource(f.client, 143, input)).rejects.toThrow(
      "nonzero",
    );
    f.values.set(`${router}:hook`, factory);
    await expect(readProPoolRouterSource(f.client, 143, input)).rejects.toThrow(
      "overlap",
    );
  });
  it("rejects trailing noncanonical ABI bytes", async () => {
    const f = fixture();
    f.state.malformed = true;
    await expect(readProPoolRouterSource(f.client, 143, input)).rejects.toThrow(
      "noncanonical getter",
    );
  });
  it.each(["chain", "hash", "time"])(
    "rejects original event %s mismatch",
    async (mismatch) => {
      const f = fixture();
      if (mismatch === "chain") f.state.chain = 31337;
      else if (mismatch === "hash") f.state.hash = `0x${"cd".repeat(32)}`;
      else f.state.timestamp++;
      await expect(
        readProPoolRouterSource(f.client, 143, input),
      ).rejects.toThrow("canonical");
    },
  );
  it("rechecks the original header after getter acquisition", async () => {
    const f = fixture();
    let blocks = 0;
    f.state.before = (method) => {
      if (method === "eth_getBlockByNumber" && ++blocks === 2)
        f.state.hash = `0x${"cd".repeat(32)}`;
    };
    await expect(readProPoolRouterSource(f.client, 143, input)).rejects.toThrow(
      "canonical",
    );
  });
  it("captures the original event before async reads", async () => {
    const f = fixture();
    const value = { ...input };
    f.state.before = () => {
      value.factory = address(20);
      value.blockHash = `0x${"cd".repeat(32)}`;
      value.blockNumber = 6n;
    };
    expect((await readProPoolRouterSource(f.client, 143, value)).factory).toBe(
      factory,
    );
  });
  it("rejects unavailable archive reads without latest fallback", async () => {
    const f = fixture();
    f.state.fail = true;
    await expect(readProPoolRouterSource(f.client, 143, input)).rejects.toThrow(
      "archive unavailable",
    );
    expect(f.calls.some((c) => c.method === "eth_call")).toBe(false);
  });
});

describe("operator source loader fail closed", () => {
  let directory: string | undefined;
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });
  async function config(value: unknown) {
    directory = await mkdtemp(join(tmpdir(), "xoox-pro-indexer-"));
    const path = join(directory, "config.yaml");
    await writeFile(path, JSON.stringify(value));
    vi.stubEnv("ENVIO_CONFIG", path);
  }
  const chain = {
    id: 143,
    rpc: [{ url: "http://127.0.0.1:1" }],
    contracts: [
      { name: "ProFactory", address: [factory] },
      { name: "ProSwapRouter", address: [router] },
    ],
  };
  it.each([
    { chains: [] },
    { chains: [{ ...chain, id: 31337 }] },
    { chains: [chain, chain] },
    {
      chains: [
        { ...chain, contracts: [{ name: "ProFactory", address: [factory] }] },
      ],
    },
    {
      chains: [
        {
          ...chain,
          contracts: [
            { name: "ProFactory", address: [address(20)] },
            { name: "ProSwapRouter", address: [router] },
          ],
        },
      ],
    },
    {
      chains: [
        {
          ...chain,
          contracts: [
            { name: "ProFactory", address: [factory] },
            { name: "ProSwapRouter", address: [address(20)] },
          ],
        },
      ],
    },
    { chains: [{ ...chain, rpc: [] }] },
    { chains: [{ ...chain, rpc: [{ url: "file:///tmp/untrusted" }] }] },
  ])(
    "rejects missing/ambiguous chain, unconfigured sources or absent trusted RPC %o",
    async (value) => {
      await config(value);
      await expect(loadProPoolRouterSource(143, input)).rejects.toThrow(
        "Pro pool source",
      );
    },
  );
  it("bounds local operator configuration before parsing", async () => {
    await config("x".repeat(1024 * 1024));
    await expect(loadProPoolRouterSource(143, input)).rejects.toThrow(
      "oversized",
    );
  });
});
