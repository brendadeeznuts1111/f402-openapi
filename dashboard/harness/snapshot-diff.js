/**
 * Structural diff for snapshot JSON (CI-friendly drift output).
 */

function collectPaths(obj, prefix = '') {
  const paths = [];
  if (obj === null || typeof obj !== 'object') return paths;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      paths.push(...collectPaths(item, `${prefix}[${i}]`));
    });
    return paths;
  }
  for (const key of Object.keys(obj).sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    paths.push(...collectPaths(obj[key], path));
  }
  return paths;
}

/** Leaf-level path set for object keys (schema names at top level). */
export function topLevelKeys(obj) {
  return Object.keys(obj ?? {}).sort();
}

export function diffSnapshots(expected, actual) {
  const changes = [];
  const expKeys = new Set(topLevelKeys(expected));
  const actKeys = new Set(topLevelKeys(actual));

  for (const k of expKeys) {
    if (!actKeys.has(k)) changes.push({ type: 'removed', path: k });
  }
  for (const k of actKeys) {
    if (!expKeys.has(k)) changes.push({ type: 'added', path: k });
  }

  for (const k of [...expKeys].filter((x) => actKeys.has(x))) {
    const expStr = JSON.stringify(expected[k]);
    const actStr = JSON.stringify(actual[k]);
    if (expStr !== actStr) {
      changes.push({ type: 'changed', path: k });
      diffObjectLeaves(expected[k], actual[k], k).forEach((c) => changes.push(c));
    }
  }

  return changes;
}

function diffObjectLeaves(a, b, base) {
  const leaves = [];
  const walk = (ea, eb, prefix) => {
    if (ea === eb) return;
    if (typeof ea !== typeof eb || ea === null || eb === null) {
      leaves.push({ type: 'changed', path: prefix, detail: `type ${typeof ea} → ${typeof eb}` });
      return;
    }
    if (typeof ea !== 'object') {
      if (ea !== eb) leaves.push({ type: 'changed', path: prefix, detail: `${JSON.stringify(ea)} → ${JSON.stringify(eb)}` });
      return;
    }
    if (Array.isArray(ea) && Array.isArray(eb)) {
      if (JSON.stringify(ea) !== JSON.stringify(eb)) {
        leaves.push({ type: 'changed', path: prefix, detail: 'array content differs' });
      }
      return;
    }
    const keys = new Set([...Object.keys(ea), ...Object.keys(eb)]);
    for (const key of keys) {
      const p = `${prefix}.${key}`;
      if (!(key in ea)) leaves.push({ type: 'added', path: p });
      else if (!(key in eb)) leaves.push({ type: 'removed', path: p });
      else walk(ea[key], eb[key], p);
    }
  };
  walk(a, b, base);
  return leaves.slice(0, 20);
}

export function formatSnapshotDiff(name, changes) {
  if (!changes.length) return '';
  const lines = [`Snapshot "${name}" drift (${changes.length} change(s)):`];
  for (const c of changes.slice(0, 40)) {
    const extra = c.detail ? ` — ${c.detail}` : '';
    lines.push(`  [${c.type}] ${c.path}${extra}`);
  }
  if (changes.length > 40) lines.push(`  … and ${changes.length - 40} more`);
  return lines.join('\n');
}
