/**
 * Navigation harness verification — manifest, llms.txt, OpenAPI operationIds.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOpenApiWorkerSpec, parseWorkerApiManifest, readWorkerIndexSource } from './verify.js';

const harnessDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = join(harnessDir, '..');
const repoRoot = join(harnessDir, '../..');

/** UI tabs with no worker/OpenAPI anchor (local-only panels). */
export const UI_ONLY_TAB_IDS = new Set(['settings']);

export function collectOpenApiPaths(openApiSpec) {
  return new Set(Object.keys(openApiSpec.paths ?? {}));
}

export function collectOpenApiOperationIds(openApiSpec) {
  const ids = new Set();
  for (const pathItem of Object.values(openApiSpec.paths ?? {})) {
    for (const op of Object.values(pathItem ?? {})) {
      if (op && typeof op === 'object' && typeof op.operationId === 'string') {
        ids.add(op.operationId);
      }
    }
  }
  return ids;
}

export function verifyManifestNavigation(manifestNav, groupTabs) {
  const findings = [];
  if (!manifestNav) {
    findings.push('public/manifest.json missing navigation object');
    return findings;
  }
  if (manifestNav.version !== 1) {
    findings.push('manifest navigation.version must be 1');
  }
  const manifestGroups = manifestNav.groupTabs ?? {};
  const configKeys = Object.keys(groupTabs).sort();
  const manifestKeys = Object.keys(manifestGroups).sort();
  if (JSON.stringify(configKeys) !== JSON.stringify(manifestKeys)) {
    findings.push('manifest navigation.groupTabs keys do not match GROUP_TABS');
  }
  for (const [groupId, tabs] of Object.entries(groupTabs)) {
    const m = manifestGroups[groupId];
    if (!m) {
      findings.push(`manifest missing group ${groupId}`);
      continue;
    }
    if (JSON.stringify([...m].sort()) !== JSON.stringify([...tabs].sort())) {
      findings.push(`manifest group ${groupId} tab list mismatch`);
    }
  }
  return findings;
}

export function verifyNavigationOpenApiOperations(sidebarConfig, openApiSpec) {
  const findings = [];
  const opIds = collectOpenApiOperationIds(openApiSpec);
  for (const group of sidebarConfig.groups) {
    for (const item of group.items) {
      if (item.openApiOperationId && !opIds.has(item.openApiOperationId)) {
        findings.push(
          `tab ${item.id}: openApiOperationId ${item.openApiOperationId} not in openapi.worker.json`,
        );
      }
    }
  }
  return findings;
}

/**
 * Each navigable tab must declare openApiOperationId and/or workerApiPath;
 * operationIds must exist in spec; worker paths must exist on the worker manifest.
 */
export function verifyNavigationTabApiAnchors(sidebarConfig, openApiSpec, workerRoutes) {
  const findings = [];
  const opIds = collectOpenApiOperationIds(openApiSpec);
  const openApiPaths = collectOpenApiPaths(openApiSpec);
  const workerGet = new Set(
    workerRoutes.filter((r) => r.method === 'GET').map((r) => r.path),
  );

  for (const group of sidebarConfig.groups) {
    for (const item of group.items) {
      if (UI_ONLY_TAB_IDS.has(item.id)) continue;

      if (!item.workerApiPath && !item.openApiOperationId) {
        findings.push(
          `tab ${item.id}: missing workerApiPath and openApiOperationId (path ${item.path})`,
        );
        continue;
      }

      if (item.openApiOperationId && !opIds.has(item.openApiOperationId)) {
        findings.push(
          `tab ${item.id}: openApiOperationId ${item.openApiOperationId} not in openapi.worker.json`,
        );
      }

      if (item.workerApiPath) {
        if (!workerGet.has(item.workerApiPath)) {
          findings.push(
            `tab ${item.id}: workerApiPath ${item.workerApiPath} not in WORKER_API_ROUTES`,
          );
        }
        if (
          item.openApiOperationId &&
          item.workerApiPath &&
          openApiPaths.has(item.workerApiPath) &&
          !opIds.has(item.openApiOperationId)
        ) {
          findings.push(
            `tab ${item.id}: path ${item.workerApiPath} in OpenAPI but operationId missing`,
          );
        }
      }
    }
  }
  return findings;
}

export function verifyNavigationWorkerPaths(sidebarConfig, workerRoutes) {
  const findings = [];
  const paths = new Set(workerRoutes.filter((r) => r.method === 'GET').map((r) => r.path));
  for (const group of sidebarConfig.groups) {
    for (const item of group.items) {
      if (item.workerApiPath && !paths.has(item.workerApiPath)) {
        findings.push(`tab ${item.id}: workerApiPath ${item.workerApiPath} not in WORKER_API_ROUTES`);
      }
    }
  }
  return findings;
}

export function verifyLlmsNavigationPaths(llmsContent, tabPaths) {
  const findings = [];
  for (const path of Object.values(tabPaths)) {
    if (!llmsContent.includes(path)) {
      findings.push(`llms.txt missing navigation path ${path}`);
    }
  }
  return findings;
}

export function verifyAgentsNavigationDoc(agentsContent, sidebarConfig, groupTabs) {
  const findings = [];
  if (!agentsContent.includes('GROUP_TABS') && !agentsContent.includes('navigation')) {
    findings.push('AGENTS.md must document navigation (GROUP_TABS or navigation section)');
  }
  if (!agentsContent.includes(String(sidebarConfig.groups.length))) {
    findings.push('AGENTS.md should mention navigation group count');
  }
  const sampleGroup = sidebarConfig.groups[0]?.id;
  if (sampleGroup && !agentsContent.includes(sampleGroup)) {
    findings.push(`AGENTS.md should reference navigation group "${sampleGroup}"`);
  }
  const tabCount = Object.keys(tabPathsFromConfig(sidebarConfig)).length;
  if (!agentsContent.includes('24') && tabCount === 24) {
    findings.push('AGENTS.md should mention 24 navigation tabs');
  }
  return findings;
}

function tabPathsFromConfig(sidebarConfig) {
  return Object.fromEntries(
    sidebarConfig.groups.flatMap((g) => g.items.map((i) => [i.id, i.path])),
  );
}

export function runNavigationSyncChecks({
  sidebarConfig,
  groupTabs,
  tabPaths,
  llmsContent,
  agentsContent,
}) {
  const findings = [];
  const manifestPath = join(dashboardRoot, 'public/manifest.json');
  if (!existsSync(manifestPath)) {
    findings.push('missing dashboard/public/manifest.json');
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    findings.push(...verifyManifestNavigation(manifest.navigation, groupTabs));
  }

  const openApi = readOpenApiWorkerSpec();
  const worker = parseWorkerApiManifest(readWorkerIndexSource());
  findings.push(...verifyNavigationOpenApiOperations(sidebarConfig, openApi));
  findings.push(...verifyNavigationWorkerPaths(sidebarConfig, worker.routes));
  findings.push(...verifyNavigationTabApiAnchors(sidebarConfig, openApi, worker.routes));

  findings.push(...verifyLlmsNavigationPaths(llmsContent, tabPaths));

  if (agentsContent) {
    findings.push(...verifyAgentsNavigationDoc(agentsContent, sidebarConfig, groupTabs));
  }

  return findings;
}
