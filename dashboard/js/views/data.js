// dashboard/js/views/data.js — Data Query Views (graded wagers, prop wagers, position data, authorizations, players)

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { usd, fmt, ago } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { getRefreshInterval, renderEmptyState } from '../design-system.js';
import { SortableTable } from '../sortable-table.js';

let dataTab = 'graded-wagers';

let gradedWagersTable = null;
let propWagersTable = null;
let positionDataTable = null;
let authorizationsTable = null;
let playersTable = null;

export function setDataTab(name) {
  dataTab = name;
}

export function getDataTab() {
  return dataTab;
}

export async function loadDataView(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  paintDataTabs();
  await loadActiveTab(ctx);
}

function paintDataTabs() {
  document.querySelectorAll('[data-data-tab]').forEach((t) => {
    const on = t.dataset.dataTab === dataTab;
    t.classList.toggle('ds-active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.setAttribute('tabindex', on ? '0' : '-1');
  });
  document.querySelectorAll('#view-data .ds-tab-content').forEach((c) => {
    const active = c.id === `tab-${dataTab}`;
    c.classList.toggle('ds-active', active);
    c.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
}

async function loadActiveTab(ctx) {
  switch (dataTab) {
    case 'graded-wagers':
      await loadGradedWagers(ctx);
      break;
    case 'prop-wagers':
      await loadPropWagers(ctx);
      break;
    case 'position-data':
      await loadPositionData(ctx);
      break;
    case 'authorizations':
      await loadAuthorizations(ctx);
      break;
    case 'players':
      await loadPlayers(ctx);
      break;
  }
}

async function loadGradedWagers(ctx) {
  if (!gradedWagersTable) {
    gradedWagersTable = new SortableTable('gradedWagersTable', [
      { key: 'wager_number', label: 'Wager #', type: 'string' },
      { key: 'agent_id', label: 'Agent', type: 'string' },
      { key: 'login', label: 'Player', type: 'string' },
      { key: 'wager_type', label: 'Type', type: 'string' },
      { key: 'amount_wagered', label: 'Wagered', type: 'number', formatter: (v) => usd(v) },
      { key: 'net_amount', label: 'Net', type: 'number', formatter: (v) => usd(v) },
      { key: 'result', label: 'Result', type: 'string' },
      { key: 'grade_date_time', label: 'Graded', type: 'date', formatter: (v) => v ? ago(v) : '-' },
    ]);
  }
  try {
    const d = await ctx.store.fetch(
      '/graded-wagers',
      () => ctx.api('/graded-wagers?limit=100'),
      storeTTL(getRefreshInterval('/graded-wagers')),
    );
    gradedWagersTable.setData(d.wagers || []);
  } catch (e) {
    $('gradedWagersTable').innerHTML = renderErrorState(e.message, '/graded-wagers');
  }
}

async function loadPropWagers(ctx) {
  if (!propWagersTable) {
    propWagersTable = new SortableTable('propWagersTable', [
      { key: 'wager_number', label: 'Wager #', type: 'string' },
      { key: 'agent_id', label: 'Agent', type: 'string' },
      { key: 'login', label: 'Player', type: 'string' },
      { key: 'wager_type', label: 'Type', type: 'string' },
      { key: 'amount_wagered', label: 'Wagered', type: 'number', formatter: (v) => usd(v) },
      { key: 'to_win_amount', label: 'To Win', type: 'number', formatter: (v) => usd(v) },
      { key: 'short_desc', label: 'Description', type: 'string' },
      { key: 'captured_at', label: 'Captured', type: 'date', formatter: (v) => v ? ago(v) : '-' },
    ]);
  }
  try {
    const d = await ctx.store.fetch(
      '/prop-wagers',
      () => ctx.api('/prop-wagers?limit=100'),
      storeTTL(getRefreshInterval('/prop-wagers')),
    );
    propWagersTable.setData(d.wagers || []);
  } catch (e) {
    $('propWagersTable').innerHTML = renderErrorState(e.message, '/prop-wagers');
  }
}

async function loadPositionData(ctx) {
  if (!positionDataTable) {
    positionDataTable = new SortableTable('positionDataTable', [
      { key: 'sport_name', label: 'Sport', type: 'string' },
      { key: 'sport_id', label: 'Sport ID', type: 'number' },
      { key: 'total_wagered', label: 'Total Wagered', type: 'number', formatter: (v) => usd(v) },
      { key: 'total_to_win', label: 'Total To Win', type: 'number', formatter: (v) => usd(v) },
      { key: 'wager_count', label: 'Wagers', type: 'number' },
      { key: 'captured_at', label: 'Captured', type: 'date', formatter: (v) => v ? ago(v) : '-' },
    ]);
  }
  try {
    const d = await ctx.store.fetch(
      '/position-data',
      () => ctx.api('/position-data?limit=100'),
      storeTTL(getRefreshInterval('/position-data')),
    );
    positionDataTable.setData(d.records || []);
  } catch (e) {
    $('positionDataTable').innerHTML = renderErrorState(e.message, '/position-data');
  }
}

async function loadAuthorizations(ctx) {
  if (!authorizationsTable) {
    authorizationsTable = new SortableTable('authorizationsTable', [
      { key: 'agent_id', label: 'Agent', type: 'string' },
      { key: 'master_agent_id', label: 'Master Agent', type: 'string' },
      { key: 'commission_type', label: 'Commission', type: 'string' },
      { key: 'captured_at', label: 'Captured', type: 'date', formatter: (v) => v ? ago(v) : '-' },
    ]);
  }
  try {
    const d = await ctx.store.fetch(
      '/authorizations',
      () => ctx.api('/authorizations?limit=100'),
      storeTTL(getRefreshInterval('/authorizations')),
    );
    authorizationsTable.setData(d.records || []);
  } catch (e) {
    $('authorizationsTable').innerHTML = renderErrorState(e.message, '/authorizations');
  }
}

async function loadPlayers(ctx) {
  if (!playersTable) {
    playersTable = new SortableTable('playersTable', [
      { key: 'customer_id', label: 'Customer ID', type: 'string' },
      { key: 'login', label: 'Login', type: 'string' },
      { key: 'name_first', label: 'Name', type: 'string' },
      { key: 'agent_id', label: 'Agent', type: 'string' },
      { key: 'captured_at', label: 'Captured', type: 'date', formatter: (v) => v ? ago(v) : '-' },
    ]);
  }
  try {
    const d = await ctx.store.fetch(
      '/players',
      () => ctx.api('/players?limit=100'),
      storeTTL(getRefreshInterval('/players')),
    );
    playersTable.setData(d.records || []);
  } catch (e) {
    $('playersTable').innerHTML = renderErrorState(e.message, '/players');
  }
}
