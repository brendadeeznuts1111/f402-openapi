/**
 * Lightweight OpenAPI component schema validation (Ajv) aligned with snapshots.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: false });
/** @type {(ajv: import('ajv').default) => void} */
const applyFormats = /** @type {any} */ (addFormats).default ?? addFormats;
applyFormats(ajv);

export function resolveComponentSchema(schema, components, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) {
    const m = schema.$ref.match(/^#\/components\/schemas\/(.+)$/);
    if (!m) throw new Error(`unsupported $ref: ${schema.$ref}`);
    if (seen.has(m[1])) return schema;
    seen.add(m[1]);
    const resolved = components[m[1]];
    if (!resolved) throw new Error(`unresolved $ref: ${schema.$ref}`);
    return resolveComponentSchema(resolved, components, seen);
  }
  const out = { ...schema };
  delete out.$ref;
  if (out.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = resolveComponentSchema(v, components, new Set(seen));
    }
  }
  if (out.items) out.items = resolveComponentSchema(out.items, components, new Set(seen));
  if (out.allOf) out.allOf = out.allOf.map((s) => resolveComponentSchema(s, components, new Set(seen)));
  if (out.oneOf) out.oneOf = out.oneOf.map((s) => resolveComponentSchema(s, components, new Set(seen)));
  if (out.anyOf) out.anyOf = out.anyOf.map((s) => resolveComponentSchema(s, components, new Set(seen)));
  return out;
}

export function compileOpenApiSchema(schemaName, openApiSpec) {
  const components = openApiSpec?.components?.schemas ?? {};
  const raw = components[schemaName];
  if (!raw) throw new Error(`missing components.schemas.${schemaName}`);
  const resolved = resolveComponentSchema(raw, components);
  return ajv.compile(resolved);
}

export function validateOpenApiSample(schemaName, payload, openApiSpec) {
  const validate = compileOpenApiSchema(schemaName, openApiSpec);
  const ok = validate(payload);
  return {
    ok: !!ok,
    errors: validate.errors ?? [],
  };
}

export function runOpenApiSampleCases(samples, openApiSpec, snapshotSchemas) {
  const findings = [];
  const snapKeys = new Set(Object.keys(snapshotSchemas ?? {}));
  const liveKeys = new Set(Object.keys(openApiSpec?.components?.schemas ?? {}));

  for (const k of snapKeys) {
    if (!liveKeys.has(k)) findings.push(`snapshot schema ${k} missing from live OpenAPI`);
  }

  for (const entry of samples ?? []) {
    if (entry.valid !== undefined) {
      const result = validateOpenApiSample(entry.schema, entry.valid, openApiSpec);
      if (!result.ok) {
        findings.push(
          `${entry.schema} valid sample failed Ajv: ${result.errors[0]?.message ?? 'unknown'}`,
        );
      }
    }
    if (entry.invalid !== undefined) {
      const result = validateOpenApiSample(entry.schema, entry.invalid, openApiSpec);
      if (result.ok) {
        findings.push(`${entry.schema} invalid sample unexpectedly passed Ajv`);
      }
    }
    if (snapKeys.has(entry.schema)) {
      const snap = snapshotSchemas[entry.schema];
      if (snap?.type && entry.expectType && snap.type !== entry.expectType) {
        findings.push(`${entry.schema} snapshot type ${snap.type} != ${entry.expectType}`);
      }
    }
  }

  return findings;
}
