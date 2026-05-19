/** Validated API query/path builders for dashboard views. */
import {
  agentPerformanceFiltersSchema,
  customerProfilePathSchema,
  pendingWagersFiltersSchema,
  searchCustomersQuerySchema,
  parseOrThrow,
} from './schemas.js';

export function buildSearchCustomersQuery(q, limit = 25) {
  const data = parseOrThrow(searchCustomersQuerySchema, { q, limit }, 'search');
  const params = new URLSearchParams();
  params.set('q', data.q);
  params.set('limit', String(data.limit));
  return params.toString();
}

export function buildPendingWagersQuery(rawFilters) {
  const data = parseOrThrow(
    pendingWagersFiltersSchema,
    {
      ...rawFilters,
      date: rawFilters.date ?? new Date().toISOString().slice(0, 10),
    },
    'pending-wagers',
  );
  const q = new URLSearchParams();
  q.set('date', data.date ?? new Date().toISOString().slice(0, 10));
  q.set('customer_id', data.customer_id || '0');
  if (data.wager_type) q.set('wager_type', data.wager_type);
  q.set('sort', data.sort);
  q.set('type_sort', data.type_sort);
  q.set('week', String(data.week));
  if (data.login) q.set('login', data.login);
  if (data.sport) q.set('sport', data.sport);
  q.set('limit', String(data.limit));
  return q.toString();
}

export function buildAgentPerfQueryString(rawFilters) {
  const data = parseOrThrow(agentPerformanceFiltersSchema, {
    type: rawFilters.type,
    freePlay: rawFilters.freePlay ?? rawFilters.free_play,
    start: rawFilters.start ?? rawFilters.start_date,
    end: rawFilters.end ?? rawFilters.end_date,
  }, 'agent-performance');
  const parts = [`type=${encodeURIComponent(data.type)}`, `free_play=${encodeURIComponent(data.freePlay)}`];
  if (data.start) {
    parts.push(`start_date=${encodeURIComponent(data.start)}`, `start=${encodeURIComponent(data.start)}`);
  }
  if (data.end) {
    parts.push(`end_date=${encodeURIComponent(data.end)}`, `end=${encodeURIComponent(data.end)}`);
  }
  return parts.join('&');
}

export function buildCustomerProfilePath(customerId, options = {}) {
  const data = parseOrThrow(
    customerProfilePathSchema,
    {
      customerId,
      login: options.login,
      period: options.period ?? 0,
      analysis: options.analysis,
    },
    'customer-profile',
  );
  const loginParam = data.login ? `&login=${encodeURIComponent(data.login)}` : '';
  const period = encodeURIComponent(String(data.period));
  const analysis = data.analysis;
  let analysisQs = '';
  if (analysis) {
    const parts = [];
    if (analysis.start) parts.push(`start_date=${encodeURIComponent(analysis.start)}`);
    if (analysis.end) parts.push(`end_date=${encodeURIComponent(analysis.end)}`);
    parts.push(`report_type=${encodeURIComponent(String(analysis.reportType ?? 2))}`);
    parts.push(`line_type=${encodeURIComponent(String(analysis.lineType ?? 2))}`);
    if (parts.length) analysisQs = `&${parts.join('&')}`;
  }
  return `/customer-profile?customer_id=${encodeURIComponent(data.customerId)}&live=1&period=${period}${loginParam}${analysisQs}`;
}
