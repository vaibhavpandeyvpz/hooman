/**
 * Conversion from standard JSON Schema (what Strands emits for tool specs via
 * `z.toJSONSchema`) into node-llama-cpp's GBNF JSON schema subset.
 *
 * The GBNF subset (see node-llama-cpp `GbnfJsonSchema`) differs from JSON
 * Schema in ways that break real tool schemas:
 * - `anyOf`/`allOf` are not supported (only `oneOf`); a schema without a
 *   recognized shape falls through to an "immutable type" check and throws
 *   `Unknown immutable type undefined` at generation time.
 * - Every property listed under `properties` is treated as required — there
 *   is no way to express an optional key. We encode optionals as
 *   `oneOf: [<schema>, { type: "null" }]` and strip the `null`s from the
 *   generated params afterwards ({@link pruneOptionalNulls}).
 * - Only `date-time`/`time`/`date` string formats are known; numeric bounds
 *   (`minimum`/`maximum`/...), `default`, `propertyNames`, etc. are not.
 */

type JsonSchema = Record<string, unknown>;

const IMMUTABLE_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);
const GBNF_STRING_FORMATS = new Set(["date-time", "time", "date"]);

/** Grammar for "any JSON value" — used when a schema cannot be translated. */
const ANY_VALUE: object = {
  oneOf: [
    { type: ["string", "number", "boolean", "null"] },
    { type: "object", additionalProperties: true },
    { type: "array" },
  ],
};

function isObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function descriptionOf(schema: JsonSchema): { description?: string } {
  return typeof schema.description === "string" && schema.description.length
    ? { description: schema.description }
    : {};
}

/** Whether the original schema itself accepts `null` as a value. */
export function schemaAllowsNull(schema: unknown): boolean {
  if (!isObject(schema)) {
    return false;
  }
  const type = schema.type;
  if (type === "null" || (Array.isArray(type) && type.includes("null"))) {
    return true;
  }
  if (schema.const === null) {
    return true;
  }
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) {
    return true;
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[key];
    if (Array.isArray(variants) && variants.some(schemaAllowsNull)) {
      return true;
    }
  }
  return false;
}

/**
 * Convert a JSON Schema into node-llama-cpp's GBNF subset. Lossy where the
 * subset cannot express the original (numeric ranges, string formats, ...);
 * untranslatable shapes degrade to an any-JSON-value grammar rather than
 * failing generation.
 */
export function jsonSchemaToGbnf(schema: unknown): object {
  if (schema === true || schema === undefined || schema === null) {
    return ANY_VALUE;
  }
  if (!isObject(schema)) {
    return ANY_VALUE;
  }
  if (Object.keys(schema).length === 0) {
    return ANY_VALUE;
  }
  const desc = descriptionOf(schema);

  if (schema.const !== undefined) {
    const c = schema.const;
    if (
      typeof c === "string" ||
      typeof c === "number" ||
      typeof c === "boolean" ||
      c === null
    ) {
      return { const: c, ...desc };
    }
    return ANY_VALUE;
  }
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter(
      (v) =>
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null,
    );
    if (values.length > 0) {
      return { enum: values, ...desc };
    }
    return ANY_VALUE;
  }

  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : undefined;
  if (variants !== undefined) {
    if (variants.length === 0) {
      return ANY_VALUE;
    }
    if (variants.length === 1) {
      return { ...jsonSchemaToGbnf(variants[0]), ...desc };
    }
    return { oneOf: variants.map(jsonSchemaToGbnf), ...desc };
  }
  if (Array.isArray(schema.allOf)) {
    // Proper allOf merging is out of scope; a single member is common (zod
    // wraps descriptions this way), otherwise fall back to any-value.
    if (schema.allOf.length === 1) {
      return { ...jsonSchemaToGbnf(schema.allOf[0]), ...desc };
    }
    return ANY_VALUE;
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    const types = type.filter(
      (t): t is string => typeof t === "string" && IMMUTABLE_TYPES.has(t),
    );
    if (types.length === type.length && types.length > 0) {
      return { type: types, ...desc };
    }
    if (type.length > 0) {
      return {
        oneOf: type.map((t) => jsonSchemaToGbnf({ ...schema, type: t })),
        ...desc,
      };
    }
    return ANY_VALUE;
  }

  switch (type) {
    case "string": {
      const out: JsonSchema = { type: "string", ...desc };
      if (typeof schema.minLength === "number") {
        out.minLength = schema.minLength;
      }
      if (typeof schema.maxLength === "number") {
        out.maxLength = schema.maxLength;
      }
      if (
        typeof schema.format === "string" &&
        GBNF_STRING_FORMATS.has(schema.format)
      ) {
        out.format = schema.format;
      }
      return out;
    }
    case "number":
    case "integer":
    case "boolean":
    case "null":
      return { type, ...desc };
    case "object": {
      const properties = isObject(schema.properties)
        ? schema.properties
        : undefined;
      const required = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter((k): k is string => typeof k === "string")
          : [],
      );
      if (properties === undefined || Object.keys(properties).length === 0) {
        return {
          type: "object",
          additionalProperties: convertAdditionalProperties(
            schema.additionalProperties,
            true,
          ),
          ...desc,
        };
      }
      const props: Record<string, object> = {};
      for (const [key, value] of Object.entries(properties)) {
        const converted = jsonSchemaToGbnf(value);
        if (required.has(key) || schemaAllowsNull(value)) {
          props[key] = converted;
          continue;
        }
        // GBNF grammars force every listed property to be generated, so
        // optional keys accept null as an explicit "omitted" marker; the
        // nulls are pruned before the tool call is emitted.
        const note = "Optional — set to null to omit.";
        const innerDesc = isObject(value)
          ? descriptionOf(value).description
          : undefined;
        props[key] = {
          oneOf: [converted, { type: "null" }],
          description: innerDesc ? `${innerDesc} ${note}` : note,
        };
      }
      return {
        type: "object",
        properties: props,
        additionalProperties: convertAdditionalProperties(
          schema.additionalProperties,
          false,
        ),
        ...desc,
      };
    }
    case "array": {
      const out: JsonSchema = { type: "array", ...desc };
      if (schema.items !== undefined && schema.items !== true) {
        out.items = jsonSchemaToGbnf(schema.items);
      }
      if (Array.isArray(schema.prefixItems)) {
        out.prefixItems = schema.prefixItems.map(jsonSchemaToGbnf);
      }
      if (typeof schema.minItems === "number") {
        out.minItems = schema.minItems;
      }
      if (typeof schema.maxItems === "number") {
        out.maxItems = schema.maxItems;
      }
      return out;
    }
    default:
      return ANY_VALUE;
  }
}

function convertAdditionalProperties(
  value: unknown,
  fallback: boolean,
): boolean | object {
  if (value === true || value === false) {
    return value;
  }
  if (isObject(value)) {
    return jsonSchemaToGbnf(value);
  }
  return fallback;
}

/**
 * Remove `null` values that only exist because {@link jsonSchemaToGbnf}
 * encodes optional properties as `oneOf: [<schema>, null]`. Walks the value
 * together with the ORIGINAL JSON schema: a key is dropped when it is null,
 * declared optional, and the original schema does not itself allow null.
 */
export function pruneOptionalNulls(value: unknown, schema: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const s: JsonSchema = isObject(schema) ? schema : {};

  const variants = Array.isArray(s.anyOf)
    ? s.anyOf
    : Array.isArray(s.oneOf)
      ? s.oneOf
      : undefined;
  if (variants !== undefined) {
    const branch = variants.find((v) =>
      isObject(v)
        ? Array.isArray(value)
          ? v.type === "array" || v.items !== undefined
          : v.type === "object" || v.properties !== undefined
        : false,
    );
    return pruneOptionalNulls(value, branch);
  }

  if (Array.isArray(value)) {
    return value.map((item) => pruneOptionalNulls(item, s.items));
  }

  const properties = isObject(s.properties) ? s.properties : undefined;
  const required = new Set(
    Array.isArray(s.required)
      ? s.required.filter((k): k is string => typeof k === "string")
      : [],
  );
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const propSchema = properties?.[key];
    if (
      entry === null &&
      properties !== undefined &&
      propSchema !== undefined &&
      !required.has(key) &&
      !schemaAllowsNull(propSchema)
    ) {
      continue;
    }
    out[key] = pruneOptionalNulls(
      entry,
      propSchema ??
        (isObject(s.additionalProperties) ? s.additionalProperties : undefined),
    );
  }
  return out;
}
