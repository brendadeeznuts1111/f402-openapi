/**
 * SidebarConfig full validation performance (10% regression threshold).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sidebarConfigSchema } from '../../js/lib/navigation-schemas.js';
import { SIDEBAR_CONFIG } from '../../js/lib/navigation-config.js';
import {
  readPerformanceBaseline,
  benchmarkNavigationConfig,
  stableBenchmarkSchemaParse,
  comparePerformanceToBaseline,
  NAVIGATION_REGRESSION_THRESHOLD,
} from '../../harness/performance-benchmark.js';

test('SidebarConfig validation within navigation performance baseline', () => {
  const baseline = readPerformanceBaseline();
  assert.ok(baseline?.schemas, 'run npm run test:harness:update');
  const current = {
    'navigation.validateSidebarConfig': stableBenchmarkSchemaParse(
      sidebarConfigSchema,
      SIDEBAR_CONFIG,
      { runs: 3, iterations: 500 },
    ),
  };
  const findings = comparePerformanceToBaseline(
    current,
    baseline,
    NAVIGATION_REGRESSION_THRESHOLD,
  );
  const navOnly = findings.filter((f) => f.startsWith('navigation.'));
  assert.deepEqual(navOnly, [], navOnly.join('\n'));
});

test('cold navigation benchmark produces timing', () => {
  const r = benchmarkNavigationConfig(sidebarConfigSchema, SIDEBAR_CONFIG, 100);
  assert.ok(r.msPerOp > 0);
});
