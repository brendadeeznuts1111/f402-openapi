#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const defaultManifestPath = join(repoRoot, 'contracts/production-manifest.json');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function normalizeRelativePath(path, label) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`${label} must stay inside the repository: ${path}`);
  }
  return normalized;
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') stack.push(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  }
  return out.sort();
}

function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    const next = glob[i + 1];
    if (char === '*') {
      if (next === '*') {
        const after = glob[i + 2];
        if (after === '/') {
          re += '(?:.*\\/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (char === '?') {
      re += '[^/]';
    } else {
      re += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${re}$`);
}

export function listMatchingFiles({ cwd, include }, root = repoRoot) {
  const relCwd = normalizeRelativePath(cwd, 'test suite cwd');
  const cwdAbs = join(root, relCwd);
  if (!existsSync(cwdAbs) || !statSync(cwdAbs).isDirectory()) {
    throw new Error(`test suite cwd does not exist: ${relCwd}`);
  }
  if (!Array.isArray(include) || include.length === 0) {
    throw new Error(`test suite ${relCwd} must declare at least one include glob`);
  }
  const matchers = include.map((pattern, index) =>
    globToRegExp(normalizeRelativePath(pattern, `test suite include[${index}]`)),
  );
  return walkFiles(cwdAbs)
    .map((path) => relative(cwdAbs, path).split(sep).join('/'))
    .filter((path) => matchers.some((matcher) => matcher.test(path)))
    .sort();
}

export function countTestDeclarations(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments.replace(/(^|[^:])\/\/.*$/gm, '$1');
  const matches = withoutLineComments.match(/(?:^|[^\w$.])(?:test|it)\s*(?:\.\w+)?\s*\(/g);
  return matches?.length ?? 0;
}

export function deriveTestSuite(suite, root = repoRoot) {
  assertPlainObject(suite, 'test suite');
  const id = typeof suite.id === 'string' && suite.id ? suite.id : null;
  if (!id) throw new Error('test suite id must be a non-empty string');
  const files = listMatchingFiles(suite, root);
  if (files.length === 0) throw new Error(`test suite ${id} did not match any files`);
  const cwdAbs = join(root, suite.cwd);
  const testsByFile = Object.fromEntries(
    files.map((file) => [file, countTestDeclarations(readFileSync(join(cwdAbs, file), 'utf8'))]),
  );
  return {
    id,
    cwd: suite.cwd,
    command: suite.command,
    files,
    fileCount: files.length,
    testCount: Object.values(testsByFile).reduce((sum, count) => sum + count, 0),
    testsByFile,
  };
}

export function deriveRelease(release, root = repoRoot) {
  assertPlainObject(release, 'release');
  const packages = Array.isArray(release.packages) ? release.packages : [];
  if (packages.length === 0) throw new Error('release.packages must list package metadata sources');
  const packageVersions = {};
  for (const pkg of packages) {
    assertPlainObject(pkg, 'release package');
    const id = typeof pkg.id === 'string' && pkg.id ? pkg.id : null;
    if (!id) throw new Error('release package id must be a non-empty string');
    const relPath = normalizeRelativePath(pkg.path, `release package ${id} path`);
    const packageJson = readJson(join(root, relPath));
    packageVersions[id] = {
      path: relPath,
      name: packageJson.name,
      version: packageJson.version ?? null,
      private: packageJson.private === true,
    };
  }
  const versionSource = normalizeRelativePath(release.versionSource ?? packages[0].path, 'release.versionSource');
  const versionPackage = readJson(join(root, versionSource));
  return {
    version: versionPackage.version,
    versionSource,
    packages: packageVersions,
  };
}

export function validateProductionManifest(manifestPath = defaultManifestPath, root = repoRoot) {
  const manifest = readJson(manifestPath);
  assertPlainObject(manifest, 'manifest');
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1');
  if (typeof manifest.name !== 'string' || !manifest.name) {
    throw new Error('manifest.name must be a non-empty string');
  }
  if ('testCount' in manifest || 'testCounts' in manifest || 'releaseVersion' in manifest) {
    throw new Error('manifest must derive test counts and release metadata from sources, not hard-code them');
  }

  const testSuites = Array.isArray(manifest.testSuites) ? manifest.testSuites : [];
  if (testSuites.length === 0) throw new Error('manifest.testSuites must contain at least one suite');
  const suites = testSuites.map((suite) => deriveTestSuite(suite, root));
  const release = deriveRelease(manifest.release, root);
  return {
    manifest: {
      name: manifest.name,
      schemaVersion: manifest.schemaVersion,
    },
    release,
    testSuites: suites,
    counts: {
      suiteCount: suites.length,
      testFileCount: suites.reduce((sum, suite) => sum + suite.fileCount, 0),
      testCount: suites.reduce((sum, suite) => sum + suite.testCount, 0),
    },
  };
}

export function formatValidationSummary(result) {
  const lines = [
    `Production manifest validates: ${result.manifest.name}`,
    `Release version: ${result.release.version} (${result.release.versionSource})`,
    `Test suites: ${result.counts.suiteCount}`,
    `Test files: ${result.counts.testFileCount}`,
    `Test declarations: ${result.counts.testCount}`,
  ];
  for (const suite of result.testSuites) {
    lines.push(`  - ${suite.id}: ${suite.fileCount} files, ${suite.testCount} tests`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifestPath = process.argv[2] ? resolve(process.argv[2]) : defaultManifestPath;
    process.stdout.write(formatValidationSummary(validateProductionManifest(manifestPath)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Production manifest validation failed: ${message}\n`);
    process.exitCode = 1;
  }
}
