/**
 * Harness self-validation — strict TypeScript (checkJs) and no circular imports.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHarnessNoCycles, listHarnessModules } from '../../harness/dep-graph.js';
import { snapshotsDir } from '../../harness/snapshot-store.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(testDir, '../..');
const harnessRoot = join(dashboardRoot, 'harness');

test('harness modules have no circular local imports', () => {
  const findings = verifyHarnessNoCycles();
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('harness module inventory is non-empty', () => {
  const modules = listHarnessModules();
  assert.ok(modules.length >= 6, 'expected core harness modules');
  for (const m of modules) {
    assert.ok(existsSync(m), `missing ${m}`);
  }
});

test('harness compiles under strict checkJs (tsconfig.harness.json)', { timeout: 30_000 }, () => {
  const tsc = spawnSync(
    'bunx',
    ['tsc', '--noEmit', '-p', join(harnessRoot, 'tsconfig.harness.json')],
    { cwd: dashboardRoot, encoding: 'utf8' },
  );
  if (tsc.status !== 0) {
    assert.fail(
      `harness TypeScript check failed:\n${tsc.stdout}\n${tsc.stderr}`,
    );
  }
});

test('snapshot directory exists with core snapshots after first run', () => {
  assert.ok(existsSync(snapshotsDir), 'run npm run test:harness:update once');
  const files = readdirSync(snapshotsDir).filter((f) => f.endsWith('.snap.json'));
  assert.ok(files.includes('openapi-schemas.snap.json'));
  assert.ok(files.includes('dashboard-zod-schemas.snap.json'));
  assert.ok(files.includes('worker-zod-schemas.snap.json'));
  assert.ok(files.includes('navigation-config.snap.json'));
});

test('navigation modules import without cycles (schemas.js / Sidebar)', () => {
  const findings = verifyHarnessNoCycles();
  const navRelated = findings.filter((f) => f.includes('navigation'));
  assert.deepEqual(navRelated, [], navRelated.join('\n'));
});
