/**
 * Pages secret setup stays manifest-driven and inspectable without Cloudflare writes.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(testDir, '../..');

test('set-pages-secrets dry run reflects manifest-declared Pages secrets', () => {
  const manifest = JSON.parse(readFileSync(join(dashboardRoot, 'public/manifest.json'), 'utf8'));
  const secrets = manifest.cloudflare.pages_projects.dashboard.secrets;

  const output = execFileSync('bash', ['scripts/set-pages-secrets.sh', '--dry-run'], {
    cwd: dashboardRoot,
    encoding: 'utf8',
  });

  assert.match(output, /Pages project: fantasy402-dashboard/);
  assert.match(output, /Pages envs: production preview/);
  assert.match(output, new RegExp(`Pages secrets: ${secrets.join(' ')}`));
});
