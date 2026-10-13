import { describe, expect, it, vi } from "vitest";
import {
  blocksCovered,
  buildQuery,
  estimateBackfill,
  formatDuration,
  parseRateLimitHeaders,
  readConfig,
  runEstimate,
} from "./backfill-estimator";

const TOKEN = "tok-3f9a1c-do-not-print";
const ADDRESS = "0x79ad9653c42f8fec1e8191b15288861cedcba3f7";
const TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

describe("rate limit headers", () => {
  it("reads limit, remaining, reset and cost case-insensitively", () => {
    const headers = new Headers({
      "X-RateLimit-Limit": "100",
      "x-ratelimit-remaining": "88",
      "x-ratelimit-reset": "41",
      "x-ratelimit-cost": "12",
    });
    expect(parseRateLimitHeaders(headers)).toEqual({
      limit: 100,
      remaining: 88,
      reset: 41,
      cost: 12,
    });
  });

  it("names the missing or malformed headers", () => {
    expect(() =>
      parseRateLimitHeaders(new Headers({ "x-ratelimit-limit": "100" })),
    ).toThrow(/x-ratelimit-remaining.*x-ratelimit-reset.*x-ratelimit-cost/);
    expect(() =>
      parseRateLimitHeaders(
        new Headers({
          "x-ratelimit-limit": "abc",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-reset": "1",
          "x-ratelimit-cost": "1",
        }),
      ),
    ).toThrow(/x-ratelimit-limit/);
  });
});

describe("blocks covered", () => {
  it("uses next_block when the response stopped early", () => {
    expect(
      blocksCovered({ fromBlock: 1000, toBlock: 101_000, nextBlock: 51_000 }),
    ).toBe(50_000);
    expect(
      blocksCovered({ fromBlock: 1000, toBlock: 101_000, nextBlock: 101_000 }),
    ).toBe(100_000);
    expect(
      blocksCovered({ fromBlock: 1000, toBlock: 101_000, nextBlock: 200_000 }),
    ).toBe(100_000);
    expect(blocksCovered({ fromBlock: 1000, toBlock: 101_000 })).toBe(100_000);
  });

  it("refuses a response that made no progress", () => {
    expect(() =>
      blocksCovered({ fromBlock: 1000, toBlock: 101_000, nextBlock: 1000 }),
    ).toThrow(/progress/);
  });
});

describe("backfill estimate", () => {
  const samples = [
    {
      label: "static set",
      fromBlock: 69_000_000,
      toBlock: 69_100_000,
      nextBlock: 69_100_000,
      cost: 40,
      elapsedMs: 800,
    },
    {
      label: "v4 swaps",
      fromBlock: 69_000_000,
      toBlock: 69_100_000,
      nextBlock: 69_050_000,
      cost: 10,
      elapsedMs: 400,
      coverage: 0.5,
    },
  ];

  it("extrapolates cost per block over the whole range and divides by the per-window budget", () => {
    const estimate = estimateBackfill(samples, {
      startBlock: 61_000_000,
      headBlock: 70_000_000,
      limit: 100,
      windowSeconds: 60,
    });
    expect(estimate.totalBlocks).toBe(9_000_000);
    expect(estimate.totalCost).toBeCloseTo(4500, 6);
    expect(estimate.totalQueries).toBe(180);
    expect(estimate.windows).toBeCloseTo(45, 6);
    expect(estimate.rateBoundSeconds).toBeCloseTo(2700, 6);
    expect(estimate.latencyBoundSeconds).toBeCloseTo(108, 6);
    expect(estimate.estimateSeconds).toBeCloseTo(2700, 6);
    expect(
      estimate.perSample.map((sample) => sample.costPer100kBlocks),
    ).toEqual([40, 20]);
  });

  it("lets request latency dominate when the budget is generous, and concurrency shortens it", () => {
    const options = {
      startBlock: 61_000_000,
      headBlock: 70_000_000,
      limit: 1_000_000,
      windowSeconds: 60,
    };
    expect(estimateBackfill(samples, options).estimateSeconds).toBeCloseTo(
      108,
      6,
    );
    expect(
      estimateBackfill(samples, { ...options, concurrency: 4 }).estimateSeconds,
    ).toBeCloseTo(27, 6);
  });

  it("refuses unusable input", () => {
    const options = {
      startBlock: 61_000_000,
      headBlock: 70_000_000,
      limit: 100,
      windowSeconds: 60,
    };
    expect(() => estimateBackfill([], options)).toThrow(/sample/);
    expect(() =>
      estimateBackfill(samples, { ...options, headBlock: 61_000_000 }),
    ).toThrow(/head/);
    expect(() => estimateBackfill(samples, { ...options, limit: 0 })).toThrow(
      /limit/,
    );
    expect(() =>
      estimateBackfill(
        [{ ...(samples[0] as object), cost: 0 }] as never,
        options,
      ),
    ).toThrow(/cost/);
  });

  it("formats durations", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(2700)).toBe("45m 00s");
    expect(formatDuration(7380)).toBe("2h 03m");
  });
});

describe("query body", () => {
  it("selects one log field over [from, from + blocks) for the given addresses and topics", () => {
    expect(
      buildQuery({
        fromBlock: 69_000_000,
        blocks: 100_000,
        addresses: [ADDRESS],
        topics: [[TOPIC]],
      }),
    ).toEqual({
      from_block: 69_000_000,
      to_block: 69_100_000,
      logs: [{ address: [ADDRESS], topics: [[TOPIC]] }],
      field_selection: { log: ["block_number"] },
    });
    expect(
      buildQuery({ fromBlock: 1, blocks: 2, addresses: [ADDRESS] }).logs,
    ).toEqual([{ address: [ADDRESS] }]);
  });

  it("refuses malformed addresses, topics and ranges", () => {
    expect(() =>
      buildQuery({ fromBlock: 1, blocks: 2, addresses: ["0x12"] }),
    ).toThrow(/address/);
    expect(() =>
      buildQuery({
        fromBlock: 1,
        blocks: 2,
        addresses: [ADDRESS],
        topics: [["0x12"]],
      }),
    ).toThrow(/topic/);
    expect(() =>
      buildQuery({ fromBlock: -1, blocks: 2, addresses: [ADDRESS] }),
    ).toThrow(/range/);
    expect(() =>
      buildQuery({ fromBlock: 1, blocks: 0, addresses: [ADDRESS] }),
    ).toThrow(/range/);
  });
});

describe("configuration", () => {
  it("needs a plain https origin and a token, and never echoes them", () => {
    const env = {
      ENVIO_HYPERSYNC_URL: "https://hypersync.example",
      ENVIO_API_TOKEN: TOKEN,
    };
    expect(readConfig(env)).toEqual({
      origin: "https://hypersync.example",
      token: TOKEN,
    });
    expect(
      readConfig({ ...env, ENVIO_HYPERSYNC_URL: "https://hypersync.example/" })
        .origin,
    ).toBe("https://hypersync.example");
    for (const url of [
      undefined,
      "not a url",
      "http://hypersync.example",
      "https://user:pw@hypersync.example",
      `https://hypersync.example/${TOKEN}`,
      `https://hypersync.example/?token=${TOKEN}`,
    ]) {
      let message = "";
      try {
        readConfig({ ...env, ENVIO_HYPERSYNC_URL: url });
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain("ENVIO_HYPERSYNC_URL");
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain("pw@");
    }
    expect(() =>
      readConfig({ ENVIO_HYPERSYNC_URL: env.ENVIO_HYPERSYNC_URL }),
    ).toThrow(/ENVIO_API_TOKEN/);
  });
});

describe("runEstimate", () => {
  const config = { origin: "https://hypersync.example", token: TOKEN };
  const queries = [
    { label: "static set", addresses: [ADDRESS] },
    {
      label: "v4 swaps",
      addresses: [ADDRESS],
      topics: [[TOPIC]],
      coverage: 0.5,
    },
  ];
  const window = {
    startBlock: 61_000_000,
    headBlock: 70_000_000,
    fromBlock: 69_000_000,
    blocks: 100_000,
  };
  const okResponse = () =>
    new Response(
      JSON.stringify({
        data: [],
        next_block: 69_100_000,
        archive_height: 70_000_000,
      }),
      {
        status: 200,
        headers: {
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": "80",
          "x-ratelimit-reset": "33",
          "x-ratelimit-cost": "20",
        },
      },
    );

  it("sends one authenticated query at a time and prints no token", async () => {
    const calls: { url: string; auth: string | null; body: string }[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push({
          url: String(input),
          auth: new Headers(init?.headers).get("authorization"),
          body: String(init?.body),
        });
        await Promise.resolve();
        inFlight -= 1;
        return okResponse();
      },
    ) as unknown as typeof fetch;
    const result = await runEstimate(config, queries, window, {
      fetch: fetchFn,
      now: (() => {
        let t = 0;
        return () => (t += 250);
      })(),
    });
    expect(maxInFlight).toBe(1);
    expect(calls.map((call) => call.url)).toEqual([
      "https://hypersync.example/query",
      "https://hypersync.example/query",
    ]);
    expect(calls.every((call) => call.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      from_block: 69_000_000,
      to_block: 69_100_000,
    });
    expect(result.limit).toBe(100);
    expect(result.estimate.perSample).toHaveLength(2);
    expect(result.estimate.perSample[0]).toMatchObject({
      elapsedMs: 250,
      cost: 20,
    });
    expect(result.lines.join("\n")).toContain("x-ratelimit-limit 100");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("stops with the reset time on a 429 instead of retrying", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response("slow down", {
          status: 429,
          headers: { "x-ratelimit-reset": "17" },
        }),
    ) as unknown as typeof fetch;
    await expect(
      runEstimate(config, queries, window, { fetch: fetchFn, now: Date.now }),
    ).rejects.toThrow(/rate limited.*17/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected token without printing it", async () => {
    const fetchFn = (async () =>
      new Response(`bad token ${TOKEN}`, {
        status: 401,
      })) as unknown as typeof fetch;
    const error = await runEstimate(config, queries, window, {
      fetch: fetchFn,
      now: Date.now,
    }).catch((caught) => caught);
    expect(String(error)).toMatch(/401/);
    expect(String(error)).not.toContain(TOKEN);
  });

  it("does not leak the token through a network error", async () => {
    const fetchFn = (async () => {
      throw new Error(`socket hang up (Authorization: Bearer ${TOKEN})`);
    }) as unknown as typeof fetch;
    const error = await runEstimate(config, queries, window, {
      fetch: fetchFn,
      now: Date.now,
    }).catch((caught) => caught);
    expect(String(error)).not.toContain(TOKEN);
  });
});
