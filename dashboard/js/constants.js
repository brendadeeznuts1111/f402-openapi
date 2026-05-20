// dashboard/js/constants.js
// Single source of truth for zone colors, endpoint mappings, refresh intervals.
// Used by design-system.js, api-client.js, and all views.
// ESM exports (loaded via <script type="module"> import).
// Backward-compat globals set on window for the existing inline <script>.

/** Semantic colors for Chart.js and inline charts (matches :root tokens). */
/** Live bet ticker WebSocket worker (replaces SSE /live-wagers when set). */
export const DEFAULT_BET_TICKER_WS_URL =
  'wss://bet-ticker-worker.utahj4754.workers.dev';

/** Worker routes reachable without bearer token via Pages proxy (see dashboard/_worker.js). */
export const PUBLIC_API_PATHS = ['/health', '/auth/health', '/live-wagers'];

const CHART_COLOR_FALLBACKS = {
  success: '#00FF88',
  warning: '#FFD700',
  info: '#00BFFF',
  accent: '#FF6B35',
  purple: '#DA70D6',
};

/** Static fallbacks (SSR / tests). Prefer getChartColors() at render time. */
export const CHART_COLORS = { ...CHART_COLOR_FALLBACKS };

function readCssToken(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Read chart dataset colors from CSS tokens (theme-aware). */
export function getChartColors() {
  return {
    success: readCssToken('--success', CHART_COLOR_FALLBACKS.success),
    warning: readCssToken('--warning', CHART_COLOR_FALLBACKS.warning),
    info: readCssToken('--info', CHART_COLOR_FALLBACKS.info),
    accent: readCssToken('--accent', CHART_COLOR_FALLBACKS.accent),
    purple: readCssToken('--purple', CHART_COLOR_FALLBACKS.purple),
  };
}

/** Wager type distribution: Straight, Parlay, Moneyline, Live */
export function getWagerTypeChartColors() {
  const c = getChartColors();
  return [c.success, c.warning, c.info, c.purple];
}

/** @deprecated use getWagerTypeChartColors() */
export const WAGER_TYPE_CHART_COLORS = [
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.info,
  CHART_COLORS.purple,
];

export const ZONE_COLORS = {
  worker:    { bg: '#1E3A5F', fg: '#FFFFFF', ansi: '48;5;17;38;5;255' },
  ingestion: { bg: '#2D1B0E', fg: '#FF6B35', ansi: '48;5;52;38;5;208' },
  query:     { bg: '#0E2D1B', fg: '#00FF88', ansi: '48;5;22;38;5;84' },
  auth:      { bg: '#2D2D0E', fg: '#FFD700', ansi: '48;5;58;38;5;220' },
  do:        { bg: '#1E0E2D', fg: '#DA70D6', ansi: '48;5;53;38;5;213' },
  data:      { bg: '#2D1E0E', fg: '#CD853F', ansi: '48;5;94;38;5;180' },
  upstream:  { bg: '#0E0E2D', fg: '#6B8E23', ansi: '48;5;17;38;5;64' },
  cookie:    { bg: '#2D0E0E', fg: '#FF4444', ansi: '48;5;52;38;5;196' },
  network:   { bg: '#0E1E3A', fg: '#00BFFF', ansi: '48;5;17;38;5;39' },
};

export const ENDPOINT_ZONE_MAP = {
  '/upstream':           'upstream',
  '/ingest':             'ingestion',
  '/chart-aggregates':   'query',
  '/upstream-endpoints': 'upstream',
  '/bet-ticker':         'query',
  '/performance':        'query',
  '/graded':             'query',
  '/prop':               'query',
  '/position':           'query',
  '/authorizations':     'query',
  '/summary':            'query',
  '/alert-rules':        'auth',
  '/alert-log':          'auth',
  '/alerts':             'auth',
  '/health':             'auth',
  '/auth/health':        'auth',
  '/diagnostics':        'auth',
  '/runs':               'auth',
  '/endpoints':          'auth',
  '/endpoint-status':    'auth',
  '/scans':              'network',
  '/scanner':            'network',
  '/update-cookies':     'cookie',
  '/live-wagers':        'do',
  '/broadcast':          'do',
  '/players':            'query',
  '/customer-activity':         'query',
  '/customer-activity-search':  'query',
  '/search-customers':   'query',
  '/customer-profile':   'query',
  '/agent-performance-live': 'query',
  '/weekly-figures':     'query',
  '/pending-wagers':     'query',
  '/transactions-live':  'query',
  '/settings':           'worker',
};

export const REFRESH_INTERVALS = {
  '/live-wagers':        'realtime',
  '/chart-aggregates':    15000,
  '/upstream-endpoints':  60000,
  '/bet-ticker-wagers':   5000,
  '/graded-wagers':      10000,
  '/summary':            15000,
  '/performance':        15000,
  '/prop-wagers':        15000,
  '/alert-log':          30000,
  '/authorizations':     30000,
  '/position-data':      30000,
  '/players':            30000,
  '/search-customers':   30000,
  '/customer-profile':   30000,
  '/agent-performance-live': 45000,
  '/weekly-figures':     30000,
  '/pending-wagers':     15000,
  '/transactions-live':  45000,
  '/health':             30000,
  '/auth/health':        30000,
  '/diagnostics':        60000,
  '/runs':               30000,
  '/scans':              30000,
  '/endpoints':          60000,
  '/endpoint-status':    30000,
  '/alerts':             30000,
  '/alerts/summary':     30000,
  '/alert-rules':        30000,
  '/customer-activity':         30000,
  '/customer-activity-search':  30000,
  '/settings':             'manual',
};

export function getZoneColor(endpoint) {
  for (const [prefix, zone] of Object.entries(ENDPOINT_ZONE_MAP)) {
    if (endpoint.startsWith(prefix)) return ZONE_COLORS[zone];
  }
  return ZONE_COLORS.worker;
}

export function getRefreshInterval(endpoint) {
  for (const [prefix, ms] of Object.entries(REFRESH_INTERVALS)) {
    if (endpoint.startsWith(prefix)) return ms;
  }
  return 30000;
}

export function getZone(endpoint) {
  for (const [prefix, zone] of Object.entries(ENDPOINT_ZONE_MAP)) {
    if (endpoint.startsWith(prefix)) return zone;
  }
  return 'worker';
}

// Backward-compat globals for the existing inline <script> in index.html
// Remove once index.html migrates to <script type="module">
if (typeof window !== 'undefined') {
  const w = /** @type {Window & typeof globalThis & Record<string, unknown>} */ (window);
  w.ZONE_COLORS = ZONE_COLORS;
  w.ENDPOINT_ZONE_MAP = ENDPOINT_ZONE_MAP;
  w.REFRESH_INTERVALS = REFRESH_INTERVALS;
  w.getZoneColor = getZoneColor;
  w.getRefreshInterval = getRefreshInterval;
  w.getZone = getZone;
}
