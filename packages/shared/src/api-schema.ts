/** Small, deterministic schema subset shared by HTTP, MCP, and publisher validation. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Schema {
  type?: "string" | "integer" | "number" | "boolean" | "object" | "array";
  const?: string | number | boolean;
  enum?: readonly (string | number)[];
  ref?: string;
  anyOf?: readonly Schema[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export function validateSchema(schema: Schema, value: unknown, types: Record<string, Schema> = {}, depth = 0): boolean {
  if (depth > 40 || value === undefined) return false;
  const check = (s: Schema, v: unknown) => validateSchema(s, v, types, depth + 1);
  if (schema.ref) return Object.hasOwn(types, schema.ref) && check(types[schema.ref], value);
  if (schema.anyOf) return schema.anyOf.some((s) => check(s, value));
  if (schema.const !== undefined) return value === schema.const;
  if (schema.enum && !schema.enum.includes(value as string | number)) return false;
  switch (schema.type) {
    case "string": return typeof value === "string" && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 900_000) && (!schema.pattern || new RegExp(schema.pattern).test(value));
    case "integer":
    case "number": return typeof value === "number" && Number.isFinite(value) && (schema.type !== "integer" || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? 1000) && value.every((v) => schema.items && check(schema.items, v));
    case "object": {
      if (!isRecord(value)) return false;
      const props = schema.properties ?? {};
      if (schema.required?.some((key) => !Object.hasOwn(value, key))) return false;
      return Object.entries(value).every(([key, v]) => Object.hasOwn(props, key) ? check(props[key], v) : schema.additionalProperties === true);
    }
    default: return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Secrets must be referenced by name; neither arbitrary paths nor executable TL constructors are accepted. */
export function safeApiInput(value: unknown, depth = 0): boolean {
  if (depth > 40) return false;
  if (typeof value === "string") return !/\d{6,12}:[A-Za-z0-9_-]{20,}/.test(value);
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key, child]) =>
    !["__proto__", "prototype", "constructor", "session", "api_hash", "apiHash", "access_hash", "accessHash", "password", "token"].includes(key) &&
    (key !== "secretEnvName" || typeof child === "string" && /^TELEGRAM_(?:WEBHOOK_SECRET|PAYMENT_PROVIDER_[A-Z0-9_]{1,40})$/.test(child)) &&
    safeApiInput(child, depth + 1),
  );
}

/** Convert the internal refs into ordinary JSON Schema for MCP/discovery. */
export function publicSchema(schema: Schema, types: Record<string, Schema> = {}): Record<string, unknown> {
  const used = new Set<string>();
  function map(s: Schema): Record<string, unknown> {
    if (s.ref) { used.add(s.ref); return { $ref: `#/$defs/${s.ref}` }; }
    return { ...s, ...(s.anyOf ? { anyOf: s.anyOf.map(map) } : {}), ...(s.items ? { items: map(s.items) } : {}), ...(s.properties ? { properties: Object.fromEntries(Object.entries(s.properties).map(([k,v]) => [k,map(v)])) } : {}) };
  }
  const result = map(schema);
  const defs: Record<string, unknown> = {};
  for (const name of used) if (types[name]) defs[name] = map(types[name]);
  return { ...result, ...(used.size ? { $defs: defs } : {}) };
}
