import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countTestDeclarations,
  defaultManifestPath,
  validateProductionManifest,
} from '../scripts/manifest-validate.mjs';

test('production manifest derives release metadata and test counts', () => {
  const result = validateProductionManifest(defaultManifestPath);

  assert.equal(result.release.versionSource, 'package.json');
  assert.equal(result.release.version, result.release.packages.root.version);
  assert.equal(result.release.packages.dashboard.name, 'fantasy402-dashboard');
  assert.equal(result.release.packages.worker.name, 'fantasy402-ingestion');

  assert.ok(result.counts.testFileCount > 0);
  assert.ok(result.counts.testCount > 0);
  assert.equal(
    result.counts.testCount,
    result.testSuites.reduce((sum, suite) => sum + suite.testCount, 0),
  );
});

test('test declaration counter ignores comments and tracks added tests', () => {
  const source = `
    // test('commented out', () => {});
    /* it('also commented out', () => {}); */
    test('one', () => {});
    it.skip('two', () => {});
  `;

  assert.equal(countTestDeclarations(source), 2);
});
