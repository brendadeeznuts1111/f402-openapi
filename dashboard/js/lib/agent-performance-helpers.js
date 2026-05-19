/** Pure helpers for agent performance view (unit-testable). */

export const AGENT_PERF_TYPES = [
  { value: 'CP', label: 'Customer Performance' },
  { value: 'CPS', label: 'Sport Performance' },
  { value: 'CPV', label: 'Customer Volume' },
  { value: 'G', label: 'Graded Wagers' },
];

export { buildAgentPerfQueryString } from './query-builders.js';

export function columnsForAgentPerfType(type, sampleRow) {
  if (type === 'CPS' || type === 'G' || sampleRow?.sport_type) return 'sport';
  return 'customer';
}

export function parseCustomerFromPerfRow(row) {
  const cid = String(row?.customer_id ?? '').trim();
  const loginRaw = String(row?.login ?? '').trim();
  const login = loginRaw.split(/\s+/)[0]?.replace(/\(.*$/, '').trim() || loginRaw;
  return { customerId: cid, login: login || cid };
}

import { formatDataSourceLabel } from './data-source-label.js';

export function formatAgentPerfMeta(data) {
  const type = data?.type ?? 'CP';
  const label = data?.type_label ?? type;
  const src = formatDataSourceLabel(data);
  const stale = data?.stale ? ' · stale' : '';
  const when = data?.timeAgo ?? data?.fetched_at ?? '';
  return `${label} · ${data?.total ?? 0} rows · ${src}${stale}${when ? ` · ${when}` : ''}`;
}
