import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { DEFAULT_SETTINGS, routeSchemas, settingsSchema } from "../src/schema";
import { validFixture } from "./zod-utils";

interface SchemaPerformanceBaseline {
  allowedRegression: number;
  iterations: number;
  schemas: Record<string, { parseMs: number; safeParseMs: number }>;
}

const baselinePath = fileURLToPath(new URL("./__snapshots__/performance-baseline.json", import.meta.url));

function measureSchema(name: string, iterations: number): { parseMs: number; safeParseMs: number } {
  const schema = routeSchemas[name as keyof typeof routeSchemas];
  const fixture = validFixture(schema);

  schema.safeParse(fixture);
  schema.parse(fixture);

  const parseStart = performance.now();
  for (let index = 0; index < iterations; index += 1) schema.parse(fixture);
  const parseMs = (performance.now() - parseStart) / iterations;

  const safeParseStart = performance.now();
  for (let index = 0; index < iterations; index += 1) schema.safeParse(fixture);
  const safeParseMs = (performance.now() - safeParseStart) / iterations;

  return {
    parseMs: Number(parseMs.toFixed(6)),
    safeParseMs: Number(safeParseMs.toFixed(6)),
  };
}

export function measureSchemaPerformance(iterations: number): Record<string, { parseMs: number; safeParseMs: number }> {
  return Object.fromEntries(Object.keys(routeSchemas).sort().map((name) => [name, measureSchema(name, iterations)]));
}

test("Zod schema parse performance stays within baseline", () => {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as SchemaPerformanceBaseline;
  const current = measureSchemaPerformance(baseline.iterations);
  const failures: string[] = [];

  for (const [schemaName, expected] of Object.entries(baseline.schemas)) {
    const measured = current[schemaName];
    assert.ok(measured, `missing measured performance for ${schemaName}`);

    for (const metric of ["parseMs", "safeParseMs"] as const) {
      const limit = expected[metric] * baseline.allowedRegression;
      if (measured[metric] > limit) {
        failures.push(`${schemaName}.${metric}: ${measured[metric]}ms > ${limit.toFixed(6)}ms`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("SettingsSchema validates under 1ms", () => {
  const iterations = 1000;
  settingsSchema.safeParse(DEFAULT_SETTINGS);
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    settingsSchema.safeParse(DEFAULT_SETTINGS);
  }
  const averageMs = (performance.now() - startedAt) / iterations;

  assert.ok(averageMs < 1, `SettingsSchema safeParse averaged ${averageMs.toFixed(6)}ms`);
});
