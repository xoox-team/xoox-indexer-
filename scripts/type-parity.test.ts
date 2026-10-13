import { describe, expect, it, vi } from "vitest";
import { parseSchemaEntities } from "./schema-entities";
import {
  checkExpectedKinds,
  compareKinds,
  compareSchemas,
  expectedKinds,
  parseIntrospection,
  readEndpoints,
  runTypeParity,
  sampleQuery,
  typeSignature,
  valueKind,
  type TypeRef,
} from "./type-parity";

const ref = (
  kind: string,
  name: string | null,
  ofType: TypeRef | null = null,
): TypeRef => ({ kind, name, ofType });
const scalar = (name: string, nonNull = true) =>
  nonNull ? ref("NON_NULL", null, ref("SCALAR", name)) : ref("SCALAR", name);
const textList = ref(
  "NON_NULL",
  null,
  ref("LIST", null, ref("NON_NULL", null, ref("SCALAR", "String"))),
);

function introspection(types: Record<string, Record<string, unknown>>) {
  return {
    data: {
      __schema: {
        types: [
          ...Object.entries(types).map(([name, fields]) => ({
            kind: "OBJECT",
            name,
            fields: Object.entries(fields).map(([field, type]) => ({
              name: field,
              type,
            })),
          })),
          { kind: "SCALAR", name: "numeric", fields: null },
          {
            kind: "OBJECT",
            name: "__Schema",
            fields: [{ name: "types", type: scalar("String") }],
          },
        ],
      },
    },
  };
}

const SOURCE = introspection({
  Launch: {
    id: scalar("String"),
    supply: scalar("numeric"),
    phase: scalar("Int"),
  },
  query_root: {
    Launch: ref("NON_NULL", null, ref("LIST", null, scalar("Launch"))),
    chain_metadata: ref("LIST", null, scalar("chain_metadata")),
  },
  Holder: { id: scalar("String"), proof: textList },
});

describe("introspection parsing", () => {
  it("renders non-null and list wrappers", () => {
    expect(typeSignature(scalar("numeric"))).toBe("numeric!");
    expect(typeSignature(scalar("Int", false))).toBe("Int");
    expect(typeSignature(textList)).toBe("[String!]!");
  });

  it("keeps object types, drops introspection types", () => {
    const parsed = parseIntrospection(SOURCE);
    expect([...parsed.keys()].sort()).toEqual([
      "Holder",
      "Launch",
      "query_root",
    ]);
    expect(parsed.get("Launch")?.get("supply")).toBe("numeric!");
    expect(parsed.get("Holder")?.get("proof")).toBe("[String!]!");
  });

  it("refuses a response that is not an introspection result", () => {
    expect(() => parseIntrospection({ errors: [{ message: "nope" }] })).toThrow(
      /introspection/,
    );
    expect(() => parseIntrospection({})).toThrow(/introspection/);
  });
});

describe("schema comparison", () => {
  const same = parseIntrospection(SOURCE);

  it("passes when the target is a superset", () => {
    const target = parseIntrospection(
      introspection({
        Launch: {
          id: scalar("String"),
          supply: scalar("numeric"),
          phase: scalar("Int"),
          extra: scalar("String"),
        },
        query_root: {
          Launch: ref("NON_NULL", null, ref("LIST", null, scalar("Launch"))),
          chain_metadata: ref("LIST", null, scalar("chain_metadata")),
          TradeFeed: scalar("String"),
        },
        Holder: { id: scalar("String"), proof: textList },
        TradeFeed: { id: scalar("String") },
      }),
    );
    expect(compareSchemas(same, target)).toEqual({
      missingTypes: [],
      missingFields: [],
      mismatches: [],
      extraTypes: 1,
    });
  });

  it("reports missing types, missing fields (including root fields) and changed column types", () => {
    const target = parseIntrospection(
      introspection({
        Launch: {
          id: scalar("String"),
          supply: scalar("bigint"),
          phase: scalar("Int"),
        },
        query_root: {
          Launch: ref("NON_NULL", null, ref("LIST", null, scalar("Launch"))),
        },
      }),
    );
    expect(compareSchemas(same, target)).toEqual({
      missingTypes: ["Holder"],
      missingFields: ["query_root.chain_metadata"],
      mismatches: [
        {
          type: "Launch",
          field: "supply",
          source: "numeric!",
          target: "bigint!",
        },
      ],
      extraTypes: 0,
    });
  });
});

describe("value kinds", () => {
  it("classifies JSON values", () => {
    expect(valueKind("1")).toBe("string");
    expect(valueKind(1)).toBe("number");
    expect(valueKind(true)).toBe("boolean");
    expect(valueKind(["a"])).toBe("array");
    expect(valueKind(null)).toBe("null");
    expect(valueKind({})).toBe("object");
  });

  const entities = parseSchemaEntities(`
type TradeFeed {
  id: ID!
  chainId: Int!
  logIndex: Int!
  amountIn: BigInt!
  wallet: String!
}
type Holder {
  id: ID!
  proof: [String!]!
  rulesActive: Boolean!
}
`);

  it("expects BigInt as string, Int as number and the chain_metadata cursor types from the plan", () => {
    const expected = expectedKinds(entities);
    expect(expected.get("TradeFeed.chainId")).toBe("number");
    expect(expected.get("TradeFeed.logIndex")).toBe("number");
    expect(expected.get("TradeFeed.amountIn")).toBe("string");
    expect(expected.get("TradeFeed.wallet")).toBe("string");
    expect(expected.get("Holder.proof")).toBe("array");
    expect(expected.get("Holder.rulesActive")).toBe("boolean");
    expect(expected.get("chain_metadata.chain_id")).toBe("number");
    expect(expected.get("chain_metadata.latest_processed_block")).toBe(
      "string",
    );
  });

  it("flags target values whose kind differs from the expectation, ignoring nulls", () => {
    const expected = expectedKinds(entities);
    expect(
      checkExpectedKinds(
        {
          chain_metadata: { chain_id: 10143, latest_processed_block: 69000000 },
          TradeFeed: { amountIn: "5", chainId: "10143", logIndex: null },
        },
        expected,
      ),
    ).toEqual([
      {
        entity: "chain_metadata",
        field: "latest_processed_block",
        source: "string",
        target: "number",
      },
      {
        entity: "TradeFeed",
        field: "chainId",
        source: "number",
        target: "string",
      },
    ]);
  });

  it("flags kinds that differ between the two endpoints, ignoring nulls and rows only one side has", () => {
    expect(
      compareKinds(
        { Launch: { supply: "5", phase: 1, name: null }, Only: { a: "1" } },
        { Launch: { supply: 5, phase: 1, name: "x" } },
      ),
    ).toEqual([
      { entity: "Launch", field: "supply", source: "string", target: "number" },
    ]);
  });
});

describe("sample query", () => {
  const entities = parseSchemaEntities(`
type Launch {
  id: ID!
  supply: BigInt!
  gone: String
}
type Holder {
  id: ID!
}
`);
  it("asks for one row of each entity the endpoint has, with only the columns it has", () => {
    const query = sampleQuery(
      entities,
      parseIntrospection(
        introspection({
          Launch: { id: scalar("String"), supply: scalar("numeric") },
          chain_metadata: {
            chain_id: scalar("Int"),
            latest_processed_block: scalar("Int"),
          },
          query_root: {
            Launch: scalar("Launch"),
            chain_metadata: scalar("chain_metadata"),
          },
        }),
      ),
    );
    expect(query).toContain("Launch(limit: 1) { id supply }");
    expect(query).toContain(
      "chain_metadata(limit: 1) { chain_id latest_processed_block }",
    );
    expect(query).not.toContain("Holder");
    expect(query).not.toContain("gone");
  });
});

describe("endpoint environment", () => {
  const env = {
    PARITY_SOURCE_GRAPHQL_URL: "http://old-hasura:8080/v1/graphql",
    PARITY_SOURCE_ADMIN_SECRET: "old-secret",
    PARITY_TARGET_GRAPHQL_URL: "http://xoox-one-hasura:8080/v1/graphql",
    PARITY_TARGET_ADMIN_SECRET: "new-secret",
  };

  it("reads both endpoints and their own secrets", () => {
    expect(readEndpoints(env)).toEqual({
      source: {
        url: "http://old-hasura:8080/v1/graphql",
        secret: "old-secret",
      },
      target: {
        url: "http://xoox-one-hasura:8080/v1/graphql",
        secret: "new-secret",
      },
    });
  });

  it("names the missing variables without printing any value", () => {
    expect(() =>
      readEndpoints({ ...env, PARITY_TARGET_ADMIN_SECRET: undefined }),
    ).toThrow(/PARITY_TARGET_ADMIN_SECRET/);
    expect(() =>
      readEndpoints({ ...env, PARITY_SOURCE_GRAPHQL_URL: "ftp://x" }),
    ).toThrow(/PARITY_SOURCE_GRAPHQL_URL/);
    expect(() =>
      readEndpoints({
        ...env,
        PARITY_SOURCE_GRAPHQL_URL: "http://u:p@old:8080/v1/graphql",
      }),
    ).toThrow(/credentials/);
    try {
      readEndpoints({
        ...env,
        PARITY_SOURCE_GRAPHQL_URL: "http://u:p@old:8080/v1/graphql",
      });
    } catch (error) {
      expect(String(error)).not.toContain("u:p");
    }
  });
});

describe("runTypeParity", () => {
  const entities = parseSchemaEntities(
    "type Launch {\n  id: ID!\n  supply: BigInt!\n}",
  );
  const env = {
    PARITY_SOURCE_GRAPHQL_URL: "http://old-hasura:8080/v1/graphql",
    PARITY_SOURCE_ADMIN_SECRET: "old-secret",
    PARITY_TARGET_GRAPHQL_URL: "http://xoox-one-hasura:8080/v1/graphql",
    PARITY_TARGET_ADMIN_SECRET: "new-secret",
  };
  const schema = introspection({
    Launch: { id: scalar("String"), supply: scalar("numeric") },
    chain_metadata: {
      chain_id: scalar("Int"),
      latest_processed_block: scalar("Int"),
    },
    query_root: {
      Launch: scalar("Launch"),
      chain_metadata: scalar("chain_metadata"),
    },
  });

  function fakeFetch(targetRows: Record<string, unknown>) {
    const calls: { url: string; secret: string | null; query: string }[] = [];
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const query = String(JSON.parse(String(init?.body)).query);
      calls.push({
        url: String(input),
        secret: headers.get("x-hasura-admin-secret"),
        query,
      });
      if (query.includes("__schema")) return Response.json(schema);
      const rows = String(input).includes("xoox-one")
        ? targetRows
        : {
            Launch: [{ id: "a", supply: "5" }],
            chain_metadata: [
              { chain_id: 10143, latest_processed_block: "69000000" },
            ],
          };
      return Response.json({ data: rows });
    });
    return { fn: fn as unknown as typeof fetch, calls };
  }

  it("passes when types and value kinds agree", async () => {
    const { fn, calls } = fakeFetch({
      Launch: [{ id: "a", supply: "5" }],
      chain_metadata: [{ chain_id: 10143, latest_processed_block: "69000001" }],
    });
    const report = await runTypeParity(env, entities, fn);
    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).not.toMatch(/old-secret|new-secret/);
    const bySecret = new Set(
      calls.map((call) => `${new URL(call.url).host}:${call.secret}`),
    );
    expect(bySecret).toEqual(
      new Set([
        "old-hasura:8080:old-secret",
        "xoox-one-hasura:8080:new-secret",
      ]),
    );
  });

  it("fails when the target serves the chain cursor as a number", async () => {
    const { fn } = fakeFetch({
      Launch: [{ id: "a", supply: "5" }],
      chain_metadata: [{ chain_id: 10143, latest_processed_block: 69000001 }],
    });
    const report = await runTypeParity(env, entities, fn);
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain(
      "chain_metadata.latest_processed_block",
    );
  });

  it("fails closed on an HTTP error without leaking the secret", async () => {
    const fn = (async () =>
      new Response("denied old-secret", {
        status: 401,
      })) as unknown as typeof fetch;
    await expect(runTypeParity(env, entities, fn)).rejects.toThrow(/HTTP 401/);
    await runTypeParity(env, entities, fn).catch((error) =>
      expect(String(error)).not.toContain("old-secret"),
    );
  });
});
