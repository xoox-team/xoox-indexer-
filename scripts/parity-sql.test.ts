import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bucketsSql,
  familyOf,
  paritySql,
  planTable,
  rowsSql,
  summarySql,
} from "./parity-sql";
import {
  parseSchemaEntities,
  readSchemaEntities,
  type SchemaEntity,
} from "./schema-entities";

const PIN = { blockNumber: 69_123_456n, blockTimestamp: 1_790_000_000n };

const entities = parseSchemaEntities(`
type Trade {
  id: ID!
  token: String! @index
  tokens: BigInt!
  blockNumber: BigInt! @index
  logIndex: Int!
}
type Launch {
  id: ID!
  name: String
  createdBlock: BigInt @index
}
type Pool {
  id: ID!
  tick: Int!
}
type MarketSecond {
  id: ID!
  timestamp: BigInt! @index
  quoteVolume: BigInt!
}
type HourCandle {
  id: ID!
  bucketStart: BigInt! @index
  tradeCount: BigInt!
}
type TradeDexToken {
  id: ID!
  chainId: Int!
  address: String!
  name: String
  symbol: String
  decimals: Int
  status: String!
  updatedAt: BigInt!
}
type TradeDexCoverage {
  id: ID!
  registryHash: String!
  historyComplete: Boolean!
  firstObservedBlock: BigInt!
  lastObservedBlock: BigInt!
  updatedAt: BigInt!
}
`);
const entity = (name: string): SchemaEntity => {
  const found = entities.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`fixture ${name}`);
  return found;
};

describe("parity families", () => {
  it("assigns every entity to the family whose indexer owns it", () => {
    expect(familyOf("Trade")).toBe("legacy");
    expect(familyOf("ProcessedEvent")).toBe("legacy");
    expect(familyOf("ProLaunch")).toBe("pro");
    expect(familyOf("ProProcessedEvent")).toBe("pro");
    expect(familyOf("TradeDexPool")).toBe("tradeDex");
    expect(familyOf("TradeFeed")).toBe("tradeFeed");
  });
});

describe("table plans", () => {
  it("filters event tables by blockNumber and hashes every column in schema order", () => {
    const plan = planTable(entity("Trade"), PIN);
    expect(plan).toMatchObject({
      kind: "event",
      family: "legacy",
      columns: ["id", "token", "tokens", "blockNumber", "logIndex"],
      excluded: [],
      predicates: ['"blockNumber" <= 69123456'],
    });
  });

  it("filters created-block tables by their creation block, keeping rows whose nullable block is unset", () => {
    expect(planTable(entity("Launch"), PIN)).toMatchObject({
      kind: "created",
      predicates: ['("createdBlock" IS NULL OR "createdBlock" <= 69123456)'],
    });
    const [required] = parseSchemaEntities(
      "type Ledger {\n  id: ID!\n  createdBlock: BigInt!\n}",
    );
    expect(planTable(required as SchemaEntity, PIN).predicates).toEqual([
      '"createdBlock" <= 69123456',
    ]);
  });

  it("leaves tables with no block column unfiltered", () => {
    expect(planTable(entity("Pool"), PIN)).toMatchObject({
      kind: "state",
      predicates: [],
    });
  });

  it("keeps only closed MarketSecond and HourCandle buckets", () => {
    expect(planTable(entity("MarketSecond"), PIN).predicates).toEqual([
      '"timestamp" < 1790000000',
    ]);
    expect(planTable(entity("HourCandle"), PIN).predicates).toEqual([
      '"bucketStart" + 3600 <= 1790000000',
    ]);
  });

  it("drops the time-dependent TradeDex metadata columns from the row hash", () => {
    const plan = planTable(entity("TradeDexToken"), PIN);
    expect(plan.columns).toEqual(["id", "chainId", "address"]);
    expect(plan.excluded).toEqual([
      "name",
      "symbol",
      "decimals",
      "status",
      "updatedAt",
    ]);
    expect(planTable(entity("TradeDexCoverage"), PIN).columns).toEqual([
      "id",
      "registryHash",
      "historyComplete",
    ]);
  });

  it("applies extra exclusions and refuses to exclude the id", () => {
    const plan = planTable(entity("Trade"), PIN, { Trade: ["logIndex"] });
    expect(plan.columns).not.toContain("logIndex");
    expect(plan.excluded).toEqual(["logIndex"]);
    expect(() => planTable(entity("Trade"), PIN, { Trade: ["id"] })).toThrow(
      /id/,
    );
    expect(() => planTable(entity("Trade"), PIN, { Trade: ["nope"] })).toThrow(
      /nope/,
    );
  });

  it("refuses a pin that is not a non-negative integer pair", () => {
    expect(() =>
      planTable(entity("Trade"), { blockNumber: -1n, blockTimestamp: 1n }),
    ).toThrow(/pin/i);
    expect(() =>
      planTable(entity("Trade"), { blockNumber: 1n, blockTimestamp: -1n }),
    ).toThrow(/pin/i);
  });

  it("refuses a table too wide for jsonb_build_array", () => {
    const wide = parseSchemaEntities(
      `type Wide {\n  id: ID!\n${Array.from({ length: 100 }, (_, index) => `  c${index}: Int!`).join("\n")}\n}`,
    )[0] as SchemaEntity;
    expect(() => planTable(wide, PIN)).toThrow(/columns/);
  });
});

describe("generated SQL", () => {
  it("summarises one table with a block-filtered count and an order-independent sha256 digest", () => {
    const sql = summarySql(planTable(entity("Trade"), PIN), "xoox");
    expect(sql).toContain("'Trade' AS entity");
    expect(sql).toContain("count(*) AS n");
    expect(sql).toContain(
      'jsonb_build_array("id", "token", "tokens", "blockNumber", "logIndex")',
    );
    expect(sql).toContain("sha256(");
    expect(sql).toContain('FROM "xoox"."Trade"');
    expect(sql).toContain('WHERE "blockNumber" <= 69123456');
    expect(sql).not.toMatch(/ORDER BY/i);
    expect(sql.trim().endsWith(";")).toBe(true);
  });

  it("omits WHERE for unfiltered tables and joins several predicates with AND", () => {
    expect(summarySql(planTable(entity("Pool"), PIN), "xoox")).not.toContain(
      "WHERE",
    );
    expect(summarySql(planTable(entity("Trade"), PIN), "xoox")).toContain(
      "WHERE",
    );
  });

  it("buckets a table by the first two hex digits of md5(id)", () => {
    const sql = bucketsSql(planTable(entity("Trade"), PIN), "xoox");
    expect(sql).toContain('substr(md5("id"), 1, 2) AS bucket');
    expect(sql).toContain("GROUP BY 2 ORDER BY 2");
    expect(sql).toContain('WHERE "blockNumber" <= 69123456');
  });

  it("lists row hashes of chosen buckets only, validating the bucket names", () => {
    const sql = rowsSql(planTable(entity("Trade"), PIN), "xoox", ["0a", "f3"]);
    expect(sql).toContain("substr(md5(\"id\"), 1, 2) IN ('0a', 'f3')");
    expect(sql).toContain('"blockNumber" <= 69123456');
    expect(sql).toContain('ORDER BY "id"');
    expect(() =>
      rowsSql(planTable(entity("Trade"), PIN), "xoox", ["zz"]),
    ).toThrow(/bucket/);
    expect(() =>
      rowsSql(planTable(entity("Trade"), PIN), "xoox", [
        "0a'); DROP TABLE x; --",
      ]),
    ).toThrow(/bucket/);
    expect(() => rowsSql(planTable(entity("Trade"), PIN), "xoox", [])).toThrow(
      /bucket/,
    );
  });

  it("quotes the schema and refuses odd identifiers", () => {
    expect(summarySql(planTable(entity("Trade"), PIN), "xoox_one")).toContain(
      '"xoox_one"."Trade"',
    );
    expect(() => summarySql(planTable(entity("Trade"), PIN), 'x"y')).toThrow(
      /identifier/,
    );
  });
});

describe("parity script", () => {
  it("is read-only, bounded, and holds one summary statement per family entity", () => {
    const script = paritySql(entities, {
      pin: PIN,
      family: "legacy",
      mode: "summary",
      schema: "xoox",
    });
    const statements = script
      .split("\n")
      .filter((line) => line && !line.startsWith("--"))
      .join("\n")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements)
      expect(statement).toMatch(/^(SELECT|SET)\b/);
    expect(script).toContain(
      "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;",
    );
    expect(script).toContain("statement_timeout");
    const summaries = statements.filter((statement) =>
      statement.startsWith("SELECT"),
    );
    // Trade, Launch, Pool, MarketSecond, HourCandle are legacy; the TradeDex tables are not.
    expect(summaries).toHaveLength(5);
    expect(script).not.toContain("TradeDexToken");
    expect(script).toContain("block <= 69123456");
  });

  it("names the database to run it on, per side, and uses that side's schema", () => {
    const options = { pin: PIN, family: "legacy", mode: "summary" } as const;
    const source = paritySql(entities, { ...options, schema: "stats" });
    expect(source).toContain("indexer-1 (database envio-dev)");
    expect(source).toContain('FROM "stats"."');
    const target = paritySql(entities, {
      ...options,
      side: "target",
      schema: "xoox",
    });
    expect(target).toContain("the xoox_one database");
    expect(target).not.toContain("envio-dev");
  });

  it("emits a single entity when asked", () => {
    const script = paritySql(entities, {
      pin: PIN,
      family: "tradeDex",
      mode: "buckets",
      schema: "xoox",
      entityName: "TradeDexToken",
    });
    expect(script).toContain('"TradeDexToken"');
    expect(script).not.toContain('"TradeDexCoverage"');
    expect(() =>
      paritySql(entities, {
        pin: PIN,
        family: "legacy",
        mode: "buckets",
        schema: "xoox",
        entityName: "TradeDexToken",
      }),
    ).toThrow(/family/);
  });

  it("needs buckets and one entity for the row drilldown", () => {
    expect(() =>
      paritySql(entities, {
        pin: PIN,
        family: "legacy",
        mode: "rows",
        schema: "xoox",
      }),
    ).toThrow(/entity/);
    const script = paritySql(entities, {
      pin: PIN,
      family: "legacy",
      mode: "rows",
      schema: "xoox",
      entityName: "Trade",
      buckets: ["0a"],
    });
    expect(script).toContain("row_hash");
  });

  it("builds SQL for every entity of the real schema", () => {
    const real = readSchemaEntities([
      fileURLToPath(
        new URL("../schema.graphql", import.meta.url),
      ),
    ]);
    for (const item of real) {
      const plan = planTable(item, PIN);
      for (const sql of [
        summarySql(plan, "xoox"),
        bucketsSql(plan, "xoox"),
        rowsSql(plan, "xoox", ["00"]),
      ]) {
        expect(sql).toContain(`"xoox"."${item.name}"`);
        expect(sql).not.toContain("undefined");
      }
    }
    expect(
      planTable(
        real.find((item) => item.name === "TradeDexToken") as SchemaEntity,
        PIN,
      ).columns,
    ).toEqual(["id", "chainId", "address"]);
  });
});
