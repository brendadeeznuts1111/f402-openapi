/**
 * Harness contract tests — route isolation, schema helpers, OpenAPI names, metadata files.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_API_PATHS, ENDPOINT_ZONE_MAP, REFRESH_INTERVALS } from '../js/constants.js';
import * as dashboardSchemas from '../js/lib/schemas.js';
import {
  buildPendingWagersQuery,
  buildSearchCustomersQuery,
  buildTransactionsLiveQuery,
  buildAgentPerfQueryString,
} from '../js/lib/query-builders.js';
import {
  loadMetadata,
  verifyPublicRouteIsolation,
  parseWorkerApiManifest,
  verifyDashboardRoutesManifest,
  verifySchemaBindings,
  verifyOpenApiSchemaNames,
  verifyComponentsManifest,
  readWorkerIndexSource,
  readOpenApiWorkerSpec,
  pagesProxyIsPublicPath,
} from '../harness/verify.js';
import {
  pendingWagersQuerySchema,
  searchCustomersQuerySchema,
  transactionsLiveQuerySchema,
  agentPerformanceLiveQuerySchema,
  customerProfileQuerySchema,
  parseSearchParams,
} from '../../tools/lib/f402-schemas.mjs';

const testDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(testDir, '..');

test('metadata files load and match expected shape', () => {
  const pub = loadMetadata('public-routes.json');
  const routes = loadMetadata('dashboard-api-routes.json');
  const schemas = loadMetadata('schema-bindings.json');
  const components = loadMetadata('components.manifest.json');

  assert.ok(Array.isArray(pub.paths) && pub.paths.length >= 2);
  assert.ok(routes.routes.length >= 10);
  assert.ok(schemas.bindings.length >= 4);
  assert.ok(components.components.length >= 20);
});

test('route isolation: public paths align across metadata, constants, and Pages proxy', () => {
  const pub = loadMetadata('public-routes.json');
  const findings = verifyPublicRouteIsolation({
    publicRoutesMeta: pub,
    constantsPublicPaths: PUBLIC_API_PATHS,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('route isolation: live-wagers subpaths stay public', () => {
  assert.equal(pagesProxyIsPublicPath('/live-wagers/stream'), true);
  assert.equal(pagesProxyIsPublicPath('/pending-wagers'), false);
});

test('dashboard API routes manifest matches worker and constants', () => {
  const meta = loadMetadata('dashboard-api-routes.json');
  const worker = parseWorkerApiManifest(readWorkerIndexSource());
  const findings = verifyDashboardRoutesManifest({
    dashboardRoutes: meta.routes,
    endpointZoneMap: ENDPOINT_ZONE_MAP,
    refreshIntervals: REFRESH_INTERVALS,
    workerRoutes: worker.routes,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('schema bindings: dashboard and worker Zod accept the same sample queries', () => {
  const meta = loadMetadata('schema-bindings.json');
  const findings = verifySchemaBindings({
    bindings: meta.bindings,
    dashboardSchemas,
    workerSchemas: {
      pendingWagersQuerySchema,
      searchCustomersQuerySchema,
      transactionsLiveQuerySchema,
      agentPerformanceLiveQuerySchema,
      customerProfileQuerySchema,
    },
    parseSearchParams,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('schema helpers: query builders emit worker-valid query strings', () => {
  const pendingQs = buildPendingWagersQuery({
    date: '2026-05-17',
    customer_id: '0',
    wager_type: 'S',
  });
  const pending = parseSearchParams(
    pendingWagersQuerySchema,
    new URLSearchParams(pendingQs),
  );
  assert.equal(pending.ok, true);

  const searchQs = buildSearchCustomersQuery('GX195', 10);
  const search = parseSearchParams(
    searchCustomersQuerySchema,
    new URLSearchParams(searchQs),
  );
  assert.equal(search.ok, true);

  const txQs = buildTransactionsLiveQuery({
    type: 'player',
    start_date: '2026-05-01',
    end_date: '2026-05-17',
  });
  const tx = parseSearchParams(
    transactionsLiveQuerySchema,
    new URLSearchParams(txQs),
  );
  assert.equal(tx.ok, true);

  const perfQs = buildAgentPerfQueryString({ type: 'CP', freePlay: 'Y' });
  const perf = parseSearchParams(
    agentPerformanceLiveQuerySchema,
    new URLSearchParams(perfQs),
  );
  assert.equal(perf.ok, true);
});

test('OpenAPI schema names from metadata exist in openapi.worker.json', () => {
  const meta = loadMetadata('schema-bindings.json');
  const spec = readOpenApiWorkerSpec();
  const findings = verifyOpenApiSchemaNames(meta.openApiSchemas, spec);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('components manifest matches dashboard.css imports and component files', () => {
  const meta = loadMetadata('components.manifest.json');
  const findings = verifyComponentsManifest({
    components: meta.components,
    dashboardCssPath: join(dashboardRoot, 'css/dashboard.css'),
    componentsDir: join(dashboardRoot, 'css/components'),
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('worker manifest includes all dashboard query GET routes', () => {
  const meta = loadMetadata('dashboard-api-routes.json');
  const worker = parseWorkerApiManifest(readWorkerIndexSource());
  const workerPaths = new Set(worker.routes.map((r) => `${r.method} ${r.path}`));

  const missing = meta.routes
    .filter((r) => !r.public && r.path !== '/customer-profile/seed')
    .filter((r) => !workerPaths.has(`GET ${r.path}`) && !workerPaths.has(`POST ${r.path}`))
    .map((r) => r.path);

  assert.deepEqual(missing, [], `worker missing routes: ${missing.join(', ')}`);
});
