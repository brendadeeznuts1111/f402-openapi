// Live Manager transaction reports (matches manager Transactions Type menu)

import { $, escapeHtml } from '../dom.js';
import { usd, fmt, ago } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { getRefreshInterval, renderEmptyState } from '../design-system.js';
import { SortableTable } from '../sortable-table.js';
import { buildTransactionsLiveQuery } from '../lib/query-builders.js';
import { formatCustomerCell } from '../lib/link-components.js';
import { transactionReportTypeSchema } from '../lib/schemas.js';

const STORAGE_KEY = 'f402-transactions-filters';

const TRANSACTION_TYPE_LABELS = {
  player: 'Player Transactions',
  agent: 'Agent Transactions',
  deleted: 'Deleted Transactions',
  'free-play': 'Free Play Transactions',
  'free-play-analysis': 'Free Play Analysis',
  summary: 'Player Summary',
};

const DEFAULT_FILTERS = {
  type: 'player',
  customer_id: '',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  deposits: 'checked',
  withdrawals: 'checked',
  adjustments: 'checked',
  transfers: 'checked',
  fees: 'checked',
  promotional: 'checked',
  balances: 'checked',
  distribution: 'unchecked',
};

let table = null;
let filters = { ...DEFAULT_FILTERS };
let wired = false;

function isHistoryType(type) {
  return type === 'player' || type === 'agent' || type === 'free-play';
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
  const type = $('transactionsType')?.value ?? 'player';
  filters = {
    type,
    customer_id: ($('transactionsCustomerId')?.value ?? '').trim(),
    start_date: $('transactionsStart')?.value || DEFAULT_FILTERS.start_date,
    end_date: $('transactionsEnd')?.value || DEFAULT_FILTERS.end_date,
    deposits: $('transactionsDeposits')?.checked ? 'checked' : 'unchecked',
    withdrawals: $('transactionsWithdrawals')?.checked ? 'checked' : 'unchecked',
    adjustments: $('transactionsAdjustments')?.checked ? 'checked' : 'unchecked',
    transfers: $('transactionsTransfers')?.checked ? 'checked' : 'unchecked',
    fees: $('transactionsFees')?.checked ? 'checked' : 'unchecked',
    promotional: $('transactionsPromotional')?.checked ? 'checked' : 'unchecked',
    balances: $('transactionsBalances')?.checked ? 'checked' : 'unchecked',
    distribution: $('transactionsDistribution')?.checked ? 'checked' : 'unchecked',
  };
  if (type === 'agent') {
    filters.free_flag = 'agent';
  } else if (isHistoryType(type)) {
    filters.free_flag = 'player';
  }
  saveFilters();
}

function paintFiltersToForm() {
  if ($('transactionsType')) $('transactionsType').value = filters.type;
  if ($('transactionsCustomerId')) $('transactionsCustomerId').value = filters.customer_id ?? '';
  if ($('transactionsStart')) $('transactionsStart').value = filters.start_date;
  if ($('transactionsEnd')) $('transactionsEnd').value = filters.end_date;
  const flags = $('transactionsHistoryFlags');
  if (flags) {
    flags.classList.toggle('ds-hidden', !isHistoryType(filters.type));
  }
  const map = {
    transactionsDeposits: filters.deposits === 'checked',
    transactionsWithdrawals: filters.withdrawals === 'checked',
    transactionsAdjustments: filters.adjustments === 'checked',
    transactionsTransfers: filters.transfers === 'checked',
    transactionsFees: filters.fees === 'checked',
    transactionsPromotional: filters.promotional === 'checked',
    transactionsBalances: filters.balances === 'checked',
    transactionsDistribution: filters.distribution === 'checked',
  };
  for (const [id, checked] of Object.entries(map)) {
    const el = $(id);
    if (el) el.checked = checked;
  }
}

function wireFiltersOnce(ctx) {
  if (wired) return;
  wired = true;
  loadFilters();
  paintFiltersToForm();

  $('transactionsTypeToggle')?.addEventListener('click', () => {
    $('transactionsType')?.focus();
  });

  $('transactionsApplyBtn')?.addEventListener('click', () => {
    readFiltersFromForm();
    loadTransactions(ctx);
  });

  $('transactionsResetBtn')?.addEventListener('click', () => {
    filters = { ...DEFAULT_FILTERS };
    paintFiltersToForm();
    saveFilters();
    loadTransactions(ctx);
  });

  $('transactionsType')?.addEventListener('change', () => {
    readFiltersFromForm();
    paintFiltersToForm();
    loadTransactions(ctx);
  });
}

function ensureTable() {
  if (table) return;
  table = new SortableTable('transactionsTable', [
    {
      key: 'posted_at',
      label: 'Posted',
      type: 'string',
      formatter: (v) => (v ? ago(String(v)) : '-'),
    },
    {
      key: 'login',
      label: 'Player',
      type: 'string',
      html: true,
      formatter: (v, row) => formatCustomerCell(v, row),
    },
    {
      key: 'description',
      label: 'Description',
      type: 'string',
      formatter: (v) => {
        const s = String(v ?? '');
        return `<span class="ds-cell-truncate" title="${escapeHtml(s)}">${escapeHtml(s.slice(0, 80))}${s.length > 80 ? '…' : ''}</span>`;
      },
      html: true,
    },
    {
      key: 'transaction_type',
      label: 'Type',
      type: 'string',
      formatter: (v) => escapeHtml(String(v || '-')),
      html: true,
    },
    {
      key: 'amount',
      label: 'Amount',
      type: 'number',
      formatter: (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? usd(n / 100) : '-';
      },
    },
    {
      key: 'balance',
      label: 'Balance',
      type: 'number',
      formatter: (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? usd(n / 100) : '-';
      },
    },
    {
      key: 'reference',
      label: 'Ref',
      type: 'string',
    },
    {
      key: 'deleted_by',
      label: 'Deleted by',
      type: 'string',
    },
  ]);
}

export function applyTransactionsFilters(partial) {
  const parsed = transactionReportTypeSchema.safeParse(partial.type ?? filters.type);
  filters = {
    ...filters,
    ...partial,
    type: parsed.success ? parsed.data : filters.type,
  };
  paintFiltersToForm();
  saveFilters();
}

export async function loadTransactionsView(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  wireFiltersOnce(ctx);
  ensureTable();
  await loadTransactions(ctx);
}

async function loadTransactions(ctx) {
  const metaEl = $('transactionsMeta');
  if (metaEl) metaEl.textContent = 'Loading…';

  let qs;
  try {
    qs = buildTransactionsLiveQuery(filters);
  } catch (e) {
    $('transactionsTable').innerHTML = renderErrorState(e.message, '/transactions-live');
    if (metaEl) metaEl.textContent = '';
    return;
  }

  const path = `/transactions-live?${qs}`;
  try {
    const d = await ctx.store.fetch(
      path,
      () => ctx.api(path),
      storeTTL(getRefreshInterval('/transactions-live') ?? 45000),
    );
    if (d.status === 'failed') {
      throw new Error(d.message || 'Transactions request failed');
    }
    const rows = d.rows ?? [];
    const label = TRANSACTION_TYPE_LABELS[d.type] ?? d.type_label ?? d.type;
    if (!rows.length) {
      $('transactionsTable').innerHTML = renderEmptyState({
        icon: '💳',
        message: 'No transactions',
        hint: `Try another type or date range. ${label}`,
      });
      if (metaEl) {
        metaEl.textContent = `${label} · 0 rows · ${d.cached ? 'cached' : 'live'}`;
      }
      return;
    }
    table.setData(rows);
    if (metaEl) {
      metaEl.textContent = [
        label,
        `${rows.length} rows`,
        d.cached ? 'cached' : 'live',
        d.fetched_at ? ago(d.fetched_at) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
  } catch (e) {
    $('transactionsTable').innerHTML = renderErrorState(
      `${e.message}. Refresh auth on Endpoints.`,
      '/transactions-live',
    );
    if (metaEl) metaEl.textContent = '';
  }
}
