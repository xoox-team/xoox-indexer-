import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../../schema.graphql");

/** The TradeFeed block with its leading comment lines, as the source declares it. */
function tradeFeedBlock(text: string): string {
  const match = /(?:^#[^\n]*\n)*^type TradeFeed \{[^}]*\}\n/m.exec(text);
  expect(match, "TradeFeed type").not.toBeNull();
  return match![0];
}

/** Field name to whether it carries `@index`, in schema order. */
function schemaFields(): Map<string, boolean> {
  const body = /type TradeFeed \{([^}]*)\}/.exec(schema)?.[1];
  expect(body, "TradeFeed type").toBeDefined();
  return new Map(
    [...body!.matchAll(/^\s*(\w+):\s*[^\n#]*?(@index)?\s*(?:#.*)?$/gm)].map(
      (match) => [match[1]!, match[2] !== undefined],
    ),
  );
}

describe("TradeFeed schema", () => {
  const indexed = [
    "blockNumber",
    "seq",
    "timestamp",
    "token",
    "transactionHash",
    "wallet",
  ];

  it("declares the entity once", () => {
    expect(schema.match(/^type TradeFeed \{/gm)).toHaveLength(1);
  });

  it("indexes every column a reader filters or orders by, including transaction lookups", () => {
    const fields = schemaFields();
    expect(fields.size).toBe(17);
    expect(
      [...fields]
        .filter(([, isIndexed]) => isIndexed)
        .map(([name]) => name)
        .sort(),
    ).toEqual(indexed);
  });

  it("is the terminal-feed entity, verbatim", () => {
    const source = read(
      "../../test-fixtures/terminal-feed/schema.graphql",
    );
    expect(tradeFeedBlock(schema)).toBe(source);
  });
});
