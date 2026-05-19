// dashboard/js/constants.js
// Canonical zone colors, endpoint mappings, and refresh intervals.
// Shared contract between Worker and Dashboard (zero-build).

const ZONE_COLORS = {
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

const ENDPOINT_ZONE_MAP = {
  '/ingest': 'ingestion',
  '/bet-ticker': 'query',
  '/performance': 'query',
  '/graded': 'query',
  '/authorizations': 'query',
  '/alert-rules': 'auth',
  '/alert-log': 'auth',
  '/health': 'auth',
  '/diagnostics': 'auth',
  '/runs': 'auth',
  '/scans': 'network',
  '/scanner': 'network',
  '/update-cookies': 'cookie',
  '/live-wagers': 'do',
  '/broadcast': 'do',
};

const REFRESH_INTERVALS = {
  '/live-wagers': 'realtime',
  '/bet-ticker-wagers': 5000,
  '/graded-wagers': 10000,
  '/summary': 15000,
  '/performance': 15000,
  '/prop-wagers': 15000,
  '/alert-log': 30000,
  '/authorizations': 30000,
  '/position-data': 30000,
  '/players': 30000,
  '/health': 30000,
  '/diagnostics': 60000,
  '/runs': 30000,
  '/scans': 30000,
  '/scanner/diagnostics': 60000,
};

function getZoneColor(endpoint) {
  for (const [prefix, zone] of Object.entries(ENDPOINT_ZONE_MAP)) {
    if (endpoint.startsWith(prefix)) return ZONE_COLORS[zone];
  }
  return ZONE_COLORS.worker;
}

function getRefreshInterval(endpoint) {
  return REFRESH_INTERVALS[endpoint] || 30000;
}

function getZone(endpoint) {
  for (const [prefix, zone] of Object.entries(ENDPOINT_ZONE_MAP)) {
    if (endpoint.startsWith(prefix)) return zone;
  }
  return 'worker';
}
