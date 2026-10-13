/** Quoting helpers for the generated read-only SQL. Mirrors how Envio quotes schema and table names (PgStorage.res). */

export function quoteIdent(name: string): string {
  if (!name || name.includes("\0")) throw new Error("Invalid SQL identifier.");
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteLiteral(value: string): string {
  if (value.includes("\0")) throw new Error("Invalid SQL literal.");
  return `'${value.replaceAll("'", "''")}'`;
}

const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names that come from the schema file or a CLI flag must be plain identifiers, never quoted tricks. */
export function safeIdent(name: string): string {
  if (!PLAIN_IDENT.test(name))
    throw new Error(`Invalid SQL identifier: ${JSON.stringify(name)}.`);
  return name;
}
