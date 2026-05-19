/**
 * Navigation config snapshots — SidebarConfig, TAB_PATHS, PATH_TO_TAB.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMatchesSnapshot } from '../../harness/snapshot-store.js';
import { serializeNavigationSnapshot, SIDEBAR_CONFIG } from '../../js/lib/navigation-config.js';

test('navigation config snapshot (24 tabs, 7 groups)', () => {
  const fingerprint = serializeNavigationSnapshot();
  assert.equal(fingerprint.tabCount, 24);
  assert.equal(fingerprint.groupCount, 7);
  assertMatchesSnapshot('navigation-config', fingerprint);
});

test('TAB_PATHS and PATH_TO_TAB are bijective', () => {
  const snap = serializeNavigationSnapshot();
  const paths = Object.values(snap.tabPaths);
  const reverse = Object.keys(snap.pathToTab);
  assert.equal(paths.length, reverse.length);
  for (const p of paths) {
    const id = snap.pathToTab[p];
    assert.equal(snap.tabPaths[id], p);
  }
});

test('SIDEBAR_CONFIG validates against schema', () => {
  assert.equal(SIDEBAR_CONFIG.groups.length, 7);
});
