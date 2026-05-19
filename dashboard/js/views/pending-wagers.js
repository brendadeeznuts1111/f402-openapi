// dashboard/js/views/pending-wagers.js — live pending wagers via Worker GET /pending-wagers

import { $, debounce, escapeHtml } from '../dom.js';
import { usd, fmt, ago, tag } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { getRefreshInterval, renderEmptyState } from '../design-system.js';
import { SortableTable } from '../sortable-table.js';
import { AutoRefreshManager } from '../utils.js';

const STORAGE_KEY = 'f402-pending-filters';

const DEFAULT_FILTERS = {
  date: new Date().toISOString().slice(0, 10),
  customer_id: '0',
  wager_type: '',
  sort: '1',
  type_sort: '2',
  week: '0',
  login: '',
  sport: '',
};

let pendingTable = null;
let filters = { ...DEFAULT_FILTERS };
let wired = false;

function centsUsd(v) {
  if (v == null || v === '') return '-';
  return usd(Number(v) / 100);
}

function loadFilters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) filters = { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    filters = { ...DEFAULT_FILTERS };
  }
}

function saveFilters() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}

function readFiltersFromForm() {
  filters = {
    date: $('pendingDate')?.value || DEFAULT_FILTERS.date,
    customer_id: ($('pendingCustomerId')?.value || '0').trim(),
    wager_type: ($('pendingWagerType')?.value || '').trim().toUpperCase(),
    sort: DEFAULT_FILTERS.sort,
    type_sort: DEFAULT_FILTERS.type_sort,
    week: $('pendingWeek')?.value ?? '0',
    login: ($('pendingLogin')?.value || '').trim(),
    sport: ($('pendingSport')?.value || '').trim(),
  };
  saveFilters();
}

function paintFiltersToForm() {
  if ($('pendingDate')) $('pendingDate').value = filters.date;
  if ($('pendingCustomerId')) $('pendingCustomerId').value = filters.customer_id;
  if ($('pendingWagerType')) $('pendingWagerType').value = filters.wager_type;
  if ($('pendingWeek')) $('pendingWeek').value = filters.week;
  if ($('pendingLogin')) $('pendingLogin').value = filters.login;
  if ($('pendingSport')) $('pendingSport').value = filters.sport;
}

function buildQuery() {
  const q = new URLSearchParams();
  q.set('date', filters.date);
  q.set('customer_id', filters.customer_id || '0');
  if (filters.wager_type) q.set('wager_type', filters.wager_type);
  q.set('sort', filters.sort);
  q.set('type_sort', filters.type_sort);
  q.set('week', filters.week);
  if (filters.login) q.set('login', filters.login);
  if (filters.sport) q.set('sport', filters.sport);
  q.set('limit', '200');
  return q.toString();
}

function statusBadge(status) {
  const s = String(status ?? '').trim().toUpperCase();
  const label = s === 'O' ? 'Open' : escapeHtml(s || '-');
  const cls = s === 'O' ? 'success' : 'info';
  return `<span class="ds-badge ds-badge--${cls}">${label}</span>`;
}

export function initPendingView(ctx) {
  wireFiltersOnce(ctx);
}

function wireFiltersOnce(ctx) {
  if (wired) return;
  wired = true;
  loadFilters();
  paintFiltersToForm();

  $('pendingApplyBtn')?.addEventListener('click', () => {
    readFiltersFromForm();
    loadPendingWagers(ctx);
  });

  $('pendingResetBtn')?.addEventListener('click', () => {
    filters = { ...DEFAULT_FILTERS, date: new Date().toISOString().slice(0, 10) };
    paintFiltersToForm();
    saveFilters();
    loadPendingWagers(ctx);
  });

  const debouncedClientFilter = debounce(() => {
    readFiltersFromForm();
    loadPendingWagers(ctx);
  }, 400);

  $('pendingLogin')?.addEventListener('input', debouncedClientFilter);
  $('pendingSport')?.addEventListener('input', debouncedClientFilter);

  const onEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      readFiltersFromForm();
      loadPendingWagers(ctx);
    }
  };
  ['pendingDate', 'pendingCustomerId', 'pendingWagerType', 'pendingWeek', 'pendingLogin', 'pendingSport'].forEach((id) => {
    $(id)?.addEventListener('keydown', onEnter);
  });
}

function ensureTable() {
  if (pendingTable) return;
  pendingTable = new SortableTable('pendingWagersTable', [
    { key: 'ticket_number', label: 'Ticket #', type: 'number' },
    { key: 'login', label: 'Player', type: 'string' },
    { key: 'wager_type', label: 'Type', type: 'string', formatter: (v) => tag(v) },
    { key: 'amount_wagered', label: 'Wagered', type: 'number', formatter: (v) => centsUsd(v) },
    { key: 'to_win_amount', label: 'To Win', type: 'number', formatter: (v) => centsUsd(v) },
    {
      key: 'accepted_at',
      label: 'Accepted',
      type: 'string',
      formatter: (v) => (v ? ago(v) : '-'),
    },
    {
      key: 'sport_type',
      label: 'Sport',
      type: 'string',
      formatter: (v) => escapeHtml(String(v || '').trim()),
    },
    {
      key: 'description',
      label: 'Description',
      type: 'string',
      formatter: (v) => {
        const s = String(v ?? '');
        return `<span class="ds-cell-truncate" title="${escapeHtml(s)}">${escapeHtml(s.slice(0, 80))}${s.length > 80 ? '…' : ''}</span>`;
      },
    },
    { key: 'wager_status', label: 'Status', type: 'string', formatter: (v) => statusBadge(v) },
  ]);
}

function renderSummary(d, rows) {
  const el = $('pendingSummary');
  if (!el) return;
  const riskCents = rows.reduce((sum, r) => sum + (Number(r.amount_wagered) || 0), 0);
  const toWinCents = rows.reduce((sum, r) => sum + (Number(r.to_win_amount) || 0), 0);
  el.innerHTML = [
    `<div class="ds-stat-card"><div class="ds-stat-card__label">Wagers</div><div class="ds-stat-card__value">${fmt(rows.length)}</div></div>`,
    `<div class="ds-stat-card"><div class="ds-stat-card__label">Total risk</div><div class="ds-stat-card__value">${centsUsd(riskCents)}</div></div>`,
    `<div class="ds-stat-card"><div class="ds-stat-card__label">Total to win</div><div class="ds-stat-card__value">${centsUsd(toWinCents)}</div></div>`,
  ].join('');
}

export async function loadPendingWagersView(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  wireFiltersOnce(ctx);
  ensureTable();
  await loadPendingWagers(ctx);
}

async function loadPendingWagers(ctx) {
  const path = `/pending-wagers?${buildQuery()}`;
  const metaEl = $('pendingMeta');
  if (metaEl) metaEl.textContent = 'Loading…';

  try {
    const d = await ctx.store.fetch(
      path,
      () => ctx.api(path),
      storeTTL(getRefreshInterval('/pending-wagers')),
    );
    if (d.status === 'failed') {
      throw new Error(d.message || 'Pending wagers request failed');
    }
    const rows = d.wagers || [];
    renderSummary(d, rows);
    if (!rows.length) {
      $('pendingWagersTable').innerHTML = renderEmptyState({
        icon: '⏳',
        message: 'No pending wagers',
        hint: 'Try another date or clear filters. Customer 0 returns all players under the agent.',
      });
      if (metaEl) {
        metaEl.textContent = d.source === 'live' ? 'Live · 0 rows' : '0 rows';
      }
      return;
    }
    pendingTable.setData(rows);
    if (metaEl) {
      const parts = [d.source === 'live' ? 'Live' : 'Cached', `${rows.length} rows`];
      if (d.filters?.date) parts.push(`date ${d.filters.date}`);
      if (d.filters?.agent_id) parts.push(`agent ${d.filters.agent_id}`);
      metaEl.textContent = parts.join(' · ');
    }
  } catch (e) {
    $('pendingWagersTable').innerHTML = renderErrorState(
      `${e.message}. Check worker auth on Endpoints.`,
      '/pending-wagers',
    );
    if (metaEl) metaEl.textContent = '';
    if ($('pendingSummary')) $('pendingSummary').innerHTML = '';
  }
}

export function registerPendingAutoRefresh(ctx) {
  AutoRefreshManager.register('pending', () => loadPendingWagers(ctx), getRefreshInterval('/pending-wagers'));
}

export function unregisterPendingAutoRefresh() {
  AutoRefreshManager.unregister('pending');
}
