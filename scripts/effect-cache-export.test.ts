import { describe, expect, it } from "vitest";
import {
  EFFECTS,
  SOURCE_DATABASES,
  cachePath,
  cacheTableName,
  copySql,
  countSql,
  countTsvRows,
  listCacheTablesSql,
  parseTableList,
  planExport,
  psqlArgs,
  psqlEnv,
  resolveCacheTable,
  runExport,
  verifyRowCounts,
} from "./effect-cache-export";

describe("effect cache addressing (Envio 3.10 chain-scoped format)", () => {
  it("lists the five seeded effects with their canonical source (plan 3.5)", () => {
    expect(EFFECTS).toEqual([
      { name: "canonicalRoyaltyRecipientsV1", source: "indexer-1" },
      { name: "canonicalProPoolRouterBindingV1", source: "pro-indexer" },
      { name: "canonicalReviewedProConsentSourceV3", source: "pro-indexer" },
      { name: "canonicalReviewedProHolderGenesisV4", source: "pro-indexer" },
      { name: "canonicalTradeDexEvidenceV1", source: "trade-indexer" },
    ]);
    expect(EFFECTS.map((effect) => effect.name)).not.toContain(
      "currentTradeDexTokenMetadataV1",
    );
    expect(SOURCE_DATABASES).toEqual({
      "indexer-1": "envio-dev",
      "pro-indexer": "xoox_pro_source",
      "trade-indexer": "xoox_trade_source",
    });
  });

  it("maps an effect to its table and to its file under .envio/cache/<chain>/", () => {
    expect(cacheTableName(10143, "canonicalRoyaltyRecipientsV1")).toBe(
      "envio_10143_effect_canonicalRoyaltyRecipientsV1",
    );
    expect(cachePath(10143, "canonicalRoyaltyRecipientsV1")).toBe(
      "10143/canonicalRoyaltyRecipientsV1.tsv",
    );
    expect(() => cacheTableName(0, "x")).toThrow(/chain/);
    expect(() => cacheTableName(1.5, "x")).toThrow(/chain/);
    expect(() => cacheTableName(10143, "bad name")).toThrow(/effect/);
    expect(() => cachePath(10143, "../escape")).toThrow(/effect/);
  });
});

describe("SQL", () => {
  it("copies the table with Envio's own COPY options", () => {
    expect(copySql("xoox", "envio_10143_effect_x")).toBe(
      'COPY "xoox"."envio_10143_effect_x" TO STDOUT WITH (FORMAT text, HEADER);',
    );
  });

  it("counts rows", () => {
    expect(countSql("xoox", "envio_10143_effect_x")).toBe(
      'SELECT count(*) FROM "xoox"."envio_10143_effect_x";',
    );
  });

  it("lists effect-cache tables and their columns, as Envio finds them", () => {
    const sql = listCacheTablesSql("xoox");
    expect(sql).toContain("table_schema = 'xoox'");
    expect(sql).toContain("'^envio_([0-9]+_)?effect_.+'");
    expect(sql).toContain("information_schema.columns");
    expect(() => listCacheTablesSql("x'y")).toThrow(/identifier/);
  });

  it("generates only read statements", () => {
    for (const sql of [
      copySql("xoox", "t"),
      countSql("xoox", "t"),
      listCacheTablesSql("xoox"),
    ])
      expect(sql).toMatch(/^(SELECT|COPY)\b/);
  });
});

describe("table resolution", () => {
  const ok = {
    name: "envio_10143_effect_canonicalRoyaltyRecipientsV1",
    columns: ["id", "output"],
  };

  it("finds the chain-scoped table with exactly id and output", () => {
    expect(
      resolveCacheTable([ok], 10143, "canonicalRoyaltyRecipientsV1"),
    ).toEqual({ table: ok.name });
  });

  it("refuses a table with other columns", () => {
    expect(
      resolveCacheTable(
        [{ ...ok, columns: ["id", "output", "extra"] }],
        10143,
        "canonicalRoyaltyRecipientsV1",
      ),
    ).toEqual({
      problem: expect.stringContaining("columns"),
    });
  });

  it("refuses the cross-chain format instead of exporting it under the wrong name", () => {
    const legacy = {
      name: "envio_effect_canonicalRoyaltyRecipientsV1",
      columns: ["id", "output"],
    };
    expect(
      resolveCacheTable([legacy], 10143, "canonicalRoyaltyRecipientsV1"),
    ).toEqual({
      problem: expect.stringContaining("cross-chain"),
    });
  });

  it("reports a missing table", () => {
    expect(
      resolveCacheTable([], 10143, "canonicalRoyaltyRecipientsV1"),
    ).toEqual({
      problem: expect.stringContaining("no effect cache table"),
    });
  });

  it("parses the table listing psql prints", () => {
    expect(
      parseTableList(
        "envio_10143_effect_a|id,output\nenvio_effect_b|id,output,x\n",
      ),
    ).toEqual([
      { name: "envio_10143_effect_a", columns: ["id", "output"] },
      { name: "envio_effect_b", columns: ["id", "output", "x"] },
    ]);
    expect(parseTableList("")).toEqual([]);
  });
});

describe("TSV checks", () => {
  it("counts data rows after the header", () => {
    expect(countTsvRows("id\toutput\na\t{}\nb\t{}\n")).toBe(2);
    expect(countTsvRows("id\toutput\n")).toBe(0);
    expect(countTsvRows("id\toutput\na\t{}")).toBe(1);
  });

  it("refuses a file without the id/output header", () => {
    expect(() => countTsvRows("")).toThrow(/header/);
    expect(() => countTsvRows("a\tb\n1\t2\n")).toThrow(/header/);
  });

  it("accepts a row count between the counts taken before and after (cache tables only grow)", () => {
    expect(verifyRowCounts({ before: 10, after: 12, tsv: 11 })).toEqual([]);
    expect(verifyRowCounts({ before: 10, after: 10, tsv: 10 })).toEqual([]);
    expect(verifyRowCounts({ before: 10, after: 12, tsv: 9 })).toEqual([
      expect.stringContaining("fewer"),
    ]);
    expect(verifyRowCounts({ before: 10, after: 12, tsv: 13 })).toEqual([
      expect.stringContaining("more"),
    ]);
    expect(verifyRowCounts({ before: 0, after: 0, tsv: 0 })).toEqual([
      expect.stringContaining("empty"),
    ]);
  });
});

describe("psql invocation", () => {
  it("builds an argv with no credentials and refuses odd database names", () => {
    expect(psqlArgs("envio-dev", "SELECT 1;")).toEqual([
      "-X",
      "-q",
      "-A",
      "-t",
      "-F",
      "|",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      "envio-dev",
      "-c",
      "SELECT 1;",
    ]);
    for (const bad of ["", "-x", "a b", "a;b", "a'b"])
      expect(() => psqlArgs(bad, "SELECT 1;")).toThrow(/database/);
  });

  it("forces read-only, time-bounded sessions and keeps the libpq variables", () => {
    const env = psqlEnv({
      PGHOST: "db",
      PGUSER: "u",
      PGPASSWORD: "pw",
      PGOPTIONS: "-c work_mem=8MB",
      PATH: "/bin",
      OTHER: "x",
    });
    expect(env["PGOPTIONS"]).toContain("-c default_transaction_read_only=on");
    expect(env["PGOPTIONS"]).toContain("statement_timeout=");
    expect(env["PGOPTIONS"]).toContain("-c work_mem=8MB");
    expect(env["PGHOST"]).toBe("db");
    expect(env["PGPASSWORD"]).toBe("pw");
    expect(env["OTHER"]).toBeUndefined();
  });
});

describe("export plan and run", () => {
  it("plans one table per effect of the chosen source", () => {
    const plan = planExport({
      source: "pro-indexer",
      chainId: 10143,
      schema: "xoox",
      outRoot: ".envio/cache",
    });
    expect(plan.database).toBe("xoox_pro_source");
    expect(plan.effects.map((effect) => effect.name)).toEqual([
      "canonicalProPoolRouterBindingV1",
      "canonicalReviewedProConsentSourceV3",
      "canonicalReviewedProHolderGenesisV4",
    ]);
    expect(plan.effects[0]).toMatchObject({
      table: "envio_10143_effect_canonicalProPoolRouterBindingV1",
      file: ".envio/cache/10143/canonicalProPoolRouterBindingV1.tsv",
    });
    expect(
      planExport({
        source: "indexer-1",
        chainId: 10143,
        schema: "xoox",
        outRoot: "c",
        database: "other_db",
      }).database,
    ).toBe("other_db");
  });

  const TABLES = "envio_10143_effect_canonicalRoyaltyRecipientsV1|id,output\n";

  function fakePsql(
    options: {
      before?: string;
      after?: string;
      tsv?: string;
      tables?: string;
    } = {},
  ) {
    const statements: string[] = [];
    let counts = 0;
    const psql = async (args: readonly string[]) => {
      const sql = String(args[args.length - 1]);
      statements.push(sql);
      if (sql.startsWith("COPY"))
        return options.tsv ?? "id\toutput\na\t{}\nb\t{}\n";
      if (sql.startsWith("SELECT count"))
        return `${(counts += 1) === 1 ? (options.before ?? "2") : (options.after ?? "2")}\n`;
      return options.tables ?? TABLES;
    };
    return { psql, statements };
  }

  it("exports and verifies each table, writing the TSV where Envio looks for it", async () => {
    const written = new Map<string, string>();
    const { psql, statements } = fakePsql();
    const plan = planExport({
      source: "indexer-1",
      chainId: 10143,
      schema: "xoox",
      outRoot: ".envio/cache",
    });
    const result = await runExport(plan, {
      psql,
      writeTsv: async (path, text) => void written.set(path, text),
    });
    expect(result).toEqual({
      ok: true,
      lines: [expect.stringContaining("canonicalRoyaltyRecipientsV1: 2 rows")],
    });
    expect([...written.keys()]).toEqual([
      ".envio/cache/10143/canonicalRoyaltyRecipientsV1.tsv",
    ]);
    for (const sql of statements) expect(sql).toMatch(/^(SELECT|COPY)\b/);
  });

  it("writes nothing when the table is missing, in the wrong format, or the counts disagree", async () => {
    const plan = planExport({
      source: "indexer-1",
      chainId: 10143,
      schema: "xoox",
      outRoot: ".envio/cache",
    });
    for (const options of [
      { tables: "" },
      { tables: "envio_effect_canonicalRoyaltyRecipientsV1|id,output\n" },
      { before: "5", after: "5" },
    ]) {
      const written: string[] = [];
      const result = await runExport(plan, {
        psql: fakePsql(options).psql,
        writeTsv: async (path) => void written.push(path),
      });
      expect(result.ok).toBe(false);
      expect(written).toEqual([]);
    }
  });
});
