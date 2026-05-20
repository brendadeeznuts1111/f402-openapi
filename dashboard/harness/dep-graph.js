/**
 * Static import graph for harness modules — detect circular dependencies.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDir = dirname(fileURLToPath(import.meta.url));

const IMPORT_RE = /import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

export function parseLocalImports(filePath, fileContent) {
  const dir = dirname(filePath);
  const imports = [];
  let m;
  while ((m = IMPORT_RE.exec(fileContent))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    let resolved = join(dir, spec);
    if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs')) {
      resolved = `${resolved}.js`;
    }
    imports.push(resolved);
  }
  return imports;
}

export function buildImportGraph(files) {
  const graph = new Map();
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    graph.set(file, parseLocalImports(file, content));
  }
  return graph;
}

export function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function dfs(node) {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      cycles.push([...stack.slice(idx), node]);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (graph.has(next)) dfs(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) dfs(node);
  return cycles;
}

export function listHarnessModules() {
  const files = readdirSync(harnessDir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .map((f) => join(harnessDir, f));
  return files.sort();
}

export function listNavigationModules() {
  const dashboardRoot = join(harnessDir, '..');
  return [
    join(dashboardRoot, 'js/lib/navigation-schemas.js'),
    join(dashboardRoot, 'js/lib/navigation-config.js'),
  ];
}

export function verifyHarnessNoCycles() {
  const files = [...listHarnessModules(), ...listNavigationModules()];
  const graph = buildImportGraph(files);
  const cycles = findCycles(graph);
  return cycles.map((c) => `circular import: ${c.join(' → ')}`);
}
