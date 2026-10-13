import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  mergeEntities,
  parseSchemaEntities,
  readSchemaEntities,
} from "./schema-entities";

const SDL = `
# leading comment
type Trade {
  id: ID!
  token: String! @index # inline comment
  tokens: BigInt!
  logIndex: Int!
  note: String
}
type Holder {
  id: ID!
  proof: [String!]!
}
`;

describe("schema entity parser", () => {
  it("reads entities, field types and lists", () => {
    const [trade, holder] = parseSchemaEntities(SDL);
    expect(trade?.name).toBe("Trade");
    expect(trade?.fields.map((field) => field.name)).toEqual([
      "id",
      "token",
      "tokens",
      "logIndex",
      "note",
    ]);
    expect(trade?.fields[1]).toEqual({
      name: "token",
      type: "String",
      required: true,
      list: false,
    });
    expect(trade?.fields[4]).toMatchObject({ type: "String", required: false });
    expect(holder?.fields[1]).toMatchObject({
      type: "String",
      list: true,
      required: true,
    });
  });

  it("refuses a field line it cannot read instead of dropping it", () => {
    expect(() => parseSchemaEntities("type A {\n  id: ID!\n  oops\n}")).toThrow(
      /oops/,
    );
  });

  it("refuses an entity without an id", () => {
    expect(() => parseSchemaEntities("type A {\n  name: String\n}")).toThrow(
      /id/,
    );
  });

  it("keeps identical duplicates and refuses conflicting ones", () => {
    const one = parseSchemaEntities("type A {\n  id: ID!\n  x: Int!\n}");
    const same = parseSchemaEntities("type A {\n  id: ID!\n  x: Int!\n}");
    const other = parseSchemaEntities("type A {\n  id: ID!\n  x: BigInt!\n}");
    expect(mergeEntities([one, same])).toHaveLength(1);
    expect(() => mergeEntities([one, other])).toThrow(/conflicting/);
  });

  it("reads the real indexer schema", () => {
    const entities = readSchemaEntities([
      fileURLToPath(
        new URL("../schema.graphql", import.meta.url),
      ),
    ]);
    const names = entities.map((entity) => entity.name);
    expect(names).toContain("Launch");
    expect(names).toContain("ProLaunch");
    expect(names).toContain("TradeDexToken");
    expect(entities.length).toBeGreaterThanOrEqual(54);
    for (const entity of entities) expect(entity.fields[0]?.name).toBe("id");
  });
});
