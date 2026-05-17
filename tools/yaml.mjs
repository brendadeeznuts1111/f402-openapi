// Minimal YAML emitter for the secured OpenAPI artifacts.
const FIRST_CHAR_DENY = /^[,\[\]{}#&*!|>'"%@`]/;
const FIRST_CHAR_AMBIG = /^[-?:]/;
const SAFE_BARE = /^[A-Za-z0-9_./-][A-Za-z0-9 _./@-]*$/;
const RESERVED = new Set([
  'true', 'false', 'null', 'yes', 'no', 'on', 'off', '~',
  'True', 'False', 'Null', 'TRUE', 'FALSE', 'NULL',
]);

function quoteScalar(s) {
  if (s === '') return "''";
  if (RESERVED.has(s)) return `'${s}'`;
  if (/^-?\d+(\.\d+)?$/.test(s)) return `'${s}'`;
  if (FIRST_CHAR_DENY.test(s) || FIRST_CHAR_AMBIG.test(s) || !SAFE_BARE.test(s)) {
    if (!s.includes("'") && !s.includes('\n')) return `'${s}'`;
    return JSON.stringify(s);
  }
  return s;
}

function emitScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  return quoteScalar(String(v));
}

function isScalar(v) {
  return v === null || v === undefined ||
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function emit(node, indent) {
  if (isScalar(node)) return emitScalar(node);
  const pad = '  '.repeat(indent);

  if (Array.isArray(node)) {
    if (node.length === 0) return '[]';
    return node.map((item) => {
      if (isScalar(item)) return `${pad}- ${emitScalar(item)}`;
      const inner = emit(item, indent + 1);
      if (inner.startsWith(`${pad}  `)) return `${pad}- ${inner.trimStart()}`;
      return `${pad}-\n${inner}`;
    }).join('\n');
  }

  const keys = Object.keys(node);
  if (keys.length === 0) return '{}';
  const lines = [];
  for (const key of keys) {
    const value = node[key];
    const keyStr = quoteScalar(key);
    if (isScalar(value)) {
      lines.push(`${pad}${keyStr}: ${emitScalar(value)}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${keyStr}: []`);
      } else {
        lines.push(`${pad}${keyStr}:`);
        lines.push(emit(value, indent + 1));
      }
    } else if (Object.keys(value).length === 0) {
      lines.push(`${pad}${keyStr}: {}`);
    } else {
      lines.push(`${pad}${keyStr}:`);
      lines.push(emit(value, indent + 1));
    }
  }
  return lines.join('\n');
}

export function toYaml(obj) {
  return `${emit(obj, 0)}\n`;
}
