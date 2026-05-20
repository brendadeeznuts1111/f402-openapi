/**
 * Automated metadata sync — llms.txt, manifests, view modules, schema exports.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMetadataSyncChecks } from '../../harness/sync-metadata.js';
import { loadMetadata, verifyRepoMetadataFiles } from '../../harness/verify.js';
import { ManifestSchema } from '../../src/lib/manifest-types.ts';

test('code and documentation metadata stay in sync', () => {
  const findings = runMetadataSyncChecks();
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('AGENTS.md satisfies repo-metadata requirements', () => {
  const repoMeta = loadMetadata('repo-metadata.json');
  const entry = repoMeta.requiredFiles.find((f) => f.path === 'AGENTS.md');
  assert.ok(entry);
  const findings = verifyRepoMetadataFiles(repoMeta);
  const agentsOnly = findings.filter((f) => f.includes('AGENTS.md'));
  assert.deepEqual(agentsOnly, [], agentsOnly.join('\n'));
});

test('manifest.json matches Zod schema', () => {
  const manifestPath = join(process.cwd(), 'public', 'manifest.json');
  const raw = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const result = ManifestSchema.safeParse(manifest);
  if (!result.success) {
    console.error(result.error.flatten());
  }
  assert.equal(result.success, true);
});
