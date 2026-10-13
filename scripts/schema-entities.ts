import { readFileSync } from "node:fs";

/**
 * Minimal reader for the entity SDL in schema.graphql (and the terminal-feed copy). The schema only
 * uses scalar fields, `[T!]!` lists and `@index`, so anything else is refused rather than guessed.
 */
export type SchemaField = Readonly<{
  name: string;
  type: string;
  required: boolean;
  list: boolean;
}>;
export type SchemaEntity = Readonly<{
  name: string;
  fields: readonly SchemaField[];
}>;

const FIELD =
  /^([A-Za-z_][A-Za-z0-9_]*):\s*(\[)?([A-Za-z][A-Za-z0-9_]*)(!)?(\])?(!)?\s*((?:@\w+\s*)*)$/;

function parseField(line: string, entity: string): SchemaField {
  const match = FIELD.exec(line);
  if (!match) throw new Error(`Cannot read schema line in ${entity}: ${line}`);
  const [, name, open, type, innerBang, close, outerBang] = match;
  if (Boolean(open) !== Boolean(close))
    throw new Error(`Cannot read schema line in ${entity}: ${line}`);
  return {
    name: name as string,
    type: type as string,
    list: Boolean(open),
    required: open ? Boolean(outerBang) : Boolean(innerBang),
  };
}

export function parseSchemaEntities(sdl: string): SchemaEntity[] {
  const entities: SchemaEntity[] = [];
  let current: { name: string; fields: SchemaField[] } | undefined;
  for (const raw of sdl.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const open = /^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{$/.exec(line);
    if (open) {
      current = { name: open[1] as string, fields: [] };
    } else if (line === "}" && current) {
      if (current.fields[0]?.name !== "id")
        throw new Error(`Entity ${current.name} has no leading id field.`);
      entities.push(current);
      current = undefined;
    } else if (current) {
      current.fields.push(parseField(line, current.name));
    } else {
      throw new Error(`Cannot read schema line: ${line}`);
    }
  }
  if (current) throw new Error(`Entity ${current.name} is not closed.`);
  return entities;
}

/** First definition wins; a second definition must be identical (TradeFeed lives in two schema files). */
export function mergeEntities(
  lists: readonly (readonly SchemaEntity[])[],
): SchemaEntity[] {
  const merged = new Map<string, SchemaEntity>();
  for (const entity of lists.flat()) {
    const known = merged.get(entity.name);
    if (!known) merged.set(entity.name, entity);
    else if (JSON.stringify(known) !== JSON.stringify(entity))
      throw new Error(
        `Schema files hold conflicting definitions of ${entity.name}.`,
      );
  }
  return [...merged.values()];
}

export function readSchemaEntities(paths: readonly string[]): SchemaEntity[] {
  return mergeEntities(
    paths.map((path) => parseSchemaEntities(readFileSync(path, "utf8"))),
  );
}
