// Live Manager/getAgentPerformance (CP / CPS / CPV / G)

import { $ } from '../dom.js';
import { usd, fmt, ago } from '../format.js';
import { renderErrorState } from '../ui.js';
import { getRefreshInterval, renderEmptyState } from '../design-system.js';
import { SortableTable } from '../sortable-table.js';
import { storeTTL } from '../ui.js';
import {
  buildAgentPerfQueryString,
  columnsForAgentPerfType,
  parseCustomerFromPerfRow,
  formatAgentPerfMeta,
} from '../lib/agent-performance-helpers.js';
import { formatAgentCell, formatCustomerCell } from '../lib/link-components.js';

let agentPerfTable = null;
let wired = false;

const CP_COLS = [
  { key: 'login', label: 'Login', type: 'string', html: true, formatter: (v, row) => formatCustomerCell(v, row) },
  {
    key: 'customer_id',
    label: 'Customer ID',
    type: 'string',
    html: true,
    formatter: (v, row) => formatCustomerCell(row.login, { ...row, customer_id: v }),
  },
  { key: 'agent_id', label: 'Agent', type: 'string', html: true, formatter: (v) => formatAgentCell(v) },
  { key: 'wager_count', label: 'Bets', type: 'number', formatter: (v) => fmt(v) },
  { key: 'volume', label: 'Volume', type: 'number', formatter: moneyOrDash },
  { key: 'risk', label: 'Risk', type: 'number', formatter: moneyOrDash },
  { key: 'to_win', label: 'To win', type: 'number', formatter: moneyOrDash },
  { key: 'amount_won', label: 'Won', type: 'number', formatter: moneyOrDash },
  { key: 'amount_lost', label: 'Lost', type: 'number', formatter: moneyOrDash },
  { key: 'net', label: 'Net', type: 'number', formatter: moneyOrDash },
];

const SPORT_COLS = [
  { key: 'sport_type', label: 'Sport', type: 'string' },
  { key: 'sport_sub_type', label: 'Sub', type: 'string' },
  { key: 'bet_type', label: 'Bet type', type: 'string' },
  { key: 'wager_type', label: 'Wager', type: 'string' },
  { key: 'period_description', label: 'Period', type: 'string' },
  { key: 'bets', label: 'Bets', type: 'number', formatter: (v) => fmt(v) },
  { key: 'risk', label: 'Risk', type: 'number', formatter: moneyOrDash },
  { key: 'won_lost', label: 'W/L', type: 'number', formatter: moneyOrDash },
  { key: 'won', label: 'Won #', type: 'number', formatter: (v) => fmt(v) },
  { key: 'lost', label: 'Lost #', type: 'number', formatter: (v) => fmt(v) },
];

function moneyOrDash(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return usd(n);
}

function readFiltersFromDom() {
  return {
    type: $('agentPerfType')?.value ?? 'CP',
    freePlay: $('agentPerfFreePlay')?.value ?? 'Y',
    start: $('agentPerfStart')?.value ?? '',
    end: $('agentPerfEnd')?.value ?? '',
  };
}

export function wireAgentPerformance(ctx) {
  if (wired) return;
  wired = true;
  $('agentPerfLoadBtn')?.addEventListener('click', () => loadAgentPerformance(ctx));
  for (const id of ['agentPerfType', 'agentPerfFreePlay', 'agentPerfStart', 'agentPerfEnd']) {
    $(id)?.addEventListener('change', () => loadAgentPerformance(ctx));
  }
}

export async function loadAgentPerformance(ctx) {
  const meta = $('agentPerfMeta');
  const tableHost = $('agentPerfTable');
  if (!tableHost) return;
  tableHost.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';
  if (meta) meta.textContent = 'Loading…';

  const filters = readFiltersFromDom();
  const path = `/agent-performance-live?${buildAgentPerfQueryString(filters)}`;

  try {
    const d = await ctx.store.fetch(
      path,
      () => ctx.api(path),
      storeTTL(getRefreshInterval('/agent-performance-live') ?? 45000),
    );
    const type = d.type ?? filters.type;
    if (meta) {
      meta.textContent = formatAgentPerfMeta({
        ...d,
        timeAgo: d.fetched_at ? ago(d.fetched_at) : 'now',
      });
    }
    const rows = d.rows ?? [];
    if (!rows.length) {
      tableHost.innerHTML = renderEmptyState({
        icon: '📊',
        message: 'No performance rows',
        hint: 'Try another type or date range. Auth must be valid on the worker.',
      });
      return;
    }
    const colSet = columnsForAgentPerfType(type, rows[0]);
    const cols = colSet === 'sport' ? SPORT_COLS : CP_COLS;
    agentPerfTable = new SortableTable('agentPerfTable', cols, {
      emptyText: 'No rows',
      onSelect: (row) => {
        const { customerId, login } = parseCustomerFromPerfRow(row);
        if (customerId && ctx.loadCustomerProfile) {
          ctx.loadCustomerProfile(customerId, login);
          $('customerProfileCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
    });
    agentPerfTable.setData(rows);
  } catch (e) {
    tableHost.innerHTML = renderErrorState(e.message, '/agent-performance-live');
    if (meta) meta.textContent = '';
  }
}
