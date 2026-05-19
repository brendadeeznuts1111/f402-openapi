/**
 * Zod schema parse performance baselines (perf_hooks).
 */
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDir = dirname(fileURLToPath(import.meta.url));
export const performanceBaselinePath = join(harnessDir, 'snapshots/performance-baseline.json');

const DEFAULT_ITERATIONS = 2000;
const REGRESSION_THRESHOLD = 1.15;
export const NAVIGATION_REGRESSION_THRESHOLD = 1.1;
/** Ignore sub-millisecond noise below this absolute delta (ms/op). */
const MIN_REGRESSION_DELTA_MS = 0.001;

export function benchmarkSchemaParse(schema, input, iterations = DEFAULT_ITERATIONS) {
  schema.safeParse(input);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    schema.safeParse(input);
  }
  const end = performance.now();
  return {
    iterations,
    totalMs: end - start,
    msPerOp: (end - start) / iterations,
  };
}

/** Best-of-N runs (test comparisons — optimistic). */
export function stableBenchmarkSchemaParse(schema, input, { runs = 3, iterations = DEFAULT_ITERATIONS } = {}) {
  let best = Infinity;
  let used = iterations;
  for (let r = 0; r < runs; r++) {
    const result = benchmarkSchemaParse(schema, input, iterations);
    if (result.msPerOp < best) {
      best = result.msPerOp;
      used = result.iterations;
    }
  }
  return { iterations: used, msPerOp: best, totalMs: best * used };
}

/** Worst-of-N runs (baseline capture — pessimistic). */
export function worstBenchmarkSchemaParse(schema, input, { runs = 5, iterations = DEFAULT_ITERATIONS } = {}) {
  let worst = 0;
  let used = iterations;
  for (let r = 0; r < runs; r++) {
    const result = benchmarkSchemaParse(schema, input, iterations);
    if (result.msPerOp > worst) {
      worst = result.msPerOp;
      used = result.iterations;
    }
  }
  return { iterations: used, msPerOp: worst, totalMs: worst * used };
}

export function readPerformanceBaseline() {
  if (!existsSync(performanceBaselinePath)) return null;
  return JSON.parse(readFileSync(performanceBaselinePath, 'utf8'));
}

export function writePerformanceBaseline(results) {
  mkdirSync(dirname(performanceBaselinePath), { recursive: true });
  const payload = {
    version: 1,
    iterations: DEFAULT_ITERATIONS,
    threshold: REGRESSION_THRESHOLD,
    generatedAt: new Date().toISOString(),
    schemas: results,
  };
  writeFileSync(performanceBaselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function comparePerformanceToBaseline(current, baseline, threshold = REGRESSION_THRESHOLD) {
  const findings = [];
  if (!baseline?.schemas) {
    findings.push('performance baseline missing — run npm run test:harness:update');
    return findings;
  }
  for (const [name, cur] of Object.entries(current)) {
    const base = baseline.schemas[name];
    if (!base) continue;
    const delta = cur.msPerOp - base.msPerOp;
    const ratio = cur.msPerOp / base.msPerOp;
    if (delta > MIN_REGRESSION_DELTA_MS && ratio > threshold) {
      findings.push(
        `${name}: ${(ratio * 100 - 100).toFixed(1)}% slower (${base.msPerOp.toFixed(4)} → ${cur.msPerOp.toFixed(4)} ms/op)`,
      );
    }
  }
  return findings;
}

export function benchmarkNavigationConfig(sidebarConfigSchema, config, iterations = 500) {
  sidebarConfigSchema.safeParse(config);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    sidebarConfigSchema.safeParse(config);
  }
  const end = performance.now();
  return {
    iterations,
    msPerOp: (end - start) / iterations,
  };
}

export { REGRESSION_THRESHOLD, DEFAULT_ITERATIONS };
