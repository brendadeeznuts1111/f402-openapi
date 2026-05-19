/**
 * Automated checks that llms.txt, AGENTS.md, and harness manifests match live code.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMetadata,
  parseWorkerApiManifest,
  readWorkerIndexSource,
  readRepoFile,
  verifyPagesWorkerPublicPaths,
} from './verify.js';

const harnessDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(harnessDir, '../..');
const dashboardRoot = join(harnessDir, '..');

export function extractDashboardSchemaExports(schemasSource) {
  return [...schemasSource.matchAll(/export const (\w+Schema)\b/g)].map((m) => m[1]).sort();
}

export function extractViewModules(viewsDir) {
  return readdirSync(viewsDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

/** Paths referenced by views must appear in llms.txt (as route or path fragment). */
export function verifyLlmsTxtRouteCoverage({ llmsContent, viewRoutes, dashboardRoutes }) {
  const findings = [];
  const haystack = llmsContent;

  const allApiPaths = new Set();
  for (const view of viewRoutes) {
    for (const p of view.apiPaths ?? []) allApiPaths.add(p);
  }
  for (const r of dashboardRoutes) {
    if (!r.public) allApiPaths.add(r.path);
  }

  const documented = new Set();
  for (const m of haystack.matchAll(/`?(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w./-]+)`?/g)) {
    documented.add(m[2]);
  }
  for (const m of haystack.matchAll(/`(\/[\w./-]+)`/g)) {
    documented.add(m[1]);
  }

  const priorityPaths = [...allApiPaths].filter(
    (p) =>
      p.startsWith('/customer') ||
      p.startsWith('/pending') ||
      p.startsWith('/transactions') ||
      p.startsWith('/search') ||
      p.startsWith('/agent-performance') ||
      p.startsWith('/ingest/catalog'),
  );

  for (const path of priorityPaths) {
    const bare = path.split('?')[0];
    const mentioned =
      haystack.includes(bare) ||
      haystack.includes(`GET ${bare}`) ||
      [...documented].some((d) => d === bare || d.startsWith(bare));
    if (!mentioned) {
      findings.push(`llms.txt missing reference to dashboard route ${bare}`);
    }
  }

  return findings;
}

export function verifyLlmsTxtArtifacts(llmsContent) {
  const findings = [];
  const requiredFragments = [
    'workers/fantasy402-ingestion/upstream-endpoints.json',
    'workers/fantasy402-ingestion/openapi.worker.json',
    'dashboard/harness',
    'docs/dashboard.md',
  ];
  for (const frag of requiredFragments) {
    if (!llmsContent.includes(frag)) {
      findings.push(`llms.txt must mention ${frag}`);
    }
  }
  return findings;
}

export function verifyAgentsMd(agentsContent, repoMeta) {
  const findings = [];
  const optional = repoMeta.optionalFiles?.find((f) => f.path === 'AGENTS.md');
  if (!optional) return findings;

  const required = ['test:harness', 'harness', 'llms.txt'];
  for (const needle of required) {
    if (!agentsContent.includes(needle)) {
      findings.push(`AGENTS.md must mention ${needle}`);
    }
  }
  return findings;
}

export function verifyViewModulesInManifest({ views, viewsDir }) {
  const findings = [];
  const files = new Set(extractViewModules(viewsDir));
  for (const view of views) {
    if (!files.has(view.module)) {
      findings.push(`view-routes.json references missing module ${view.module}`);
    }
  }
  for (const file of files) {
    if (file === 'index.js') continue;
    if (!views.some((v) => v.module === file || v.nestedModules?.includes(file))) {
      findings.push(`views/${file} exists but is not listed in view-routes.json`);
    }
  }
  return findings;
}

export function verifySchemaBindingsInCode({ bindings, dashboardSchemaNames }) {
  const findings = [];
  const names = new Set(dashboardSchemaNames);
  for (const b of bindings) {
    if (!names.has(b.dashboardSchema)) {
      findings.push(
        `schema-bindings.json references ${b.dashboardSchema} but schemas.js does not export it`,
      );
    }
  }
  return findings;
}

export function verifyHarnessManifestInventory() {
  const findings = [];
  const metadataDir = join(harnessDir, 'metadata');
  const onDisk = readdirSync(metadataDir).filter((f) => f.endsWith('.json')).sort();
  const repoMeta = loadMetadata('repo-metadata.json');
  const declared = (repoMeta.requiredFiles ?? [])
    .map((f) => f.path)
    .filter((p) => p.startsWith('dashboard/harness/metadata/'))
    .map((p) => p.replace('dashboard/harness/metadata/', ''));

  for (const file of onDisk) {
    if (file === 'repo-metadata.json') continue;
    if (!declared.includes(file) && file !== 'schema-registry.json' && file !== 'zod-cases.json') {
      findings.push(
        `harness metadata/${file} exists but is not listed in repo-metadata.json requiredFiles`,
      );
    }
  }

  const expectedCore = [
    'public-routes.json',
    'dashboard-api-routes.json',
    'schema-bindings.json',
    'components.manifest.json',
    'view-routes.json',
    'schema-registry.json',
    'zod-cases.json',
    'openapi-samples.json',
  ];
  for (const file of expectedCore) {
    if (!onDisk.includes(file)) {
      findings.push(`harness metadata missing core file ${file}`);
    }
  }

  return findings;
}

export function verifyWorkerRoutesInDashboardManifest() {
  const findings = [];
  const dashboard = loadMetadata('dashboard-api-routes.json').routes;
  const worker = parseWorkerApiManifest(readWorkerIndexSource());
  const dashPaths = new Set(dashboard.map((r) => r.path));

  for (const view of loadMetadata('view-routes.json').views) {
    for (const apiPath of view.apiPaths ?? []) {
      if (!dashPaths.has(apiPath)) {
        findings.push(`view ${view.id} uses ${apiPath} not in dashboard-api-routes.json`);
      }
    }
  }

  return findings;
}

/** Every non-public dashboard API route should be mentioned in llms.txt. */
export function verifyLlmsTxtListsAllDashboardRoutes({ llmsContent, dashboardRoutes }) {
  const findings = [];
  for (const route of dashboardRoutes) {
    if (route.public) continue;
    const bare = route.path.split('?')[0];
    if (!llmsContent.includes(bare)) {
      findings.push(`llms.txt missing dashboard route ${bare}`);
    }
  }
  return findings;
}

/** Sidebar view ids should appear in docs (llms.txt or harness README). */
export function verifyViewIdsDocumented({ views, llmsContent, harnessReadme }) {
  const findings = [];
  const haystack = `${llmsContent}\n${harnessReadme}`;
  for (const view of views) {
    if (!haystack.includes(view.id) && !haystack.includes(view.module.replace('.js', ''))) {
      findings.push(
        `docs missing reference to view "${view.id}" (add to llms.txt or harness README)`,
      );
    }
  }
  return findings;
}

/** Run all metadata sync checks; returns string[] findings. */
export function runMetadataSyncChecks() {
  const findings = [];
  const llms = readRepoFile('llms.txt');
  const views = loadMetadata('view-routes.json').views;
  const routes = loadMetadata('dashboard-api-routes.json').routes;
  const bindings = loadMetadata('schema-bindings.json').bindings;
  const schemasJs = readFileSync(join(dashboardRoot, 'js/lib/schemas.js'), 'utf8');
  const viewsDir = join(dashboardRoot, 'js/views');

  const harnessReadme = readFileSync(join(harnessDir, 'README.md'), 'utf8');
  const pub = loadMetadata('public-routes.json');

  findings.push(...verifyLlmsTxtArtifacts(llms));
  findings.push(...verifyLlmsTxtRouteCoverage({ llmsContent: llms, viewRoutes: views, dashboardRoutes: routes }));
  findings.push(...verifyLlmsTxtListsAllDashboardRoutes({ llmsContent: llms, dashboardRoutes: routes }));
  findings.push(...verifyViewIdsDocumented({ views, llmsContent: llms, harnessReadme }));
  findings.push(...verifyPagesWorkerPublicPaths(pub));
  findings.push(...verifyViewModulesInManifest({ views, viewsDir }));
  findings.push(
    ...verifySchemaBindingsInCode({
      bindings,
      dashboardSchemaNames: extractDashboardSchemaExports(schemasJs),
    }),
  );
  findings.push(...verifyHarnessManifestInventory());
  findings.push(...verifyWorkerRoutesInDashboardManifest());

  const agentsPath = join(repoRoot, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    findings.push(...verifyAgentsMd(readFileSync(agentsPath, 'utf8'), loadMetadata('repo-metadata.json')));
  }

  return findings;
}
