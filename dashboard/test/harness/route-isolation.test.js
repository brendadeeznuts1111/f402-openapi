/**
 * Route isolation — views, panels, modules, and API path declarations stay independent.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_API_PATHS } from '../../js/constants.js';
import {
  loadMetadata,
  verifyPublicRouteIsolation,
  verifyViewRouteIsolation,
  verifyViewApiPathsDeclared,
  pagesProxyIsPublicPath,
} from '../../harness/verify.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(testDir, '../..');
const viewsDir = join(dashboardRoot, 'js/views');
const indexHtml = join(dashboardRoot, 'index.html');

test('view-routes metadata: every sidebar view has a panel and module exports', () => {
  const views = loadMetadata('view-routes.json');
  const html = readFileSync(indexHtml, 'utf8');
  const findings = verifyViewRouteIsolation({
    views: views.views,
    html,
    viewsDir,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('view API paths are declared in dashboard-api-routes.json', () => {
  const views = loadMetadata('view-routes.json');
  const routes = loadMetadata('dashboard-api-routes.json');
  const findings = verifyViewApiPathsDeclared({
    views: views.views,
    dashboardRoutes: routes.routes,
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('view modules import without throwing (isolated ESM graph)', async () => {
  const views = loadMetadata('view-routes.json');
  const nested = new Set(views.views.flatMap((v) => v.nestedModules ?? []));
  for (const view of views.views) {
    const mod = await import(`../../js/views/${view.module}`);
    for (const exp of view.loadExports) {
      assert.equal(
        typeof mod[exp],
        'function',
        `${view.module} must export function ${exp}`,
      );
    }
  }
  for (const file of nested) {
    const mod = await import(`../../js/views/${file}`);
    assert.ok(typeof mod === 'object', `${file} must load`);
  }
});

test('public routes stay isolated from protected dashboard API paths', () => {
  const pub = loadMetadata('public-routes.json');
  const findings = verifyPublicRouteIsolation({
    publicRoutesMeta: pub,
    constantsPublicPaths: PUBLIC_API_PATHS,
  });
  assert.deepEqual(findings, [], findings.join('\n'));

  const protectedPaths = loadMetadata('dashboard-api-routes.json').routes
    .filter((r) => !r.public)
    .map((r) => r.path);
  for (const p of protectedPaths) {
    assert.equal(
      pagesProxyIsPublicPath(p),
      false,
      `${p} must require token on Pages proxy`,
    );
  }
});
