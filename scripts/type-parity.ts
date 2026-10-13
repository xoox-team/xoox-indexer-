import { fileURLToPath } from "node:url";
import { isEntry } from "./is-entry";
import { readSchemaEntities, type SchemaEntity } from "./schema-entities";

/**
 * Type-parity probe (plan P3 step 2): are the xoox-one Hasura's column types, and the JSON value kinds it serves,
 * the same as the old live Hasura's? The web parses strictly (terminal-feed-attribution.ts rejects a number where it
 * wants the string latest_processed_block), so a wrong kind is an outage after the cutover.
 *
 * Read-only: one introspection and one LIMIT 1 sample query per endpoint. Endpoints come from env, secrets are sent
 * only as the x-hasura-admin-secret header of their own endpoint and are never printed:
 *   PARITY_SOURCE_GRAPHQL_URL / PARITY_SOURCE_ADMIN_SECRET   the old live Hasura (what the web parses today)
 *   PARITY_TARGET_GRAPHQL_URL / PARITY_TARGET_ADMIN_SECRET   the xoox-one Hasura
 * The target may be a superset: only the source's types and fields must exist there with the same signature.
 */
export type TypeMap = ReadonlyMap<string, ReadonlyMap<string, string>>;
export type ValueKind =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "null";
export type Rows = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
export type KindDiff = Readonly<{
  entity: string;
  field: string;
  source: ValueKind;
  target: ValueKind;
}>;
export type SchemaDiff = Readonly<{
  missingTypes: string[];
  missingFields: string[];
  mismatches: { type: string; field: string; source: string; target: string }[];
  extraTypes: number;
}>;
export type Endpoint = Readonly<{ url: string; secret: string }>;

const QUERY_ROOT = "query_root";
export const INTROSPECTION_QUERY =
  "query TypeParity { __schema { types { kind name fields { name type { ...T } } } } } " +
  "fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }";

export type TypeRef = {
  kind?: string;
  name?: string | null;
  ofType?: TypeRef | null;
};

export function typeSignature(type: TypeRef): string {
  if (type.kind === "NON_NULL")
    return `${typeSignature(type.ofType as TypeRef)}!`;
  if (type.kind === "LIST") return `[${typeSignature(type.ofType as TypeRef)}]`;
  return type.name ?? "?";
}

/** Object types (table rows, aggregates, query_root) mapped to their field signatures; introspection types dropped. */
export function parseIntrospection(json: unknown): TypeMap {
  const types = (
    json as { data?: { __schema?: { types?: unknown } } } | undefined
  )?.data?.__schema?.types;
  if (!Array.isArray(types))
    throw new Error("The response is not a GraphQL introspection result.");
  const parsed = new Map<string, Map<string, string>>();
  for (const type of types as {
    kind?: string;
    name?: string;
    fields?: { name: string; type: TypeRef }[] | null;
  }[]) {
    if (
      type.kind !== "OBJECT" ||
      !type.name ||
      type.name.startsWith("__") ||
      !Array.isArray(type.fields)
    )
      continue;
    parsed.set(
      type.name,
      new Map(
        type.fields.map((field) => [field.name, typeSignature(field.type)]),
      ),
    );
  }
  return parsed;
}

export function compareSchemas(source: TypeMap, target: TypeMap): SchemaDiff {
  const diff: SchemaDiff = {
    missingTypes: [],
    missingFields: [],
    mismatches: [],
    extraTypes: 0,
  };
  for (const [type, fields] of source) {
    const counterpart = target.get(type);
    if (!counterpart) {
      diff.missingTypes.push(type);
      continue;
    }
    for (const [field, signature] of fields) {
      const other = counterpart.get(field);
      if (other === undefined) diff.missingFields.push(`${type}.${field}`);
      else if (other !== signature)
        diff.mismatches.push({ type, field, source: signature, target: other });
    }
  }
  return {
    ...diff,
    extraTypes: [...target.keys()].filter((type) => !source.has(type)).length,
  };
}

export function valueKind(value: unknown): ValueKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  return kind === "string" || kind === "number" || kind === "boolean"
    ? kind
    : "object";
}

const SCALAR_KINDS: Readonly<Record<string, ValueKind>> = {
  ID: "string",
  String: "string",
  BigInt: "string", // numeric; the Hasura runs with HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES=true
  Int: "number",
  Float: "number",
  Boolean: "boolean",
};

/** What the web parses: entity scalars by schema type, plus the chain_metadata cursor types named in plan P3 step 2. */
export function expectedKinds(
  entities: readonly SchemaEntity[],
): Map<string, ValueKind> {
  const expected = new Map<string, ValueKind>([
    ["chain_metadata.chain_id", "number"],
    ["chain_metadata.latest_processed_block", "string"],
  ]);
  for (const entity of entities)
    for (const field of entity.fields) {
      const kind = field.list ? "array" : SCALAR_KINDS[field.type];
      if (kind) expected.set(`${entity.name}.${field.name}`, kind);
    }
  return expected;
}

/** Entities the endpoint serves (a query_root field) with the columns it really has; chain_metadata is always asked for. */
function sampled(
  entities: readonly SchemaEntity[],
  schema: TypeMap,
): { name: string; fields: string[] }[] {
  const roots = schema.get(QUERY_ROOT);
  const chainMetadata = {
    name: "chain_metadata",
    fields: ["chain_id", "latest_processed_block"],
  };
  return [
    ...entities.map((entity) => ({
      name: entity.name,
      fields: entity.fields.map((field) => field.name),
    })),
    chainMetadata,
  ]
    .filter((entity) => roots?.has(entity.name))
    .map((entity) => ({
      name: entity.name,
      fields: entity.fields.filter((field) =>
        schema.get(entity.name)?.has(field),
      ),
    }))
    .filter((entity) => entity.fields.length);
}

export function sampleQuery(
  entities: readonly SchemaEntity[],
  schema: TypeMap,
): string {
  const selections = sampled(entities, schema).map(
    (entity) => `  ${entity.name}(limit: 1) { ${entity.fields.join(" ")} }`,
  );
  return `query TypeParitySample {\n${selections.join("\n")}\n}`;
}

export function compareKinds(source: Rows, target: Rows): KindDiff[] {
  const diffs: KindDiff[] = [];
  for (const [entity, row] of Object.entries(source))
    for (const [field, value] of Object.entries(row)) {
      const mine = valueKind(value);
      const theirs = valueKind(target[entity]?.[field]);
      if (mine !== "null" && theirs !== "null" && mine !== theirs)
        diffs.push({ entity, field, source: mine, target: theirs });
    }
  return diffs;
}

/** `source` in the result is the expected kind. */
export function checkExpectedKinds(
  target: Rows,
  expected: ReadonlyMap<string, ValueKind>,
): KindDiff[] {
  const diffs: KindDiff[] = [];
  for (const [entity, row] of Object.entries(target))
    for (const [field, value] of Object.entries(row)) {
      const want = expected.get(`${entity}.${field}`);
      const got = valueKind(value);
      if (want && got !== "null" && got !== want)
        diffs.push({ entity, field, source: want, target: got });
    }
  return diffs;
}

function endpointFrom(
  env: Readonly<Record<string, string | undefined>>,
  side: "SOURCE" | "TARGET",
): Endpoint {
  const urlName = `PARITY_${side}_GRAPHQL_URL`;
  const secretName = `PARITY_${side}_ADMIN_SECRET`;
  const secret = env[secretName];
  if (!secret) throw new Error(`${secretName} is not set.`);
  let url: URL;
  try {
    url = new URL(env[urlName] ?? "");
  } catch {
    throw new Error(`${urlName} is not set to a URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${urlName} must be an http(s) URL.`);
  if (url.username || url.password)
    throw new Error(
      `${urlName} must not contain credentials; use ${secretName}.`,
    );
  return { url: url.href, secret };
}

export function readEndpoints(
  env: Readonly<Record<string, string | undefined>>,
): { source: Endpoint; target: Endpoint } {
  return {
    source: endpointFrom(env, "SOURCE"),
    target: endpointFrom(env, "TARGET"),
  };
}

async function graphql(
  fetchFn: typeof fetch,
  label: string,
  endpoint: Endpoint,
  query: string,
): Promise<unknown> {
  const response = await fetchFn(endpoint.url, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-hasura-admin-secret": endpoint.secret,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`The ${label} endpoint answered HTTP ${response.status}.`);
  const json = (await response.json()) as { errors?: unknown; data?: unknown };
  if (json.errors)
    throw new Error(`The ${label} endpoint returned GraphQL errors.`);
  return json;
}

function firstRows(json: unknown): Rows {
  const data = (json as { data?: Record<string, unknown> }).data ?? {};
  return Object.fromEntries(
    Object.entries(data).flatMap(([name, rows]) =>
      Array.isArray(rows) && rows[0] && typeof rows[0] === "object"
        ? [[name, rows[0] as Record<string, unknown>]]
        : [],
    ),
  );
}

export async function runTypeParity(
  env: Readonly<Record<string, string | undefined>>,
  entities: readonly SchemaEntity[],
  fetchFn: typeof fetch,
): Promise<{ ok: boolean; lines: string[] }> {
  const { source, target } = readEndpoints(env);
  const [sourceSchema, targetSchema] = [
    parseIntrospection(
      await graphql(fetchFn, "source", source, INTROSPECTION_QUERY),
    ),
    parseIntrospection(
      await graphql(fetchFn, "target", target, INTROSPECTION_QUERY),
    ),
  ];
  const schema = compareSchemas(sourceSchema, targetSchema);
  const [sourceRows, targetRows] = [
    firstRows(
      await graphql(
        fetchFn,
        "source",
        source,
        sampleQuery(entities, sourceSchema),
      ),
    ),
    firstRows(
      await graphql(
        fetchFn,
        "target",
        target,
        sampleQuery(entities, targetSchema),
      ),
    ),
  ];
  const kinds = compareKinds(sourceRows, targetRows);
  const expected = checkExpectedKinds(targetRows, expectedKinds(entities));
  const lines = [
    `schema: ${sourceSchema.size} source object types compared, ${schema.extraTypes} extra in the target`,
    ...schema.missingTypes.map((type) => `MISSING TYPE ${type}`),
    ...schema.missingFields.map((field) => `MISSING FIELD ${field}`),
    ...schema.mismatches.map(
      (item) =>
        `COLUMN TYPE ${item.type}.${item.field}: source ${item.source}, target ${item.target}`,
    ),
    ...kinds.map(
      (item) =>
        `VALUE KIND ${item.entity}.${item.field}: source ${item.source}, target ${item.target}`,
    ),
    ...expected.map(
      (item) =>
        `UNEXPECTED KIND ${item.entity}.${item.field}: the web needs ${item.source}, target serves ${item.target}`,
    ),
  ];
  const ok =
    !schema.missingTypes.length &&
    !schema.missingFields.length &&
    !schema.mismatches.length &&
    !kinds.length &&
    !expected.length;
  return { ok, lines };
}

if (isEntry(import.meta.url)) {
  const schemaFiles = [
    fileURLToPath(
      new URL("../schema.graphql", import.meta.url),
    ),
    fileURLToPath(
      new URL(
        "../test-fixtures/terminal-feed/schema.graphql",
        import.meta.url,
      ),
    ),
  ];
  runTypeParity(process.env, readSchemaEntities(schemaFiles), fetch).then(
    ({ ok, lines }) => {
      for (const line of lines) console.log(line);
      console.log(ok ? "Type parity holds." : "Type parity FAILED.");
      process.exitCode = ok ? 0 : 1;
    },
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message : "Type parity probe failed.",
      );
      process.exitCode = 1;
    },
  );
}
