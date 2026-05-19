/**
 * Build harness-report.json for CI artifacts and local inspection.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMetadata, readOpenApiWorkerSpec, readRepoFile } from './verify.js';
import { runMetadataSyncChecks } from './sync-metadata.js';
import { verifyHarnessNoCycles } from './dep-graph.js';
import { readSnapshot, snapshotsDir, sortKeys } from './snapshot-store.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { diffSnapshots, formatSnapshotDiff } from './snapshot-diff.js';
import { fingerprintOpenApiSchemas, fingerprintSchemaMap } from './zod-shape.js';
import {
  readPerformanceBaseline,
  comparePerformanceToBaseline,
  stableBenchmarkSchemaParse,
  REGRESSION_THRESHOLD,
} from './performance-benchmark.js';
import { runLlmsContentValidation } from './llms-validate.js';
import * as dashboardSchemas from '../js/lib/schemas.js';
import { generateSchemaFixtures } from './zod-fixtures.js';

const harnessDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(harnessDir, '..');

export function buildHarnessHealthReport() {
  const syncFindings = runMetadataSyncChecks();
  const cycles = verifyHarnessNoCycles();
  const llms = readRepoFile('llms.txt');
  const routes = loadMetadata('dashboard-api-routes.json').routes;
  const metaFiles = readdirSync(join(harnessDir, 'metadata')).filter((f) => f.endsWith('.json'));
  const bindings = loadMetadata('schema-bindings.json').bindings;

  const snapshotDrift = [];
  try {
    const liveOpenApi = sortKeys(fingerprintOpenApiSchemas(readOpenApiWorkerSpec()));
    const snapOpenApi = sortKeys(readSnapshot('openapi-schemas'));
    const changes = diffSnapshots(snapOpenApi, liveOpenApi);
    if (changes.length) {
      snapshotDrift.push({ snapshot: 'openapi-schemas', changes: changes.slice(0, 50) });
    }
    const liveDash = sortKeys(fingerprintSchemaMap(dashboardSchemas));
    const snapDash = sortKeys(readSnapshot('dashboard-zod-schemas'));
    const dashChanges = diffSnapshots(snapDash, liveDash);
    if (dashChanges.length) {
      snapshotDrift.push({ snapshot: 'dashboard-zod-schemas', changes: dashChanges.slice(0, 50) });
    }
  } catch (e) {
    snapshotDrift.push({ snapshot: 'check', error: e instanceof Error ? e.message : String(e) });
  }

  const llmsFindings = runLlmsContentValidation(llms, {
    dashboardRoutes: routes,
    harnessMetaFiles: metaFiles,
  });

  /** @type {{ total: number, generated: number, skipped: number, errors: Array<{ schema: string, error: string }> }} */
  let fixtureCoverage = { total: bindings.length, generated: 0, skipped: 0, errors: [] };
  for (const b of bindings) {
    const schema = dashboardSchemas[b.dashboardSchema];
    if (!schema) continue;
    const fx = generateSchemaFixtures(schema, b.dashboardSchema);
    if (fx.error) {
      fixtureCoverage.skipped += 1;
      fixtureCoverage.errors.push({ schema: b.dashboardSchema, error: fx.error });
    } else {
      fixtureCoverage.generated += 1;
    }
  }

  const perfBaseline = readPerformanceBaseline();
  const perfCurrent = perfBaseline
    ? {
        'dashboard.searchCustomersQuerySchema': stableBenchmarkSchemaParse(
          dashboardSchemas.searchCustomersQuerySchema,
          { q: 'GX195', limit: 25 },
        ),
        'dashboard.pendingWagersFiltersSchema': stableBenchmarkSchemaParse(
          dashboardSchemas.pendingWagersFiltersSchema,
          { date: '2026-05-17', customer_id: '0' },
        ),
      }
    : {};
  const perfRegressions = perfBaseline
    ? comparePerformanceToBaseline(perfCurrent, perfBaseline, REGRESSION_THRESHOLD)
    : ['performance baseline missing'];
  const snapshotsOnDisk = readdirSync(snapshotsDir).filter((f) => f.endsWith('.snap.json'));

  return {
    generatedAt: new Date().toISOString(),
    snapshots: {
      files: snapshotsOnDisk,
      driftCount: snapshotDrift.reduce((n, d) => n + (d.changes?.length ?? 0), 0),
      drift: snapshotDrift,
      ok: snapshotDrift.length === 0,
    },
    metadataSync: {
      ok: syncFindings.length === 0,
      findings: syncFindings,
    },
    llms: {
      ok: llmsFindings.length === 0,
      findings: llmsFindings,
      routesDocumented: routes.filter((r) => !r.public && llms.includes(r.path)).length,
      routesTotal: routes.filter((r) => !r.public).length,
    },
    fixtures: fixtureCoverage,
    circularDependencies: {
      ok: cycles.length === 0,
      cycles,
    },
    performance: {
      baselinePresent: !!perfBaseline,
      threshold: REGRESSION_THRESHOLD,
      schemaCount: perfBaseline ? Object.keys(perfBaseline.schemas ?? {}).length : 0,
      ok: perfRegressions.length === 0,
      regressions: perfRegressions,
      sampleCurrentMs: Object.fromEntries(
        Object.entries(perfCurrent).map(([k, v]) => [k, v.msPerOp]),
      ),
    },
    counts: {
      metadataFiles: metaFiles.length,
      dashboardRoutes: routes.length,
      schemaBindings: bindings.length,
    },
  };
}

export function writeHarnessReportJson(report, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
