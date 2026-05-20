/**
 * Manifest CLI output stays useful for pre-deploy checks.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(testDir, '../..');

test('validate-manifest prints deployment-critical summary fields', () => {
  const output = execFileSync('npm', ['run', 'validate:manifest', '--silent'], {
    cwd: dashboardRoot,
    encoding: 'utf8',
  });

  assert.match(output, /Manifest validates against Zod schema/);
  assert.match(output, /Cloudflare account: 7a470541a704caaf91e71efccc78fd36/);
  assert.match(output, /Dashboard Pages secrets: INGESTION_TRIGGER_TOKEN/);
  assert.match(output, /Dashboard Worker upstream: https:\/\/fantasy402-ingestion\.utahj4754\.workers\.dev/);
  assert.match(output, /Worker bindings: D1=ANALYTICS_DB, DB_AGENTS, DB_TRANSACTIONS, DB_WAGERS/);
});
