import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname } from "node:path";
import { URL, fileURLToPath } from "node:url";
import {
  z,
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodEffects,
  ZodEnum,
  ZodLiteral,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodRecord,
  ZodString,
  ZodUnion,
  ZodUnknown,
  type ZodRawShape,
  type ZodTypeAny,
} from "zod";

export function describeZodSchema(schema: ZodTypeAny): unknown {
  if (schema instanceof ZodEffects) {
    return {
      type: "effects",
      effect: schema._def.effect.type,
      inner: describeZodSchema(schema._def.schema),
    };
  }

  if (schema instanceof ZodObject) {
    const shape = schema.shape as ZodRawShape;
    return {
      type: "object",
      unknownKeys: schema._def.unknownKeys,
      properties: Object.fromEntries(
        Object.entries(shape)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, describeZodSchema(value)]),
      ),
      required: Object.entries(shape)
        .filter(([, value]) => !(value instanceof ZodOptional))
        .map(([key]) => key)
        .sort(),
    };
  }

  if (schema instanceof ZodString) {
    return {
      type: "string",
      checks: schema._def.checks.map((check) => ({ ...check })).sort((left, right) => left.kind.localeCompare(right.kind)),
    };
  }

  if (schema instanceof ZodNumber) {
    return {
      type: "number",
      checks: schema._def.checks.map((check) => ({ ...check })).sort((left, right) => left.kind.localeCompare(right.kind)),
    };
  }

  if (schema instanceof ZodBoolean) return { type: "boolean" };
  if (schema instanceof ZodLiteral) return { type: "literal", value: schema._def.value };
  if (schema instanceof ZodEnum) return { type: "enum", values: [...schema._def.values].sort() };
  if (schema instanceof ZodUnion) return { type: "union", options: schema._def.options.map(describeZodSchema) };
  if (schema instanceof ZodArray) return { type: "array", item: describeZodSchema(schema._def.type) };
  if (schema instanceof ZodNullable) return { type: "nullable", inner: describeZodSchema(schema._def.innerType) };
  if (schema instanceof ZodOptional) return { type: "optional", inner: describeZodSchema(schema._def.innerType) };
  if (schema instanceof ZodDefault) return { type: "default", inner: describeZodSchema(schema._def.innerType) };
  if (schema instanceof ZodRecord) return { type: "record", value: describeZodSchema(schema._def.valueType) };

  return { type: schema._def.typeName };
}

export function validFixture<TSchema extends ZodTypeAny>(schema: TSchema): z.infer<TSchema> {
  return buildValidFixture(schema) as z.infer<TSchema>;
}

function buildValidFixture(schema: ZodTypeAny): unknown {
  if (schema instanceof ZodEffects) return buildValidFixture(schema._def.schema);
  if (schema instanceof ZodDefault) return buildValidFixture(schema._def.innerType);
  if (schema instanceof ZodOptional) return buildValidFixture(schema._def.innerType);
  if (schema instanceof ZodNullable) return buildValidFixture(schema._def.innerType);
  if (schema instanceof ZodArray) return [buildValidFixture(schema._def.type)];
  if (schema instanceof ZodRecord) return { example: buildValidFixture(schema._def.valueType) };
  if (schema instanceof ZodLiteral) return schema._def.value;
  if (schema instanceof ZodEnum) return schema._def.values[0];
  if (schema instanceof ZodUnion) return buildValidFixture(schema._def.options[0]);
  if (schema instanceof ZodUnknown) return "value";
  if (schema instanceof ZodBoolean) return false;

  if (schema instanceof ZodNumber) {
    const min = schema._def.checks.find((check) => check.kind === "min");
    return typeof min?.value === "number" ? min.value : 1;
  }

  if (schema instanceof ZodString) {
    if (schema._def.checks.some((check) => check.kind === "uuid")) return "00000000-0000-4000-8000-000000000000";
    if (schema._def.checks.some((check) => check.kind === "datetime")) return "2026-05-17T00:00:00.000Z";
    if (schema._def.checks.some((check) => check.kind === "url")) return "https://fantasy402.com";
    const startsWith = schema._def.checks.find((check): check is z.ZodStringCheck & { kind: "startsWith"; value: string } => check.kind === "startsWith");
    if (startsWith) return `${startsWith.value}fixture.json`;
    return "value";
  }

  if (schema instanceof ZodObject) {
    return Object.fromEntries(Object.entries(schema.shape as ZodRawShape).map(([key, value]) => [key, buildValidFixture(value)]));
  }

  throw new Error(`No fixture generator for ${schema._def.typeName}`);
}

export function invalidFixture(schema: ZodTypeAny): unknown {
  if (schema instanceof ZodEffects) return invalidFixture(schema._def.schema);
  if (schema instanceof ZodDefault) return invalidFixture(schema._def.innerType);
  if (schema instanceof ZodOptional) return invalidFixture(schema._def.innerType);
  if (schema instanceof ZodNullable) return invalidFixture(schema._def.innerType);
  if (schema instanceof ZodArray) return [invalidFixture(schema._def.type)];
  if (schema instanceof ZodRecord) return { example: 123 };
  if (schema instanceof ZodLiteral) return "__invalid_literal__";
  if (schema instanceof ZodEnum) return "__invalid_enum__";
  if (schema instanceof ZodUnion) return "__invalid_union__";
  if (schema instanceof ZodUnknown) return undefined;
  if (schema instanceof ZodBoolean) return "not-a-boolean";
  if (schema instanceof ZodNumber) return "not-a-number";
  if (schema instanceof ZodString) {
    if (schema._def.checks.some((check) => check.kind === "uuid")) return "not-a-uuid";
    if (schema._def.checks.some((check) => check.kind === "datetime")) return "not-a-date";
    if (schema._def.checks.some((check) => check.kind === "url")) return "not-a-url";
    if (schema._def.checks.some((check) => check.kind === "startsWith")) return "wrong-prefix";
    return "";
  }
  if (schema instanceof ZodObject) {
    const fixture = validFixture(schema) as Record<string, unknown>;
    const [firstKey, firstSchema] = Object.entries(schema.shape as ZodRawShape)[0] ?? [];
    if (!firstKey || !firstSchema) return "not-an-object";
    return { ...fixture, [firstKey]: invalidFixture(firstSchema) };
  }
  return null;
}

export function missingRequiredFixture(schema: ZodTypeAny): unknown | null {
  const objectSchema = unwrapEffects(schema);
  if (!(objectSchema instanceof ZodObject)) return null;
  const requiredKey = Object.entries(objectSchema.shape as ZodRawShape).find(([, value]) => !(value instanceof ZodOptional))?.[0];
  if (!requiredKey) return null;
  const fixture = validFixture(objectSchema) as Record<string, unknown>;
  delete fixture[requiredKey];
  return fixture;
}

export function unwrapEffects(schema: ZodTypeAny): ZodTypeAny {
  return schema instanceof ZodEffects ? unwrapEffects(schema._def.schema) : schema;
}

export function assertMatchesSnapshot(snapshotPath: string, value: unknown): void {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const absolutePath = fileURLToPath(new URL(snapshotPath, import.meta.url));

  if (process.env.UPDATE_SNAPSHOTS === "1") {
    fs.mkdirSync(dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, serialized);
    return;
  }

  assert.equal(fs.existsSync(absolutePath), true, `Missing snapshot ${absolutePath}. Run with UPDATE_SNAPSHOTS=1 to create it.`);
  const expected = fs.readFileSync(absolutePath, "utf8");
  if (serialized !== expected) {
    const changedPaths = diffJsonPaths(JSON.parse(expected), value);
    assert.fail(
      [
        `Snapshot drifted: ${absolutePath}`,
        `Changed keys: ${changedPaths.slice(0, 25).join(", ") || "<serialization-only change>"}`,
        "Run with UPDATE_SNAPSHOTS=1 only when this change is intentional.",
      ].join("\n"),
    );
  }
}

export function diffJsonPaths(expected: unknown, actual: unknown, path = "$"): string[] {
  if (Object.is(expected, actual)) return [];
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [path];
    const length = Math.max(expected.length, actual.length);
    return Array.from({ length }, (_, index) => diffJsonPaths(expected[index], actual[index], `${path}[${index}]`)).flat();
  }
  if (isPlainObject(expected) || isPlainObject(actual)) {
    if (!isPlainObject(expected) || !isPlainObject(actual)) return [path];
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    return keys.flatMap((key) => diffJsonPaths(expected[key], actual[key], `${path}.${key}`));
  }
  return [path];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
