import { describe, expect, it } from "vitest";
import { quoteIdent, quoteLiteral, safeIdent } from "./pg-ident";

describe("postgres identifiers and literals", () => {
  it("double-quotes identifiers and doubles embedded quotes", () => {
    expect(quoteIdent("Trade")).toBe('"Trade"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });

  it("refuses empty and NUL-carrying names", () => {
    expect(() => quoteIdent("")).toThrow(/identifier/);
    expect(() => quoteIdent("a\0b")).toThrow(/identifier/);
  });

  it("quotes literals and refuses NUL", () => {
    expect(quoteLiteral("it's")).toBe("'it''s'");
    expect(() => quoteLiteral("a\0b")).toThrow(/literal/);
  });

  it("accepts only plain identifiers from the schema file", () => {
    expect(safeIdent("blockNumber")).toBe("blockNumber");
    expect(safeIdent("_x1")).toBe("_x1");
    for (const bad of ["", "1a", 'a"b', "a b", "a;drop", "a-b"])
      expect(() => safeIdent(bad)).toThrow(/identifier/);
  });
});
