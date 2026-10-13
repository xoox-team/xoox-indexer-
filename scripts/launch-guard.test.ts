import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkHasuraState,
  checkLiveEndpointList,
  checkLiveStatuses,
  checkStaticEnv,
  parseLiveEndpoints,
  runLaunchGuard,
  type GuardEnv,
} from "./launch-guard-lib";

const SECRET = "s3cret-value-that-must-never-be-printed";
const GOOD_ENV: GuardEnv = {
  ENVIO_PG_DATABASE: "xoox_one_20261014",
  ENVIO_PG_SCHEMA: "xoox",
  HASURA_GRAPHQL_ENDPOINT: "http://xoox-one-hasura:8080/v1/metadata",
  HASURA_GRAPHQL_ADMIN_SECRET: SECRET,
  ENVIO_CONFIG: "/app/config.xoox-one.json",
  INDEXER_CONTRACT_RPC_URL: "https://rpc-monad-testnet.posthuman.digital",
};
const LIVE = [
  "http://live-hasura-a:8080/v1/graphql",
  "http://live-hasura-b:8080/v1/graphql",
];

describe("static environment checks", () => {
  it("accepts the xoox-one launch environment", () => {
    expect(checkStaticEnv(GOOD_ENV)).toEqual([]);
  });

  it("requires a xoox_one_ database name", () => {
    for (const database of [
      undefined,
      "",
      "envio-dev",
      "xoox_trade_source",
      "xoox_pro_source",
      "xoox_one_",
      "xoox_one_UPPER",
      "xoox_one_a-b",
      "xoox_one_x\n",
      "prefix_xoox_one_x",
    ])
      expect(
        checkStaticEnv({ ...GOOD_ENV, ENVIO_PG_DATABASE: database }),
      ).toEqual([expect.stringContaining("ENVIO_PG_DATABASE")]);
  });

  it("requires the xoox schema", () => {
    for (const schema of [undefined, "", "public", "xoox2", "XOOX"])
      expect(checkStaticEnv({ ...GOOD_ENV, ENVIO_PG_SCHEMA: schema })).toEqual([
        expect.stringContaining("ENVIO_PG_SCHEMA"),
      ]);
  });

  it("requires the xoox-one-hasura host exactly, and Envio's /v1/metadata path", () => {
    const bad = [
      undefined,
      "",
      "not a url",
      "http://hasura:8080/v1/metadata",
      "http://live-hasura-a:8080/v1/metadata",
      "http://xoox-one-hasura.evil.example/v1/metadata",
      "http://evil.example/xoox-one-hasura/v1/metadata",
      "http://xoox-one-hasura@evil.example/v1/metadata",
      "http://user:pw@xoox-one-hasura:8080/v1/metadata",
      "http://xoox-one-hasura:8080/v1/graphql",
      "ftp://xoox-one-hasura/v1/metadata",
    ];
    for (const endpoint of bad)
      expect(
        checkStaticEnv({ ...GOOD_ENV, HASURA_GRAPHQL_ENDPOINT: endpoint }),
      ).toEqual([expect.stringContaining("HASURA_GRAPHQL_ENDPOINT")]);
    expect(
      checkStaticEnv({
        ...GOOD_ENV,
        HASURA_GRAPHQL_ENDPOINT: "https://xoox-one-hasura/v1/metadata",
      }),
    ).toEqual([]);
  });

  it("requires an admin secret and a config path without echoing either", () => {
    const failures = checkStaticEnv({
      ...GOOD_ENV,
      HASURA_GRAPHQL_ADMIN_SECRET: "",
      ENVIO_CONFIG: undefined,
    });
    expect(failures).toEqual([
      expect.stringContaining("HASURA_GRAPHQL_ADMIN_SECRET"),
      expect.stringContaining("ENVIO_CONFIG"),
    ]);
  });

  it("requires an absolute ENVIO_CONFIG, because Envio and the lint resolve a relative one differently", () => {
    for (const config of [
      "config.xoox-one.json",
      "./config.xoox-one.json",
      "../indexer/config.xoox-one.json",
    ])
      expect(checkStaticEnv({ ...GOOD_ENV, ENVIO_CONFIG: config })).toEqual([
        expect.stringMatching(/ENVIO_CONFIG must be an absolute path/),
      ]);
    expect(
      checkStaticEnv({
        ...GOOD_ENV,
        ENVIO_CONFIG: "config.xoox-one.json",
      }).join("\n"),
    ).not.toContain("config.xoox-one.json");
  });

  it("requires INDEXER_CONTRACT_RPC_URL, which the Royalty and TradeDex effects read lazily from the process env", () => {
    for (const value of [undefined, ""])
      expect(
        checkStaticEnv({ ...GOOD_ENV, INDEXER_CONTRACT_RPC_URL: value }),
      ).toEqual([expect.stringContaining("INDEXER_CONTRACT_RPC_URL")]);
  });

  it("reports every failure at once", () => {
    expect(checkStaticEnv({})).toHaveLength(6);
  });
});

describe("live Hasura list", () => {
  it("parses comma and whitespace separated endpoints from env and flags", () => {
    expect(
      parseLiveEndpoints(
        [
          "--live-hasura=http://a/v1/graphql",
          "--live-hasura",
          "http://b/v1/graphql",
        ],
        " http://c/x, http://d/y\nhttp://e/z ",
      ),
    ).toEqual([
      "http://a/v1/graphql",
      "http://b/v1/graphql",
      "http://c/x",
      "http://d/y",
      "http://e/z",
    ]);
    expect(parseLiveEndpoints([], undefined)).toEqual([]);
  });

  it("refuses an empty list so the 401 check can never be skipped", () => {
    expect(
      checkLiveEndpointList([], GOOD_ENV.HASURA_GRAPHQL_ENDPOINT as string),
    ).toEqual([expect.stringContaining("live Hasura")]);
  });

  it("refuses unparsable entries, credentials and the xoox-one host itself", () => {
    const endpoint = GOOD_ENV.HASURA_GRAPHQL_ENDPOINT as string;
    expect(checkLiveEndpointList(["nope"], endpoint)).toHaveLength(1);
    expect(
      checkLiveEndpointList(["http://u:p@live:8080/v1/graphql"], endpoint),
    ).toHaveLength(1);
    expect(
      checkLiveEndpointList(
        ["http://xoox-one-hasura:8080/v1/graphql"],
        endpoint,
      ),
    ).toHaveLength(1);
    expect(checkLiveEndpointList(LIVE, endpoint)).toEqual([]);
  });

  it("names a rejected entry by its position and never echoes any part of it", () => {
    const endpoint = GOOD_ENV.HASURA_GRAPHQL_ENDPOINT as string;
    const password = "PW123456";
    const token = "tok_live_0123456789abcdefghijklmnop";
    const failures = checkLiveEndpointList(
      [
        LIVE[0] as string,
        `http://u:${password}@h:8080/v1/graphql`,
        token,
        `http://admin:LIVEPASSWORD@live-hasura-a:8080/v1/graphql`,
      ],
      endpoint,
    );
    expect(failures).toEqual([
      expect.stringContaining("#2"),
      expect.stringContaining("#3"),
      expect.stringContaining("#4"),
    ]);
    const text = JSON.stringify(failures);
    for (const leaked of [password, token, "LIVEPASSWORD", "http://u", "tok_"])
      expect(text).not.toContain(leaked);
  });
});

describe("Hasura state", () => {
  const fresh = { database: "xoox_one_20261014", initialized: false };

  it("accepts a fresh database with zero tracked tables", () => {
    expect(
      checkHasuraState({ trackedTables: 0, ...fresh }, "xoox_one_20261014"),
    ).toEqual([]);
  });

  it("refuses a fresh database whose Hasura already tracks tables", () => {
    expect(
      checkHasuraState({ trackedTables: 42, ...fresh }, "xoox_one_20261014"),
    ).toEqual([expect.stringContaining("clear_metadata")]);
  });

  it("accepts tracked tables once the database already belongs to xoox-one", () => {
    expect(
      checkHasuraState(
        { trackedTables: 58, database: "xoox_one_20261014", initialized: true },
        "xoox_one_20261014",
      ),
    ).toEqual([]);
  });

  it("refuses a Hasura that sits on a different database", () => {
    expect(
      checkHasuraState(
        { trackedTables: 0, database: "envio-dev", initialized: false },
        "xoox_one_20261014",
      ),
    ).toEqual([expect.stringContaining("different database")]);
    expect(
      checkHasuraState(
        {
          trackedTables: 58,
          database: "xoox_trade_source",
          initialized: true,
        },
        "xoox_one_20261014",
      ),
    ).toEqual([expect.stringContaining("different database")]);
  });
});

describe("live Hasura probes", () => {
  it("passes only on 401", () => {
    expect(
      checkLiveStatuses([
        { host: "a", status: 401 },
        { host: "b", status: 401 },
      ]),
    ).toEqual([]);
  });

  it("counts Hasura's GraphQL access-denied reply (HTTP 200) as a rejection", () => {
    expect(
      checkLiveStatuses([
        { host: "a", status: 200, denied: true },
        { host: "b", status: 401 },
      ]),
    ).toEqual([]);
  });

  it("names every endpoint that accepts or cannot reject the secret", () => {
    const failures = checkLiveStatuses([
      { host: "a", status: 200 },
      { host: "b", status: 403 },
      { host: "c", status: null },
      { host: "d", status: 401 },
    ]);
    expect(failures).toHaveLength(3);
    expect(failures[0]).toContain("a");
    expect(failures[0]).toContain("accepts");
    expect(failures[2]).toContain("c");
  });
});

type Reply = { status: number; body?: unknown } | Error;

function fakeFetch(replies: {
  metadata?: Reply;
  sql?: Reply;
  live?: Record<string, Reply>;
}) {
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];
  const fetchFn = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: String(init?.body ?? ""),
      });
      let reply: Reply | undefined;
      if (url === "http://xoox-one-hasura:8080/v1/metadata")
        reply = replies.metadata;
      else if (url === "http://xoox-one-hasura:8080/v2/query")
        reply = replies.sql;
      else reply = replies.live?.[new URL(url).host];
      if (!reply) throw new Error(`unexpected request to ${url}`);
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status,
      });
    },
  );
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const METADATA_EMPTY: Reply = {
  status: 200,
  body: {
    resource_version: 3,
    metadata: {
      version: 3,
      sources: [{ name: "default", kind: "postgres", tables: [] }],
    },
  },
};
const SQL_FRESH: Reply = {
  status: 200,
  body: {
    result_type: "TuplesOk",
    result: [
      ["current_database", "initialized"],
      ["xoox_one_20261014", "0"],
    ],
  },
};
const SQL_INITIALIZED: Reply = {
  status: 200,
  body: {
    result_type: "TuplesOk",
    result: [
      ["current_database", "initialized"],
      ["xoox_one_20261014", "1"],
    ],
  },
};
const LIVE_REJECT: Record<string, Reply> = {
  "live-hasura-a:8080": { status: 401 },
  "live-hasura-b:8080": { status: 401 },
};

describe("runLaunchGuard", () => {
  const lintOk = async () => [] as string[];

  it("passes on a fresh xoox-one stack and sends the secret only to xoox-one and the 401 probes", async () => {
    const { fetchFn, calls } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: SQL_FRESH,
      live: LIVE_REJECT,
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report).toEqual({ ok: true, failures: [] });
    expect(calls.map((call) => new URL(call.url).host).sort()).toEqual([
      "live-hasura-a:8080",
      "live-hasura-b:8080",
      "xoox-one-hasura:8080",
      "xoox-one-hasura:8080",
    ]);
    for (const call of calls)
      expect(call.headers["x-hasura-admin-secret"]).toBe(SECRET);
    const sql = calls.find((call) => call.url.endsWith("/v2/query"));
    expect(JSON.parse(sql?.body ?? "{}")).toMatchObject({
      type: "run_sql",
      args: { read_only: true },
    });
    const metadata = calls.find((call) => call.url.endsWith("/v1/metadata"));
    expect(JSON.parse(metadata?.body ?? "{}")).toMatchObject({
      type: "export_metadata",
    });
  });

  it("probes live Hasuras on their graphql endpoint, never on their metadata API", async () => {
    const { fetchFn, calls } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: SQL_FRESH,
      live: LIVE_REJECT,
    });
    await runLaunchGuard(
      {
        env: GOOD_ENV,
        liveEndpoints: [
          "http://live-hasura-a:8080/v1/metadata",
          LIVE[1] as string,
        ],
      },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    const live = calls.filter((call) => !call.url.includes("xoox-one-hasura"));
    expect(live.map((call) => call.url)).toEqual([
      "http://live-hasura-a:8080/v1/graphql",
      "http://live-hasura-b:8080/v1/graphql",
    ]);
  });

  it("makes no request at all when the static environment is wrong", async () => {
    const { fetchFn } = fakeFetch({});
    const report = await runLaunchGuard(
      {
        env: {
          ...GOOD_ENV,
          HASURA_GRAPHQL_ENDPOINT: "http://live-hasura-a:8080/v1/metadata",
        },
        liveEndpoints: LIVE,
      },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("passes when live Hasuras deny the secret the way Hasura v2 does on /v1/graphql", async () => {
    const denied = {
      status: 200,
      body: {
        errors: [
          {
            message: 'invalid "x-hasura-admin-secret"/"x-hasura-access-key"',
            extensions: { path: "$", code: "access-denied" },
          },
        ],
      },
    };
    const { fetchFn } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: SQL_FRESH,
      live: {
        "live-hasura-a:8080": denied,
        "live-hasura-b:8080": denied,
      },
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report).toEqual({ ok: true, failures: [] });
  });

  it("refuses a 200 that is an error other than access-denied", async () => {
    const { fetchFn } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: SQL_FRESH,
      live: {
        ...LIVE_REJECT,
        "live-hasura-a:8080": {
          status: 200,
          body: { errors: [{ extensions: { code: "validation-failed" } }] },
        },
      },
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(false);
  });

  // clear_metadata runs only when Envio initializes a fresh database, so once the database is initialized the old live
  // Hasuras can be retired and the probe list may be empty; before that the probe stays mandatory.
  it("allows an empty live list once Envio has initialized the database", async () => {
    const { fetchFn, calls } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: SQL_INITIALIZED,
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: [] },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report).toEqual({ ok: true, failures: [] });
    expect(calls.every((call) => call.url.startsWith("http://xoox-one-hasura:8080/"))).toBe(true);
  });

  it("still refuses an empty live list before the first initialize", async () => {
    const { fetchFn } = fakeFetch({ metadata: METADATA_EMPTY, sql: SQL_FRESH });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: [] },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toMatch(/No live Hasura endpoint was passed/);
  });

  it("refuses an empty live list when the database state cannot be read", async () => {
    const { fetchFn } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: new Error("connect ECONNREFUSED"),
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: [] },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toMatch(/No live Hasura endpoint was passed/);
  });

  it("refuses when a live Hasura accepts the new secret", async () => {
    const { fetchFn } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: SQL_FRESH,
      live: {
        ...LIVE_REJECT,
        "live-hasura-a:8080": { status: 200, body: { data: {} } },
      },
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toContain("live-hasura-a");
  });

  it("fails closed when xoox-one's Hasura cannot be read or a live Hasura is unreachable", async () => {
    const { fetchFn } = fakeFetch({
      metadata: new Error("connect ECONNREFUSED"),
      live: {
        ...LIVE_REJECT,
        "live-hasura-b:8080": new Error("timeout"),
      },
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.failures).toEqual([
      expect.stringContaining("export_metadata"),
      expect.stringContaining("live-hasura-b"),
    ]);
  });

  it("fails closed when the database state cannot be read", async () => {
    const { fetchFn } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: { status: 500 },
      live: LIVE_REJECT,
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.failures).toEqual([expect.stringContaining("run_sql")]);
  });

  it("refuses a fresh database whose Hasura tracks tables", async () => {
    const { fetchFn } = fakeFetch({
      metadata: {
        status: 200,
        body: {
          resource_version: 9,
          metadata: {
            version: 3,
            sources: [{ name: "default", tables: [{}, {}, {}] }],
          },
        },
      },
      sql: SQL_FRESH,
      live: LIVE_REJECT,
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.failures).toEqual([
      expect.stringContaining("3 tracked tables"),
    ]);
  });

  it("allows a restart: tracked tables on an initialized xoox-one database", async () => {
    const { fetchFn } = fakeFetch({
      metadata: {
        status: 200,
        body: {
          resource_version: 9,
          metadata: {
            version: 3,
            sources: [{ name: "default", tables: [{}, {}] }],
          },
        },
      },
      sql: {
        status: 200,
        body: {
          result_type: "TuplesOk",
          result: [
            ["current_database", "initialized"],
            ["xoox_one_20261014", "1"],
          ],
        },
      },
      live: LIVE_REJECT,
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(true);
  });

  it("refuses an unreadable export_metadata shape", async () => {
    const { fetchFn } = fakeFetch({
      metadata: { status: 200, body: { nope: true } },
      sql: SQL_FRESH,
      live: LIVE_REJECT,
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toContain("export_metadata");
  });

  it("refuses when the config lint reports problems, throws or is missing", async () => {
    const run = (
      lintConfig: (path: string) => Promise<string[]> | string[],
    ) => {
      const { fetchFn } = fakeFetch({
        metadata: METADATA_EMPTY,
        sql: SQL_FRESH,
        live: LIVE_REJECT,
      });
      return runLaunchGuard(
        { env: GOOD_ENV, liveEndpoints: LIVE },
        { fetch: fetchFn, lintConfig },
      );
    };
    expect((await run(() => ["rpc[0].url carries a key"])).failures).toEqual([
      "config lint: rpc[0].url carries a key",
    ]);
    expect(
      (
        await run(() => {
          throw new Error("ENOENT config");
        })
      ).failures,
    ).toEqual([expect.stringContaining("config lint could not run")]);
    expect((await run(undefined as never)).failures).toEqual([
      expect.stringContaining("config lint could not run"),
    ]);
  });

  it("hands the lint the guard's own env, so INDEXER_CONTRACT_RPC_URL is compared where the guard saw it", async () => {
    const { fetchFn } = fakeFetch({
      metadata: METADATA_EMPTY,
      sql: SQL_FRESH,
      live: LIVE_REJECT,
    });
    const lintConfig = vi.fn(async () => [] as string[]);
    await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig },
    );
    expect(lintConfig).toHaveBeenCalledWith("/app/config.xoox-one.json", {
      env: GOOD_ENV,
    });
  });

  it("never echoes a live endpoint with credentials or a bare token into the report", async () => {
    const { fetchFn, calls } = fakeFetch({});
    const report = await runLaunchGuard(
      {
        env: GOOD_ENV,
        liveEndpoints: [
          "http://admin:LIVEPASSWORD@live-hasura-a:8080/v1/graphql",
          "tok_live_0123456789abcdefghijklmnop",
        ],
      },
      { fetch: fetchFn, lintConfig: lintOk },
    );
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual([
      expect.stringContaining("#1"),
      expect.stringContaining("#2"),
    ]);
    expect(JSON.stringify(report)).not.toMatch(/LIVEPASSWORD|tok_live/);
    expect(calls).toEqual([]);
  });

  it("never prints the admin secret, even when a request throws it back", async () => {
    const { fetchFn } = fakeFetch({
      metadata: new Error(`boom ${SECRET}`),
      sql: new Error(`boom ${SECRET}`),
      live: {
        "live-hasura-a:8080": new Error(`boom ${SECRET}`),
        "live-hasura-b:8080": { status: 200 },
      },
    });
    const report = await runLaunchGuard(
      { env: GOOD_ENV, liveEndpoints: LIVE },
      { fetch: fetchFn, lintConfig: () => [`bad ${SECRET}`] },
    );
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });
});

// The guard is the only thing standing between a wrong environment and `clear_metadata` on the live Hasura, and exit 0
// means "start". Its entry must therefore run whatever path or symlink Node was started through.
describe("command line entry", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const tsx = join(here, "../node_modules/.bin/tsx");
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  const runGuard = (script: string) =>
    spawnSync(tsx, [script], {
      env: { PATH: process.env["PATH"] ?? "" },
      encoding: "utf8",
      timeout: 60_000,
    });

  it("refuses to start with an empty environment", () => {
    const result = runGuard(join(here, "launch-guard.ts"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to start");
  }, 60_000);

  it("refuses to start when it is run through a symlinked directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "xoox-one-guard-"));
    directories.push(directory);
    const link = join(directory, "current");
    symlinkSync(here, link);
    const result = runGuard(join(link, "launch-guard.ts"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to start");
  }, 60_000);
});
