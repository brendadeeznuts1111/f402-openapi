/**
 * Pages _worker.js public path logic stays aligned with harness metadata.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMetadata, verifyPagesWorkerPublicPaths, pagesProxyIsPublicPath } from '../../harness/verify.js';

test('_worker.js isPublicWorkerPath matches public-routes.json', () => {
  const pub = loadMetadata('public-routes.json');
  const findings = verifyPagesWorkerPublicPaths(pub);
  assert.deepEqual(findings, [], findings.join('\n'));
});

test('pagesProxyIsPublicPath agrees with metadata paths', () => {
  const pub = loadMetadata('public-routes.json');
  for (const path of pub.paths) {
    assert.equal(pagesProxyIsPublicPath(path), true, `${path} should be public`);
  }
  assert.equal(pagesProxyIsPublicPath('/live-wagers/stream'), true);
  assert.equal(pagesProxyIsPublicPath('/pending-wagers'), false);
});
