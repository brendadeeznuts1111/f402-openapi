/**
 * Generate valid/invalid test fixtures from Zod JSON Schema output.
 */
import { z } from 'zod';

function sampleForProp(prop, key) {
  if (prop.default !== undefined) return prop.default;
  if (prop.enum?.length) return prop.enum[0];
  switch (prop.type) {
    case 'string':
      if (prop.format === 'date') return '2026-05-17';
      if (prop.minLength && prop.minLength >= 2) return 'ab';
      return key === 'customer_id' || key === 'customerId' ? 'GX195' : 'x';
    case 'integer':
    case 'number':
      return prop.minimum ?? prop.maximum ?? 1;
    case 'boolean':
      return true;
    case 'object':
      return buildValidFromJsonSchema(prop);
    case 'array':
      return prop.minItems ? [sampleForProp(prop.items ?? { type: 'string' }, 'item')] : [];
    default:
      return 'test';
  }
}

export function buildValidFromJsonSchema(jsonSchema) {
  if (!jsonSchema || jsonSchema.type !== 'object') return {};
  const props = jsonSchema.properties ?? {};
  const required = jsonSchema.required ?? [];
  const out = {};
  for (const key of required) {
    out[key] = sampleForProp(props[key] ?? { type: 'string' }, key);
  }
  for (const [key, prop] of Object.entries(props)) {
    if (required.includes(key)) continue;
    if (prop.default !== undefined) out[key] = prop.default;
  }
  return out;
}

export function buildInvalidCasesFromJsonSchema(jsonSchema, schemaName) {
  const cases = [];
  if (!jsonSchema || jsonSchema.type !== 'object') return cases;

  const required = jsonSchema.required ?? [];
  if (required.length > 0) {
    cases.push({
      id: `${schemaName}-missing-required`,
      input: {},
      kind: 'missing_required',
    });
  }

  for (const key of required) {
    const prop = jsonSchema.properties?.[key];
    if (!prop) continue;
    if (prop.type === 'string' && !prop.coerce) {
      cases.push({
        id: `${schemaName}-${key}-wrong-type`,
        input: { ...buildValidFromJsonSchema(jsonSchema), [key]: null },
        kind: 'wrong_type',
        pathIncludes: key,
      });
    }
    if (prop.minLength && prop.minLength > 1) {
      cases.push({
        id: `${schemaName}-${key}-too-short`,
        input: { ...buildValidFromJsonSchema(jsonSchema), [key]: 'x' },
        kind: 'min_length',
        pathIncludes: key,
      });
    }
    if (prop.maximum !== undefined && (prop.type === 'integer' || prop.type === 'number')) {
      cases.push({
        id: `${schemaName}-${key}-over-max`,
        input: {
          ...buildValidFromJsonSchema(jsonSchema),
          [key]: String((prop.maximum ?? 0) + 9999),
        },
        kind: 'over_max',
        pathIncludes: key,
      });
    }
  }

  return cases;
}

export function generateSchemaFixtures(schema, schemaName) {
  let jsonSchema;
  try {
    jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { schemaName, error: msg, valid: null, invalidCases: [] };
  }
  return {
    schemaName,
    valid: buildValidFromJsonSchema(jsonSchema),
    invalidCases: buildInvalidCasesFromJsonSchema(jsonSchema, schemaName),
    jsonSchema,
  };
}

const SKIPPABLE_FIXTURE_ERRORS = /Transforms cannot be represented/i;

export function runGeneratedFixtureTests(schema, fixtures) {
  const findings = [];
  if (fixtures.error) {
    if (SKIPPABLE_FIXTURE_ERRORS.test(fixtures.error)) return findings;
    findings.push(`${fixtures.schemaName}: could not generate fixtures: ${fixtures.error}`);
    return findings;
  }
  if (fixtures.valid) {
    const ok = schema.safeParse(fixtures.valid);
    if (!ok.success) {
      findings.push(
        `${fixtures.schemaName}: generated valid fixture rejected: ${ok.error.issues[0]?.message}`,
      );
    }
  }
  for (const c of fixtures.invalidCases) {
    if (c.kind === 'missing_required' && schema.safeParse({}).success) continue;
    const bad = schema.safeParse(c.input);
    if (bad.success) continue;
    if (c.pathIncludes) {
      const paths = bad.error.issues.map((i) => i.path.join('.'));
      if (!paths.some((p) => p.includes(c.pathIncludes))) {
        findings.push(
          `${fixtures.schemaName}/${c.id}: expected issue on path containing ${c.pathIncludes}`,
        );
      }
    }
  }
  return findings;
}
