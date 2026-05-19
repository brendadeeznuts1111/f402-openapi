// Detect ephemeral Cloudflare Pages deployment URLs (commit hashes).

export const PRODUCTION_DASHBOARD = 'https://fantasy402-dashboard-5q6.pages.dev';
export const BRANCH_DASHBOARD = 'https://feat-dashboard-enhancements.fantasy402-dashboard-5q6.pages.dev';

/** e.g. b6972826.fantasy402-dashboard-5q6.pages.dev */
export function isEphemeralPagesHost(hostname = location.hostname) {
  return /^[a-f0-9]{6,12}\.fantasy402-dashboard/i.test(hostname);
}

export function isStableDashboardHost(hostname = location.hostname) {
  if (hostname === 'fantasy402-dashboard-5q6.pages.dev') return true;
  if (hostname === 'feat-dashboard-enhancements.fantasy402-dashboard-5q6.pages.dev') return true;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  return false;
}

/** Redirect stale hash deploys that lack INGESTION_TRIGGER_TOKEN. */
export function redirectToProductionDashboard() {
  const dest = new URL(PRODUCTION_DASHBOARD);
  dest.pathname = location.pathname;
  dest.search = location.search;
  dest.hash = location.hash;
  if (dest.href === location.href) return;
  location.replace(dest.href);
}
