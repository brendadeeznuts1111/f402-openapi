// dashboard/js/views/customers.js — player search + customer profile from ingested D1

import { $, debounce, escapeHtml } from '../dom.js';
import { usd, fmt, ago } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { getRefreshInterval } from '../design-system.js';
import { SortableTable } from '../sortable-table.js';

let searchTable = null;
let selectedCustomerId = null;

function statCard(icon, valueHtml, label) {
  return [
    '<div class="ds-stat-card">',
    `<div class="ds-stat-card__icon">${icon}</div>`,
    `<div class="ds-stat-card__value">${valueHtml}</div>`,
    `<div class="ds-stat-card__label">${escapeHtml(label)}</div>`,
    '</div>',
  ].join('');
}

export async function loadCustomersView(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  await loadWeeklyFigureSummary(ctx);
  wireSearchOnce(ctx);
  const q = ($('customerSearchInput')?.value ?? '').trim();
  if (q.length >= 2) await runSearch(ctx, q);
  else if (selectedCustomerId) await loadProfile(ctx, selectedCustomerId);
}

function wireSearchOnce(ctx) {
  const input = $('customerSearchInput');
  const btn = $('customerSearchBtn');
  if (!input || input.dataset.wired === '1') return;
  input.dataset.wired = '1';

  const run = () => {
    const q = input.value.trim();
    if (q.length < 2) {
      ctx.showAlert('Enter at least 2 characters to search', 'warn');
      return;
    }
    runSearch(ctx, q);
  };

  btn?.addEventListener('click', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') run();
  });
  input.addEventListener(
    'input',
    debounce(() => {
      const q = input.value.trim();
      if (q.length >= 3) runSearch(ctx, q);
    }, 400),
  );
}

async function loadWeeklyFigureSummary(ctx) {
  const el = $('weeklyFigureCards');
  if (!el) return;
  try {
    const d = await ctx.store.fetch(
      '/weekly-figures',
      () => ctx.api('/weekly-figures?limit=1'),
      storeTTL(getRefreshInterval('/weekly-figures')),
    );
    const row = d.records?.[0];
    if (!row) {
      el.innerHTML =
        '<p class="ds-subtitle">No weekly figure ingested yet — run <code>getWeeklyFigureByAgentLite</code> via local ingest.</p>';
      return;
    }
    const captured = row.captured_at ? ago(row.captured_at) : '';
    el.innerHTML = [
      statCard('📅', usd(row.net_amount), 'Week net (lite)'),
      statCard('👤', fmt(row.wager_count), 'Active players'),
      statCard('🆔', `<span class="ds-stat-card__value--sm">${escapeHtml(row.agent_id || '')}</span>`, `Agent · ${captured}`),
    ].join('');
  } catch (e) {
    el.innerHTML = renderErrorState(e.message, '/weekly-figures');
  }
}

async function runSearch(ctx, q) {
  const meta = $('customerSearchMeta');
  if (!searchTable) {
    searchTable = new SortableTable(
      'customerSearchResults',
      [
        { key: 'login', label: 'Login', type: 'string' },
        { key: 'name_first', label: 'Name', type: 'string' },
        { key: 'customer_id', label: 'Customer ID', type: 'string' },
        { key: 'agent_id', label: 'Agent', type: 'string' },
        { key: 'captured_at', label: 'Listed', type: 'date', formatter: (v) => (v ? ago(v) : '-') },
      ],
      {
        emptyText: 'No matches',
        onSelect: (row) => {
          selectedCustomerId = row.customer_id;
          loadProfile(ctx, row.customer_id);
        },
      },
    );
  }
  try {
    const d = await ctx.store.fetch(
      `/search-customers?q=${encodeURIComponent(q)}`,
      () => ctx.api(`/search-customers?q=${encodeURIComponent(q)}&limit=50`),
      0,
    );
    const total = d.total ?? d.records?.length ?? 0;
    if (meta) meta.textContent = `${total} match${total === 1 ? '' : 'es'} for "${q}"`;
    searchTable.setData(d.records || []);
  } catch (e) {
    $('customerSearchResults').innerHTML = renderErrorState(e.message, '/search-customers');
    if (meta) meta.textContent = '';
  }
}

async function loadProfile(ctx, customerId) {
  const card = $('customerProfileCard');
  const title = $('customerProfileTitle');
  if (card) card.hidden = false;
  if (title) title.textContent = customerId;

  const statsEl = $('customerProfileStats');
  const facetsEl = $('customerProfileFacets');
  if (statsEl) statsEl.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';
  if (facetsEl) facetsEl.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';

  try {
    const profile = await ctx.store.fetch(
      `/customer-profile?id=${encodeURIComponent(customerId)}`,
      () => ctx.api(`/customer-profile?customer_id=${encodeURIComponent(customerId)}`),
      0,
    );
    renderProfileStats(statsEl, profile);
    renderProfileFacets(facetsEl, profile);
  } catch (e) {
    if (statsEl) statsEl.innerHTML = renderErrorState(e.message, '/customer-profile');
    if (facetsEl) facetsEl.innerHTML = '';
  }
}

function renderProfileStats(el, profile) {
  if (!el) return;
  const player = profile.player;
  const facetKeys = Object.keys(profile.facets || {});
  const account = profile.account;
  el.innerHTML = [
    statCard('🔑', `<span class="ds-stat-card__value--sm">${escapeHtml(player?.login ?? '—')}</span>`, 'Login'),
    statCard('📛', `<span class="ds-stat-card__value--sm">${escapeHtml(player?.name_first ?? '—')}</span>`, 'Name'),
    statCard('📂', fmt(facetKeys.length), 'Profile facets'),
    statCard('💾', account ? 'Yes' : '—', 'Account snapshot'),
  ].join('');
}

function renderProfileFacets(el, profile) {
  if (!el) return;
  const facets = profile.facets || {};
  const keys = Object.keys(facets);
  if (!keys.length) {
    el.innerHTML =
      '<p class="ds-subtitle">No per-customer facets in D1 yet. Ingest getInfoPlayer, getCryptoInfo, getMail, and getTeaserProfile with FANTASY402_CUSTOMER_ID set.</p>';
    return;
  }
  el.innerHTML = keys
    .sort()
    .map((key) => {
      const payload = facets[key];
      const json = escapeHtml(JSON.stringify(payload, null, 2));
      return `<details class="ds-details ds-mt-sm"><summary class="ds-details__summary">${escapeHtml(key)}</summary><pre class="ds-code-block">${json}</pre></details>`;
    })
    .join('');
}
