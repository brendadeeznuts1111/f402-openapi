/**
 * Automated metadata sync — llms.txt, manifests, view modules, schema exports.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runMetadataSyncChecks } from '../../harness/sync-metadata.js';

test('code and documentation metadata stay in sync', () => {
  const findings = runMetadataSyncChecks();
  assert.deepEqual(findings, [], findings.join('\n'));
});
