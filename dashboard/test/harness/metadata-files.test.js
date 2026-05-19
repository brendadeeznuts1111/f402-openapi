/**
 * Metadata files — llms.txt, harness manifests, OpenAPI spec structure stay in sync.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMetadata,
  verifyRepoMetadataFiles,
  verifyComponentsManifest,
  readRepoFile,
} from '../../harness/verify.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(testDir, '../..');
const repoRoot = join(dashboardRoot, '..');

test('repo-metadata.json required files exist with required anchors', () => {
  const repoMeta = loadMetadata('repo-metadata.json');
  const findings = verifyRepoMetadataFiles(repoMeta);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('llms.txt references current worker and dashboard artifacts', () => {
  const llms = readRepoFile('llms.txt');
  assert.match(llms, /upstream-endpoints\.json/);
  assert.match(llms, /openapi\.worker\.json/);
  assert.match(llms, /GET \/chart-aggregates/);
  assert.match(llms, /docs\/dashboard\.md/);
  assert.ok(llms.split('\n').length >= 50);
});

test('harness metadata JSON files are valid and cross-linked', () => {
  const names = [
    'public-routes.json',
    'dashboard-api-routes.json',
    'schema-bindings.json',
    'components.manifest.json',
    'view-routes.json',
    'zod-cases.json',
    'repo-metadata.json',
    'schema-registry.json',
  ];
  for (const name of names) {
    const data = loadMetadata(name);
    assert.ok(data.description, `${name} needs description`);
  }
  const routes = loadMetadata('dashboard-api-routes.json').routes;
  const views = loadMetadata('view-routes.json').views;
  assert.ok(routes.length >= views.length, 'route manifest should cover all views');
});

test('components.manifest matches dashboard.css and files on disk', () => {
  const meta = loadMetadata('components.manifest.json');
  const findings = verifyComponentsManifest({
    components: meta.components,
    dashboardCssPath: join(dashboardRoot, 'css/dashboard.css'),
    componentsDir: join(dashboardRoot, 'css/components'),
  });
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('optional AGENTS.md documented when absent', () => {
  const repoMeta = loadMetadata('repo-metadata.json');
  const agentsPath = join(repoRoot, 'AGENTS.md');
  const optional = repoMeta.optionalFiles?.find((f) => f.path === 'AGENTS.md');
  assert.ok(optional, 'repo-metadata should list optional AGENTS.md');
  if (!existsSync(agentsPath)) {
    assert.ok(optional.description, 'document AGENTS.md when not present');
  }
});
