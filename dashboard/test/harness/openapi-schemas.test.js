/**
 * Navigation routes — each TAB_PATH tab must have worker/OpenAPI anchors.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenApiWorkerSpec, parseWorkerApiManifest, readWorkerIndexSource } from '../../harness/verify.js';
import {
  verifyNavigationTabApiAnchors,
  verifyNavigationOpenApiOperations,
} from '../../harness/navigation-verify.js';
import { SIDEBAR_CONFIG, TAB_PATHS } from '../../js/lib/navigation-config.js';

test('TAB_PATHS has 24 unique dashboard routes', () => {
  const paths = Object.values(TAB_PATHS);
  assert.equal(paths.length, 24);
  assert.equal(new Set(paths).size, 24);
  assert.ok(paths.every((p) => p.startsWith('/dashboard/')));
});

test('every navigation tab has OpenAPI operationId and/or worker API anchor', () => {
  const spec = readOpenApiWorkerSpec();
  const worker = parseWorkerApiManifest(readWorkerIndexSource());
  const findings = [
    ...verifyNavigationOpenApiOperations(SIDEBAR_CONFIG, spec),
    ...verifyNavigationTabApiAnchors(SIDEBAR_CONFIG, spec, worker.routes),
  ];
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('SIDEBAR_CONFIG item paths match TAB_PATHS entries', () => {
  for (const group of SIDEBAR_CONFIG.groups) {
    for (const item of group.items) {
      assert.equal(TAB_PATHS[item.id], item.path, `TAB_PATHS[${item.id}]`);
    }
  }
});
