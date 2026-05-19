/** Pure helpers for agent performance view (unit-testable). */

export const AGENT_PERF_TYPES = [
  { value: 'CP', label: 'Customer Performance' },
  { value: 'CPS', label: 'Sport Performance' },
  { value: 'CPV', label: 'Customer Volume' },
  { value: 'G', label: 'Graded Wagers' },
];

export function buildAgentPerfQueryString(filters) {
  const type = filters.type ?? 'CP';
  const freePlay = filters.freePlay ?? 'Y';
  const start = filters.start ?? '';
  const end = filters.end ?? '';
  const parts = [`type=${encodeURIComponent(type)}`, `free_play=${encodeURIComponent(freePlay)}`];
  if (start) {
    parts.push(`start_date=${encodeURIComponent(start)}`, `start=${encodeURIComponent(start)}`);
  }
  if (end) {
    parts.push(`end_date=${encodeURIComponent(end)}`, `end=${encodeURIComponent(end)}`);
  }
  return parts.join('&');
}

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

export function formatAgentPerfMeta(data) {
  const type = data?.type ?? 'CP';
  const label = data?.type_label ?? type;
  const cached = data?.cached ? ' · cached' : '';
  const when = data?.timeAgo ?? data?.fetched_at ?? '';
  return `${label} · ${data?.total ?? 0} rows${when ? ` · ${when}` : ''}${cached}`;
}
