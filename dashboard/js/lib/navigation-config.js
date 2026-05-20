/**
 * Typed sidebar navigation — source of truth for 24 tabs in 7 groups.
 */
import {
  sidebarConfigSchema,
  tabIdSchema,
  navItemSchema,
  navGroupSchema,
} from './navigation-schemas.js';

export const SIDEBAR_CONFIG = sidebarConfigSchema.parse({
  version: 1,
  groups: [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { id: 'overview', label: 'Overview', path: '/dashboard/overview', viewId: 'overview', workerApiPath: '/summary' },
        { id: 'analytics', label: 'Analytics', path: '/dashboard/analytics', viewId: 'analytics', workerApiPath: '/chart-aggregates' },
        { id: 'logs', label: 'Logs', path: '/dashboard/logs', viewId: 'logs', openApiOperationId: 'listIngestionRuns', workerApiPath: '/runs' },
      ],
    },
    {
      id: 'operations',
      label: 'Operations',
      items: [
        { id: 'endpoints', label: 'Endpoints', path: '/dashboard/endpoints', viewId: 'endpoints', openApiOperationId: 'listWorkerEndpoints', workerApiPath: '/upstream-endpoints' },
        { id: 'pending', label: 'Pending Wagers', path: '/dashboard/pending', viewId: 'pending', workerApiPath: '/pending-wagers' },
        { id: 'activity', label: 'Activity', path: '/dashboard/activity', viewId: 'activity', workerApiPath: '/customer-activity' },
        { id: 'alerts', label: 'Alerts', path: '/dashboard/alerts', viewId: 'alerts', openApiOperationId: 'listAlertEvents', workerApiPath: '/alerts' },
      ],
    },
    {
      id: 'customers',
      label: 'Customers',
      items: [
        { id: 'customers', label: 'Search', path: '/dashboard/customers', viewId: 'customers', workerApiPath: '/search-customers' },
        { id: 'customer-profile', label: 'Profile', path: '/dashboard/customer-profile', viewId: 'customers', workerApiPath: '/customer-profile' },
        { id: 'agent-performance', label: 'Agent Perf', path: '/dashboard/agent-performance', viewId: 'customers', workerApiPath: '/agent-performance-live' },
      ],
    },
    {
      id: 'data',
      label: 'Data',
      items: [
        { id: 'data-graded', label: 'Graded', path: '/dashboard/data-graded', viewId: 'data', workerApiPath: '/graded-wagers' },
        { id: 'data-props', label: 'Props', path: '/dashboard/data-props', viewId: 'data', workerApiPath: '/prop-wagers' },
        { id: 'data-positions', label: 'Positions', path: '/dashboard/data-positions', viewId: 'data', workerApiPath: '/position-data' },
        { id: 'data-players', label: 'Players', path: '/dashboard/data-players', viewId: 'data', workerApiPath: '/players' },
      ],
    },
    {
      id: 'finance',
      label: 'Finance',
      items: [
        { id: 'transactions', label: 'Transactions', path: '/dashboard/transactions', viewId: 'transactions', workerApiPath: '/transactions-live' },
        { id: 'weekly-figures', label: 'Weekly Figures', path: '/dashboard/weekly-figures', workerApiPath: '/weekly-figures' },
        { id: 'authorizations', label: 'Authorizations', path: '/dashboard/authorizations', viewId: 'data', workerApiPath: '/authorizations' },
      ],
    },
    {
      id: 'ingestion',
      label: 'Ingestion',
      items: [
        { id: 'ingest-catalog', label: 'Catalog', path: '/dashboard/ingest-catalog', workerApiPath: '/ingest/catalog-status' },
        { id: 'ingest-runs', label: 'Runs', path: '/dashboard/ingest-runs', openApiOperationId: 'listIngestionRuns', workerApiPath: '/runs' },
        { id: 'ingest-local', label: 'Local Plan', path: '/dashboard/ingest-local', workerApiPath: '/ingest/local/plan' },
        { id: 'upstream', label: 'Upstream', path: '/dashboard/upstream', openApiOperationId: 'listWorkerEndpoints', workerApiPath: '/upstream-endpoints' },
      ],
    },
    {
      id: 'system',
      label: 'System',
      items: [
        { id: 'settings', label: 'Settings', path: '/dashboard/settings', viewId: 'settings' },
        { id: 'diagnostics', label: 'Diagnostics', path: '/dashboard/diagnostics', openApiOperationId: 'getDiagnostics', workerApiPath: '/diagnostics' },
        { id: 'health', label: 'Health', path: '/dashboard/health', openApiOperationId: 'getAuthHealth', workerApiPath: '/auth/health' },
      ],
    },
  ],
});

export const TAB_PATHS = Object.freeze(
  Object.fromEntries(
    SIDEBAR_CONFIG.groups.flatMap((g) => g.items.map((item) => [item.id, item.path])),
  ),
);

export const PATH_TO_TAB = Object.freeze(
  Object.fromEntries(
    SIDEBAR_CONFIG.groups.flatMap((g) => g.items.map((item) => [item.path, item.id])),
  ),
);

export const GROUP_TABS = Object.freeze(
  Object.fromEntries(SIDEBAR_CONFIG.groups.map((g) => [g.id, g.items.map((i) => i.id)])),
);

const ALL_TAB_IDS = new Set(Object.keys(TAB_PATHS));

export function isValidTabId(tabId) {
  return tabIdSchema.safeParse(tabId).success && ALL_TAB_IDS.has(tabId);
}

export function getTabPath(tabId) {
  const parsed = tabIdSchema.safeParse(tabId);
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  const path = TAB_PATHS[parsed.data];
  if (!path) {
    return {
      ok: false,
      error: {
        issues: [{ path: ['tabId'], message: `unknown tab: ${tabId}`, code: 'custom' }],
      },
    };
  }
  return { ok: true, path };
}

export function getTabGroup(tabId) {
  const parsed = tabIdSchema.safeParse(tabId);
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  for (const group of SIDEBAR_CONFIG.groups) {
    if (group.items.some((item) => item.id === parsed.data)) {
      return { ok: true, groupId: group.id, groupLabel: group.label };
    }
  }
  return {
    ok: false,
    error: {
      issues: [{ path: ['tabId'], message: `unknown tab: ${tabId}`, code: 'custom' }],
    },
  };
}

export function serializeNavigationSnapshot() {
  return {
    sidebarConfig: SIDEBAR_CONFIG,
    tabPaths: TAB_PATHS,
    pathToTab: PATH_TO_TAB,
    groupTabs: GROUP_TABS,
    tabCount: ALL_TAB_IDS.size,
    groupCount: SIDEBAR_CONFIG.groups.length,
  };
}

export { navItemSchema, navGroupSchema, sidebarConfigSchema };
