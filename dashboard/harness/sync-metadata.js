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
import { runNavigationSyncChecks } from './navigation-verify.js';
import {
  SIDEBAR_CONFIG,
  GROUP_TABS,
  TAB_PATHS,
} from '../js/lib/navigation-config.js';

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
    'navigation-registry.json',
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

export function verifyCloudflareManifestBindings() {
  const findings = [];
  const manifest = JSON.parse(readFileSync(join(dashboardRoot, 'public/manifest.json'), 'utf8'));
  const workerBindings = manifest.cloudflare?.workers?.[0]?.environment_bindings?.d1_databases ?? [];
  const requiredBindings = ['DB_AGENTS', 'DB_TRANSACTIONS', 'DB_WAGERS'];

  for (const binding of requiredBindings) {
    if (!workerBindings.includes(binding)) {
      findings.push(`Missing D1 binding ${binding} in manifest.cloudflare.workers`);
    }
  }

  return findings;
}

export function verifyCloudflarePagesIngestionConfig() {
  const findings = [];
  const manifest = JSON.parse(readFileSync(join(dashboardRoot, 'public/manifest.json'), 'utf8'));
  const dashboardProject = manifest.cloudflare?.pages_projects?.dashboard;
  const pagesSecrets = dashboardProject?.secrets ?? [];
  const commonVars = dashboardProject?.build_config?.environment_variables?.common ?? {};
  const manifestUpstream = commonVars.FANTASY402_WORKER_UPSTREAM;

  const pagesWorkerSource = readFileSync(join(dashboardRoot, '_worker.js'), 'utf8');
  const syncDevVarsSource = readFileSync(join(dashboardRoot, 'scripts/sync-dev-vars.mjs'), 'utf8');
  const setSecretsSource = readFileSync(join(dashboardRoot, 'scripts/set-pages-secrets.sh'), 'utf8');

  if (!manifestUpstream) {
    findings.push('manifest.cloudflare.pages_projects.dashboard missing FANTASY402_WORKER_UPSTREAM');
  } else {
    const quoted = JSON.stringify(manifestUpstream);
    if (!pagesWorkerSource.includes(quoted)) {
      findings.push(`dashboard/_worker.js DEFAULT_WORKER_ORIGIN does not match manifest upstream ${manifestUpstream}`);
    }
    if (!syncDevVarsSource.includes(quoted)) {
      findings.push(`scripts/sync-dev-vars.mjs default upstream does not match manifest upstream ${manifestUpstream}`);
    }
  }

  if (!setSecretsSource.includes('dashboard/public/manifest.json')) {
    findings.push('scripts/set-pages-secrets.sh must read Pages secrets from public/manifest.json');
  }
  if (!setSecretsSource.includes('manifest.cloudflare?.pages_projects?.dashboard?.secrets')) {
    findings.push('scripts/set-pages-secrets.sh must use manifest.cloudflare.pages_projects.dashboard.secrets');
  }
  if (!setSecretsSource.includes('wrangler pages secret put "$secret"')) {
    findings.push('scripts/set-pages-secrets.sh must set each manifest Pages secret through wrangler');
  }
  if (!setSecretsSource.includes('--dry-run')) {
    findings.push('scripts/set-pages-secrets.sh must support --dry-run for manifest secret inspection');
  }
  for (const secret of pagesSecrets) {
    if (secret === 'INGESTION_TRIGGER_TOKEN' && !setSecretsSource.includes('INGESTION_TRIGGER_TOKEN')) {
      findings.push('scripts/set-pages-secrets.sh must support INGESTION_TRIGGER_TOKEN resolution');
    }
  }

  return findings;
}

function readTomlStringValue(source, key) {
  return source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1] ?? '';
}

function readTomlArrayValue(source, key) {
  const raw = source.match(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm'))?.[1] ?? '';
  return [...raw.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function readTomlInlineBindingArray(source, key) {
  const block = source.match(new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\n\\]`, 'm'))?.[1] ?? '';
  return [...block.matchAll(/binding\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
}

function readTomlRepeatedSectionBindings(source, section) {
  const bindings = [];
  const sectionRe = new RegExp(`\\[\\[${section.replace('.', '\\.')}\\]\\]([\\s\\S]*?)(?=\\n\\[\\[|\\n\\[[^\\[]|$)`, 'g');
  let match;
  while ((match = sectionRe.exec(source))) {
    const binding = match[1].match(/\b(?:binding|name)\s*=\s*"([^"]+)"/)?.[1];
    if (binding) bindings.push(binding);
  }
  return bindings;
}

function readTomlVars(source) {
  const block = source.match(/\[vars\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? '';
  return Object.fromEntries(
    [...block.matchAll(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)].map((match) => [match[1], match[2]]),
  );
}

export function verifyCloudflareManifestMatchesWrangler() {
  const findings = [];
  const manifest = JSON.parse(readFileSync(join(dashboardRoot, 'public/manifest.json'), 'utf8'));
  const cloudflare = manifest.cloudflare ?? {};
  const dashboardProject = cloudflare.pages_projects?.dashboard ?? {};
  const worker = cloudflare.workers?.[0] ?? {};
  const workerBindings = worker.environment_bindings ?? {};
  const workerVars = worker.environment_variables?.production ?? {};

  const dashboardWrangler = readFileSync(join(dashboardRoot, 'wrangler.toml'), 'utf8');
  const workerWrangler = readFileSync(join(repoRoot, 'workers/fantasy402-ingestion/wrangler.toml'), 'utf8');

  const dashboardName = readTomlStringValue(dashboardWrangler, 'name');
  if (dashboardName && dashboardName !== 'fantasy402-dashboard') {
    findings.push(`dashboard/wrangler.toml name ${dashboardName} does not match expected Pages project fantasy402-dashboard`);
  }
  const dashboardOutput = readTomlStringValue(dashboardWrangler, 'pages_build_output_dir');
  if (dashboardOutput !== dashboardProject.build_config?.output_dir) {
    findings.push(`dashboard Pages output_dir ${dashboardProject.build_config?.output_dir} does not match wrangler pages_build_output_dir ${dashboardOutput}`);
  }
  const dashboardCompatibilityDate = readTomlStringValue(dashboardWrangler, 'compatibility_date');
  if (dashboardCompatibilityDate !== dashboardProject.build_config?.compatibility_date) {
    findings.push(`dashboard Pages compatibility_date ${dashboardProject.build_config?.compatibility_date} does not match dashboard/wrangler.toml ${dashboardCompatibilityDate}`);
  }

  const workerName = readTomlStringValue(workerWrangler, 'name');
  if (workerName !== worker.script_name) {
    findings.push(`manifest worker script_name ${worker.script_name} does not match worker wrangler name ${workerName}`);
  }
  const accountId = readTomlStringValue(workerWrangler, 'account_id');
  if (accountId !== cloudflare.account_id) {
    findings.push(`manifest cloudflare.account_id ${cloudflare.account_id} does not match worker wrangler account_id ${accountId}`);
  }
  const mainModule = `workers/fantasy402-ingestion/${readTomlStringValue(workerWrangler, 'main')}`;
  if (mainModule !== worker.main_module) {
    findings.push(`manifest worker main_module ${worker.main_module} does not match worker wrangler main ${mainModule}`);
  }

  if (workerVars.ENVIRONMENT !== 'production') {
    findings.push('manifest worker production environment must include ENVIRONMENT=production');
  }

  const wranglerKv = readTomlInlineBindingArray(workerWrangler, 'kv_namespaces');
  const wranglerD1 = readTomlRepeatedSectionBindings(workerWrangler, 'd1_databases');
  const wranglerR2 = readTomlRepeatedSectionBindings(workerWrangler, 'r2_buckets');
  const wranglerDo = readTomlRepeatedSectionBindings(workerWrangler, 'durable_objects.bindings');
  const wranglerSecrets = readTomlRepeatedSectionBindings(workerWrangler, 'secrets_store_secrets');
  const wranglerVars = readTomlVars(workerWrangler);
  const wranglerFlags = readTomlArrayValue(workerWrangler, 'compatibility_flags');

  if (wranglerVars.CLOUDFLARE_ZONE_ID !== cloudflare.zone_id) {
    findings.push(`manifest cloudflare.zone_id ${cloudflare.zone_id} does not match worker wrangler CLOUDFLARE_ZONE_ID ${wranglerVars.CLOUDFLARE_ZONE_ID}`);
  }

  for (const binding of wranglerKv) {
    if (!workerBindings.kv_namespaces?.includes(binding)) {
      findings.push(`manifest worker kv_namespaces missing wrangler binding ${binding}`);
    }
  }
  for (const binding of wranglerD1) {
    if (!workerBindings.d1_databases?.includes(binding)) {
      findings.push(`manifest worker d1_databases missing wrangler binding ${binding}`);
    }
  }
  for (const binding of wranglerR2) {
    if (!workerBindings.r2_buckets?.includes(binding)) {
      findings.push(`manifest worker r2_buckets missing wrangler binding ${binding}`);
    }
  }
  for (const binding of wranglerDo) {
    if (!workerBindings.durable_objects?.includes(binding)) {
      findings.push(`manifest worker durable_objects missing wrangler binding ${binding}`);
    }
  }
  for (const secret of wranglerSecrets) {
    if (!worker.secrets?.includes(secret)) {
      findings.push(`manifest worker secrets missing wrangler Secrets Store binding ${secret}`);
    }
  }
  for (const [key, value] of Object.entries(wranglerVars)) {
    if (key === 'CLOUDFLARE_ACCOUNT_ID' || key === 'CLOUDFLARE_ZONE_ID') continue;
    if (workerVars[key] !== value) {
      findings.push(`manifest worker production var ${key} does not match worker wrangler.toml`);
    }
  }
  if (!wranglerFlags.includes('nodejs_compat')) {
    findings.push('worker wrangler.toml must keep nodejs_compat compatibility flag');
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
  findings.push(...verifyCloudflareManifestBindings());
  findings.push(...verifyCloudflarePagesIngestionConfig());
  findings.push(...verifyCloudflareManifestMatchesWrangler());

  const agentsPath = join(repoRoot, 'AGENTS.md');
  const agentsContent = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
  if (agentsContent) {
    findings.push(...verifyAgentsMd(agentsContent, loadMetadata('repo-metadata.json')));
  }

  findings.push(
    ...runNavigationSyncChecks({
      sidebarConfig: SIDEBAR_CONFIG,
      groupTabs: GROUP_TABS,
      tabPaths: TAB_PATHS,
      llmsContent: llms,
      agentsContent,
    }),
  );

  return findings;
}
