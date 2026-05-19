/** Pure helpers for customers view (unit-testable). */

export function defaultAnalysisDates(now = new Date()) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 14 * 24 * 60 * 60 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

export { buildCustomerProfilePath } from './query-builders.js';

export function buildAnalysisQueryParams(filters) {
  const parts = [];
  if (filters.start) parts.push(`start_date=${encodeURIComponent(filters.start)}`);
  if (filters.end) parts.push(`end_date=${encodeURIComponent(filters.end)}`);
  parts.push(`report_type=${encodeURIComponent(String(filters.reportType ?? '2'))}`);
  parts.push(`line_type=${encodeURIComponent(String(filters.lineType ?? '2'))}`);
  return parts.length ? `&${parts.join('&')}` : '';
}

export function sourceBadgeKind(activeSource, cached = false) {
  if (activeSource === 'live') return cached ? 'live-cached' : 'live';
  if (activeSource === 'seeded') return 'seeded';
  if (activeSource === 'failed') return 'failed';
  return 'none';
}

export function pickPerformanceColumns(rows, preferredKeys) {
  if (!rows?.length) return [];
  const keys = new Set();
  for (const row of rows.slice(0, 5)) {
    Object.keys(row).forEach((k) => keys.add(k));
  }
  const picked = preferredKeys.filter((k) => keys.has(k));
  if (picked.length) return picked;
  return Array.from(keys).slice(0, 8);
}

export function getInfoFromProfileData(profile) {
  const live = profile?.live?.getInfoPlayer;
  if (live?.ok && live.data) {
    return { data: live.data, balance: live.balance, source: 'live' };
  }
  const facet = profile?.facets?.getInfoPlayer;
  const data = facet?.INFO?.data ?? facet?.data;
  const balance = facet?.INFO?.balance ?? facet?.balance;
  if (data || balance) return { data, balance, source: 'd1' };
  const account = profile?.account?.data;
  if (account) return { data: account, balance: null, source: 'account' };
  return { data: null, balance: null, source: null };
}
