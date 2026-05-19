/**
 * CI snapshot mode — drift fails with structural diff (no auto-update).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isHarnessCiMode } from '../../harness/snapshot-store.js';
import { diffSnapshots, formatSnapshotDiff } from '../../harness/snapshot-diff.js';

test('HARNESS_CI mode is active when env set', () => {
  const prev = process.env.HARNESS_CI;
  process.env.HARNESS_CI = '1';
  assert.equal(isHarnessCiMode(), true);
  delete process.env.HARNESS_CI;
  if (prev !== undefined) process.env.HARNESS_CI = prev;
});

test('snapshot diff reports changed schema keys', () => {
  const expected = { Foo: { type: 'object', properties: { a: { type: 'string' } } } };
  const actual = { Foo: { type: 'object', properties: { a: { type: 'integer' } } } };
  const changes = diffSnapshots(expected, actual);
  assert.ok(changes.some((c) => c.type === 'changed' && c.path.includes('Foo')));
  const text = formatSnapshotDiff('test', changes);
  assert.match(text, /Foo/);
});
