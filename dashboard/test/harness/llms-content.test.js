/**
 * llms.txt — routes, harness artifacts, local link targets.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMetadata, readRepoFile } from '../../harness/verify.js';
import {
  extractLlmsLocalPaths,
  runLlmsContentValidation,
  verifyLlmsLocalLinks,
  verifyLlmsHarnessArtifacts,
} from '../../harness/llms-validate.js';

const harnessDir = join(dirname(fileURLToPath(import.meta.url)), '../../harness');

test('llms.txt lists harness artifacts and validates local links', () => {
  const llms = readRepoFile('llms.txt');
  const routes = loadMetadata('dashboard-api-routes.json').routes;
  const metaFiles = readdirSync(join(harnessDir, 'metadata')).filter((f) => f.endsWith('.json'));

  const findings = [
    ...verifyLlmsHarnessArtifacts(llms),
    ...verifyLlmsLocalLinks(llms),
    ...runLlmsContentValidation(llms, { dashboardRoutes: routes, harnessMetaFiles: metaFiles }),
  ];
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('llms.txt local path references resolve under repo root', () => {
  const llms = readRepoFile('llms.txt');
  const paths = extractLlmsLocalPaths(llms);
  assert.ok(paths.length >= 3, 'expected local path references in llms.txt');
  const broken = verifyLlmsLocalLinks(llms);
  assert.deepEqual(broken, [], broken.join('\n'));
});
