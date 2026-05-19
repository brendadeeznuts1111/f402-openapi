#!/usr/bin/env node
/**
 * Watch harness-related files; re-run sync + tests after each change.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function statusLine(label, ok, detail = '') {
  const icon = ok ? '✓' : '✗';
  return `${icon} ${label}${detail ? ` — ${detail}` : ''}`;
}

function runOnce() {
  const sync = spawnSync('node', ['scripts/harness-sync-check.mjs'], {
    cwd: dashboardRoot,
    encoding: 'utf8',
  });
  const tests = spawnSync('bun', ['test', 'test/harness/', 'test/harness-contract.test.js'], {
    cwd: dashboardRoot,
    encoding: 'utf8',
  });
  const stale = sync.status !== 0 ? 'stale' : 'fresh';
  const passed = tests.status === 0;

  console.clear();
  console.log('Harness watch —', new Date().toLocaleTimeString());
  console.log(statusLine('metadata sync', sync.status === 0, stale));
  console.log(statusLine('harness tests', passed, passed ? 'passed' : 'failed'));
  console.log(statusLine('snapshots', !tests.stderr?.includes('snapshot drift'), passed ? 'ok' : 'drift?'));
  if (sync.status !== 0) console.log('\nSync:\n', sync.stdout || sync.stderr);
  if (!passed) console.log('\nTests:\n', (tests.stdout || '').split('\n').slice(-15).join('\n'));
  console.log(
    '\nWatching harness/, navigation-config, navigation-schemas, manifest.json, llms.txt …',
  );
}

runOnce();

const { watch } = await import('node:fs');
const watchPaths = [
  join(dashboardRoot, 'harness'),
  join(dashboardRoot, 'test/harness'),
  join(dashboardRoot, 'js/lib/schemas.js'),
  join(dashboardRoot, 'js/lib/navigation-config.js'),
  join(dashboardRoot, 'js/lib/navigation-schemas.js'),
  join(dashboardRoot, 'public/manifest.json'),
  join(dashboardRoot, '_worker.js'),
  join(dashboardRoot, '..', 'llms.txt'),
  join(dashboardRoot, '..', 'AGENTS.md'),
];

let debounce;
for (const p of watchPaths) {
  watch(p, { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(runOnce, 400);
  });
}
