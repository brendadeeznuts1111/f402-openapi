import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { basename, dirname, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { routeSchemas, settingsSchema } from "../src/schema";
import { describeZodSchema, diffJsonPaths, validFixture } from "../test/zod-utils";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const checkMode = process.argv.includes("--check");

interface HarnessReport {
  generatedAt: string;
  status: "passed" | "failed";
  snapshots: {
    status: "passed" | "failed";
    driftCount: number;
    files: Record<string, { status: "passed" | "failed"; changedKeys: string[] }>;
  };
  metadata: {
    status: "passed" | "failed";
    files: Record<string, { status: "passed" | "failed"; missing: string[]; brokenLinks?: string[] }>;
  };
  fixtures: {
    status: "passed" | "failed";
    coveredSchemas: number;
    totalSchemas: number;
    failures: string[];
  };
  circularDependencies: {
    status: "passed" | "failed";
    cycles: string[][];
  };
  performance: {
    status: "passed" | "failed";
    allowedRegression: number;
    iterations: number;
    regressions: string[];
    current: Record<string, { parseMs: number; safeParseMs: number }>;
  };
}

function readJson(path: string): unknown {
  return JSON.parse(fs.readFileSync(resolve(projectRoot, path), "utf8"));
}

function currentOpenApiSnapshot(): unknown {
  const spec = readJson("openapi.worker.json") as { components: { schemas: Record<string, unknown> } };
  return {
    names: Object.keys(spec.components.schemas).sort(),
    schemas: spec.components.schemas,
  };
}

function currentZodSnapshot(): unknown {
  return Object.fromEntries(
    Object.entries(routeSchemas)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, schema]) => [name, describeZodSchema(schema)]),
  );
}

function checkSnapshots(): HarnessReport["snapshots"] {
  const files = {
    "test/__snapshots__/openapi-schemas.snap.json": currentOpenApiSnapshot(),
    "test/__snapshots__/zod-schemas.snap.json": currentZodSnapshot(),
    "test/harness/snapshots/settings-schema.snap.json": describeZodSchema(settingsSchema),
  };
  const result: HarnessReport["snapshots"]["files"] = {};

  for (const [path, current] of Object.entries(files)) {
    const expected = readJson(path);
    const changedKeys = diffJsonPaths(expected, current);
    result[path] = { status: changedKeys.length === 0 ? "passed" : "failed", changedKeys };
  }

  const driftCount = Object.values(result).reduce((count, file) => count + file.changedKeys.length, 0);
  return {
    status: driftCount === 0 ? "passed" : "failed",
    driftCount,
    files: result,
  };
}

function checkMetadata(): HarnessReport["metadata"] {
  const manifest = readJson("manifest.json") as {
    public: { llm: string; llms: string };
    entrypoints: Record<string, string>;
    schemas: string[];
  };
  const spec = readJson("openapi.worker.json") as { paths: Record<string, unknown> };
  const routePaths = Object.keys(spec.paths).sort();
  const schemaNames = Object.keys(routeSchemas).sort();
  const harnessArtifacts = [
    "test/harness.ts",
    "test/harness-self.test.ts",
    "test/openapi-validator.test.ts",
    "test/performance.test.ts",
    "test/error-paths.test.ts",
    "test/route-crawler.test.ts",
    "test/schema.test.ts",
    "test/snapshot.test.ts",
    "test/zod-utils.ts",
    "test/zod-validation.test.ts",
    "test/__snapshots__/openapi-schemas.snap.json",
    "test/__snapshots__/zod-schemas.snap.json",
    "test/__snapshots__/performance-baseline.json",
    "test/harness/snapshots/settings-schema.snap.json",
    "scripts/harness-report.ts",
    "scripts/harness-watch.mjs",
  ].sort();
  const files: HarnessReport["metadata"]["files"] = {};

  for (const path of [manifest.public.llm, manifest.public.llms, "agents.md"]) {
    const absolutePath = resolve(projectRoot, path);
    const text = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
    const required = path.endsWith("llms.txt") ? [...routePaths, ...schemaNames, ...harnessArtifacts] : schemaNames;
    const missing = required.filter((item) => !text.includes(item));
    const brokenLinks = path.endsWith("llms.txt")
      ? [...text.matchAll(/`([^`]+\.[^`]+)`/g)].map((match) => match[1]).filter((link) => Boolean(link) && !fs.existsSync(resolve(projectRoot, link!))) as string[]
      : [];
    files[path] = {
      status: missing.length === 0 && brokenLinks.length === 0 ? "passed" : "failed",
      missing,
      brokenLinks,
    };
  }

  for (const entrypoint of Object.values(manifest.entrypoints)) {
    files[`manifest:${entrypoint}`] = {
      status: fs.existsSync(resolve(projectRoot, entrypoint)) ? "passed" : "failed",
      missing: fs.existsSync(resolve(projectRoot, entrypoint)) ? [] : [entrypoint],
    };
  }

  return {
    status: Object.values(files).every((file) => file.status === "passed") ? "passed" : "failed",
    files,
  };
}

function checkFixtureCoverage(): HarnessReport["fixtures"] {
  const failures: string[] = [];
  let coveredSchemas = 0;

  for (const [name, schema] of Object.entries(routeSchemas)) {
    try {
      const parsed = schema.safeParse(validFixture(schema));
      if (parsed.success) coveredSchemas += 1;
      else failures.push(`${name}: generated fixture did not parse`);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    status: failures.length === 0 ? "passed" : "failed",
    coveredSchemas,
    totalSchemas: Object.keys(routeSchemas).length,
    failures,
  };
}

function checkCircularDependencies(): HarnessReport["circularDependencies"] {
  const testRoot = resolve(projectRoot, "test");
  const helperFiles = fs
    .readdirSync(testRoot)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => resolve(testRoot, file));
  const helperSet = new Set(helperFiles);
  const graph = new Map<string, string[]>();

  for (const file of helperFiles) {
    const source = fs.readFileSync(file, "utf8");
    graph.set(
      file,
      [...source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)]
        .map((match) => resolve(dirname(file), `${match[1]}.ts`))
        .filter((candidate) => helperSet.has(candidate)),
    );
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(file: string, stack: string[]): void {
    if (visiting.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file].map((entry) => basename(entry)));
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const next of graph.get(file) ?? []) visit(next, [...stack, next]);
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of helperFiles) visit(file, [file]);
  return { status: cycles.length === 0 ? "passed" : "failed", cycles };
}

function measureSchemaPerformance(iterations: number): Record<string, { parseMs: number; safeParseMs: number }> {
  return Object.fromEntries(
    Object.entries(routeSchemas)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, schema]) => {
        const fixture = validFixture(schema);
        schema.parse(fixture);
        schema.safeParse(fixture);

        const parseStart = performance.now();
        for (let index = 0; index < iterations; index += 1) schema.parse(fixture);
        const parseMs = (performance.now() - parseStart) / iterations;

        const safeParseStart = performance.now();
        for (let index = 0; index < iterations; index += 1) schema.safeParse(fixture);
        const safeParseMs = (performance.now() - safeParseStart) / iterations;

        return [name, { parseMs: Number(parseMs.toFixed(6)), safeParseMs: Number(safeParseMs.toFixed(6)) }];
      }),
  );
}

function checkPerformance(): HarnessReport["performance"] {
  const baseline = readJson("test/__snapshots__/performance-baseline.json") as {
    allowedRegression: number;
    iterations: number;
    schemas: Record<string, { parseMs: number; safeParseMs: number }>;
  };
  const current = measureSchemaPerformance(baseline.iterations);
  const regressions: string[] = [];

  for (const [name, expected] of Object.entries(baseline.schemas)) {
    const measured = current[name];
    if (!measured) {
      regressions.push(`${name}: missing current measurement`);
      continue;
    }
    for (const metric of ["parseMs", "safeParseMs"] as const) {
      const limit = expected[metric] * baseline.allowedRegression;
      if (measured[metric] > limit) regressions.push(`${name}.${metric}: ${measured[metric]}ms > ${limit.toFixed(6)}ms`);
    }
  }

  return {
    status: regressions.length === 0 ? "passed" : "failed",
    allowedRegression: baseline.allowedRegression,
    iterations: baseline.iterations,
    regressions,
    current,
  };
}

function buildReport(): HarnessReport {
  const snapshots = checkSnapshots();
  const metadata = checkMetadata();
  const fixtures = checkFixtureCoverage();
  const circularDependencies = checkCircularDependencies();
  const performanceReport = checkPerformance();
  const status = [snapshots, metadata, fixtures, circularDependencies, performanceReport].every((section) => section.status === "passed")
    ? "passed"
    : "failed";

  return {
    generatedAt: new Date().toISOString(),
    status,
    snapshots,
    metadata,
    fixtures,
    circularDependencies,
    performance: performanceReport,
  };
}

const report = buildReport();
fs.writeFileSync(resolve(projectRoot, "harness-report.json"), `${JSON.stringify(report, null, 2)}\n`);

const dashboard = [
  `harness ${report.status}`,
  `snapshots=${report.snapshots.status} drift=${report.snapshots.driftCount}`,
  `metadata=${report.metadata.status}`,
  `fixtures=${report.fixtures.coveredSchemas}/${report.fixtures.totalSchemas}`,
  `cycles=${report.circularDependencies.cycles.length}`,
  `perf=${report.performance.status}`,
].join(" | ");

console.log(dashboard);

if (report.snapshots.driftCount > 0) {
  for (const [file, result] of Object.entries(report.snapshots.files)) {
    if (result.changedKeys.length > 0) console.error(`${file}: ${result.changedKeys.slice(0, 25).join(", ")}`);
  }
}
if (report.performance.regressions.length > 0) console.error(report.performance.regressions.join("\n"));
if (checkMode && report.status !== "passed") process.exit(1);
