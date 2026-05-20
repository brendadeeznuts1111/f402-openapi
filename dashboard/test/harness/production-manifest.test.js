/**
 * Production manifest contract derives release and test metadata from sources.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultManifestPath,
  validateProductionManifest,
} from '../../../scripts/manifest-validate.mjs';

test('production manifest has derived release metadata and test counts', () => {
  const result = validateProductionManifest(defaultManifestPath);

  assert.equal(result.release.version, result.release.packages.root.version);
  assert.ok(result.testSuites.some((suite) => suite.id === 'dashboard-harness'));
  assert.ok(result.counts.testFileCount > 0);
  assert.ok(result.counts.testCount > 0);
});
