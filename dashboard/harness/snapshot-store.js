/**
 * File-based snapshots for OpenAPI and Zod shapes.
 * Update with: UPDATE_SNAPSHOTS=1 bun test … or npm run test:harness:update
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffSnapshots, formatSnapshotDiff } from './snapshot-diff.js';

const harnessDir = dirname(fileURLToPath(import.meta.url));
export const snapshotsDir = join(harnessDir, 'snapshots');

/** Deterministic JSON (sorted keys) for stable diffs. */
export function stableStringify(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

export function sortKeys(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortKeys(value[key]);
  }
  return out;
}

export function snapshotPath(name) {
  const base = name.endsWith('.snap.json') ? name : `${name}.snap.json`;
  return join(snapshotsDir, base);
}

export function readSnapshot(name) {
  const path = snapshotPath(name);
  if (!existsSync(path)) {
    throw new Error(
      `missing snapshot ${path} — run: cd dashboard && npm run test:harness:update`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeSnapshot(name, value) {
  mkdirSync(snapshotsDir, { recursive: true });
  writeFileSync(snapshotPath(name), `${stableStringify(value)}\n`, 'utf8');
}

export function isHarnessCiMode() {
  return process.env.HARNESS_CI === '1' || process.env.CI === 'true';
}

export function assertMatchesSnapshot(
  name,
  value,
  { update = process.env.UPDATE_SNAPSHOTS === '1' && !isHarnessCiMode() } = {},
) {
  if (update) {
    writeSnapshot(name, value);
    return { updated: true, path: snapshotPath(name) };
  }
  const expected = readSnapshot(name);
  const actual = sortKeys(value);
  const expectedSorted = sortKeys(expected);
  if (JSON.stringify(actual) !== JSON.stringify(expectedSorted)) {
    const changes = diffSnapshots(expectedSorted, actual);
    const diffText = formatSnapshotDiff(name, changes);
    const hint = isHarnessCiMode()
      ? 'CI mode: snapshot updates disabled. Approve locally with npm run test:harness:update'
      : 'run npm run test:harness:update to approve';
    throw new Error(`snapshot drift: ${snapshotPath(name)} — ${hint}\n${diffText}`);
  }
  return { updated: false };
}
