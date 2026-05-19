/**
 * Stable Zod schema fingerprints via JSON Schema (Zod 4 z.toJSONSchema).
 */
import { z } from 'zod';

/** Normalize JSON Schema for snapshot comparison (drop volatile $schema URL). */
export function normalizeJsonSchema(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { $schema, ...rest } = doc;
  return sortSchemaNode(rest);
}

function sortSchemaNode(node) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(sortSchemaNode);
  const out = {};
  for (const key of Object.keys(node).sort()) {
    if (key === 'description') continue;
    out[key] = sortSchemaNode(node[key]);
  }
  return out;
}

export function zodToFingerprint(schema) {
  try {
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
    return normalizeJsonSchema(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { _error: msg, _type: schema?.constructor?.name ?? 'unknown' };
  }
}

/** Build a map of schema export name → fingerprint for snapshotting. */
export function fingerprintSchemaMap(schemaEntries) {
  const map = {};
  const names = Object.keys(schemaEntries).filter((k) => k.endsWith('Schema')).sort();
  for (const name of names) {
    map[name] = zodToFingerprint(schemaEntries[name]);
  }
  return map;
}

/** Compact OpenAPI components.schemas for snapshots (structure only). */
export function fingerprintOpenApiSchemas(openApiSpec) {
  const schemas = openApiSpec?.components?.schemas ?? {};
  const map = {};
  for (const name of Object.keys(schemas).sort()) {
    map[name] = normalizeOpenApiComponent(schemas[name]);
  }
  return map;
}

function normalizeOpenApiComponent(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return { $ref: schema.$ref };
  const out = { type: schema.type };
  if (schema.required) out.required = [...schema.required].sort();
  if (schema.enum) out.enum = [...schema.enum];
  if (schema.additionalProperties !== undefined) {
    out.additionalProperties = schema.additionalProperties;
  }
  if (schema.properties) {
    out.properties = {};
    for (const key of Object.keys(schema.properties).sort()) {
      out.properties[key] = normalizeOpenApiComponent(schema.properties[key]);
    }
  }
  if (schema.items) out.items = normalizeOpenApiComponent(schema.items);
  if (schema.allOf) out.allOf = schema.allOf.map(normalizeOpenApiComponent);
  if (schema.oneOf) out.oneOf = schema.oneOf.map(normalizeOpenApiComponent);
  if (schema.anyOf) out.anyOf = schema.anyOf.map(normalizeOpenApiComponent);
  return out;
}
