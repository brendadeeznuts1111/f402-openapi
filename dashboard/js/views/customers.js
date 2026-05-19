// dashboard/js/views/customers.js — player search + live customer profile

import { $, debounce, escapeHtml } from '../dom.js';
import { usd, fmt, ago } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { getRefreshInterval, renderEmptyState } from '../design-system.js';
import { SortableTable } from '../sortable-table.js';
import { wireAgentPerformance, loadAgentPerformance } from './agent-performance.js';
import { apiPost } from '../api-client.js';
import {
  defaultAnalysisDates,
  buildAnalysisQueryParams,
  buildCustomerProfilePath,
  getInfoFromProfileData,
  pickPerformanceColumns,
} from '../lib/customers-view-helpers.js';

let searchTable = null;
let performanceTable = null;
let analysisTable = null;
let selectedCustomerId = null;
let selectedCustomerLogin = null;
let profileWired = false;

const PERF_COL_PREF = [
  'SportType',
  'SportSubType',
  'Sport',
  'Won',
  'Lost',
  'Win',
  'Loss',
  'Net',
  'Volume',
  'VolumeAmount',
  'Risk',
  'AmountWagered',
  'ToWin',
  'ToWinAmount',
  'Count',
  'WagerCount',
];

function centsUsd(v) {
  if (v == null || v === '') return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return usd(n / 100);
}

function ensureAnalysisDateInputs() {
  const { start, end } = defaultAnalysisDates();
  const startEl = $('customerProfileAnalysisStart');
  const endEl = $('customerProfileAnalysisEnd');
  if (startEl && !startEl.value) startEl.value = start;
  if (endEl && !endEl.value) endEl.value = end;
}

function analysisQueryParams() {
  ensureAnalysisDateInputs();
  return buildAnalysisQueryParams({
    start: $('customerProfileAnalysisStart')?.value ?? '',
    end: $('customerProfileAnalysisEnd')?.value ?? '',
    reportType: $('customerProfileReportType')?.value ?? '2',
    lineType: $('customerProfileLineType')?.value ?? '2',
  });
}

function statCard(icon, valueHtml, label) {
  return [
    '<div class="ds-stat-card">',
    `<div class="ds-stat-card__icon">${icon}</div>`,
    `<div class="ds-stat-card__value">${valueHtml}</div>`,
    `<div class="ds-stat-card__label">${escapeHtml(label)}</div>`,
    '</div>',
  ].join('');
}

function profileBlock(profile, id) {
  return profile.sources?.blocks?.find((b) => b.id === id);
}

function sourceBadgeHtml(block) {
  if (!block) return '<span class="ds-badge ds-badge--warn">Unknown</span>';
  if (block.activeSource === 'live') {
    const cached = block.live?.cached ? ' (cached)' : '';
    return `<span class="ds-badge ds-badge--success">Live${cached}</span>`;
  }
  if (block.activeSource === 'seeded') return '<span class="ds-badge ds-badge--info">Seeded (D1)</span>';
  if (block.activeSource === 'failed') {
    return '<span class="ds-badge ds-badge--error" title="Live fetch failed">Failed</span>';
  }
  return '<span class="ds-badge ds-badge--warn">Not loaded</span>';
}

function sourceActiveCell(block) {
  const badge = sourceBadgeHtml(block);
  if (block?.activeSource === 'failed' && block.live?.error) {
    return `${badge}<br><span class="ds-subtitle">${escapeHtml(block.live.error)}</span>`;
  }
  if (block?.seeded?.detail) {
    return `${badge}<br><span class="ds-subtitle">${escapeHtml(block.seeded.detail)}</span>`;
  }
  return badge;
}

function blockFreshness(block) {
  if (!block) return '—';
  if (block.activeSource === 'live' && block.live?.fetchedAt) return ago(block.live.fetchedAt);
  if (block.seeded?.capturedAt) return ago(block.seeded.capturedAt);
  if (block.live?.fetchedAt) return ago(block.live.fetchedAt);
  return '—';
}

function sectionSourceSubtitle(profile, blockId) {
  const block = profileBlock(profile, blockId);
  if (!block) return '';
  const refresh =
    block.dashboardRefreshMs && block.activeSource === 'live'
      ? ` · refreshes every ${Math.round(block.dashboardRefreshMs / 1000)}s`
      : '';
  return `<span class="ds-subtitle">${sourceBadgeHtml(block)} ${escapeHtml(blockFreshness(block))}${refresh}</span>`;
}

function getInfoFromProfile(profile) {
  return getInfoFromProfileData(profile);
}

export async function loadCustomersView(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  ctx.loadCustomerProfile = (customerId, login) => {
    selectedCustomerId = customerId;
    selectedCustomerLogin = login;
    return loadProfile(ctx, customerId, login);
  };
  wireAgentPerformance(ctx);
  await loadAgentPerformance(ctx);
  await loadWeeklyFigureSummary(ctx);
  wireSearchOnce(ctx);
  wireProfileOnce(ctx);
  const q = ($('customerSearchInput')?.value ?? '').trim();
  if (q.length >= 2) await runSearch(ctx, q);
  else if (selectedCustomerId) await loadProfile(ctx, selectedCustomerId, selectedCustomerLogin);
}

function wireProfileOnce(ctx) {
  if (profileWired) return;
  profileWired = true;
  $('customerProfileRefreshBtn')?.addEventListener('click', () => {
    if (selectedCustomerId) loadProfile(ctx, selectedCustomerId, selectedCustomerLogin);
  });
  $('customerProfileSeedBtn')?.addEventListener('click', () => {
    if (selectedCustomerId) seedProfileFacets(ctx, selectedCustomerId, selectedCustomerLogin);
  });
  $('customerProfilePeriod')?.addEventListener('change', () => {
    if (selectedCustomerId) loadProfile(ctx, selectedCustomerId, selectedCustomerLogin);
  });
  for (const id of [
    'customerProfileAnalysisStart',
    'customerProfileAnalysisEnd',
    'customerProfileReportType',
    'customerProfileLineType',
  ]) {
    $(id)?.addEventListener('change', () => {
      if (selectedCustomerId) loadProfile(ctx, selectedCustomerId, selectedCustomerLogin);
    });
  }
  ensureAnalysisDateInputs();
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
          selectedCustomerLogin = row.login;
          loadProfile(ctx, row.customer_id, row.login);
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

async function loadProfile(ctx, customerId, loginHint) {
  const card = $('customerProfileCard');
  const title = $('customerProfileTitle');
  if (card) card.hidden = false;
  if (title) title.textContent = customerId;

  const statsEl = $('customerProfileStats');
  const accountEl = $('customerProfileAccount');
  const perfWrap = $('customerProfilePerformance');
  const perfTableEl = $('customerProfilePerformanceTable');
  const analysisWrap = $('customerProfileAnalysis');
  const analysisTableEl = $('customerProfileAnalysisTable');
  const analysisMetaEl = $('customerProfileAnalysisMeta');
  const sourcesBodyEl = $('customerProfileSourcesBody');
  const webLogsEl = $('customerProfileWebLogs');
  const facetsEl = $('customerProfileFacets');
  const metaEl = $('customerProfileMeta');
  const period = $('customerProfilePeriod')?.value ?? '0';

  if (statsEl) statsEl.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';
  if (accountEl) { accountEl.classList.add('ds-hidden'); accountEl.innerHTML = ''; }
  if (perfWrap) perfWrap.classList.add('ds-hidden');
  if (perfTableEl) perfTableEl.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';
  if (analysisWrap) analysisWrap.classList.add('ds-hidden');
  if (analysisTableEl) analysisTableEl.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';
  if (analysisMetaEl) analysisMetaEl.textContent = '';
  if (sourcesBodyEl) sourcesBodyEl.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';
  if (facetsEl) facetsEl.innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div>';
  if (metaEl) metaEl.textContent = 'Loading live profile…';

  const path = buildCustomerProfilePath(customerId, {
    login: loginHint,
    period,
    analysis: {
      start: $('customerProfileAnalysisStart')?.value ?? '',
      end: $('customerProfileAnalysisEnd')?.value ?? '',
      reportType: $('customerProfileReportType')?.value ?? '2',
      lineType: $('customerProfileLineType')?.value ?? '2',
    },
  });

  try {
    const profile = await ctx.store.fetch(
      path,
      () => ctx.api(path),
      0,
    );
    renderProfileMeta(metaEl, profile);
    renderProfileSources(sourcesBodyEl, profile);
    renderProfileStats(statsEl, profile);
    renderProfileAccount(accountEl, profile);
    renderProfilePerformance(perfTableEl, perfWrap, profile);
    renderProfileAnalysis(analysisTableEl, analysisWrap, analysisMetaEl, profile);
    renderProfileWebLogs(webLogsEl, profile);
    renderProfileFacets(facetsEl, profile);
  } catch (e) {
    if (statsEl) statsEl.innerHTML = renderErrorState(e.message, '/customer-profile');
    if (metaEl) metaEl.textContent = '';
    if (facetsEl) facetsEl.innerHTML = '';
  }
}

function renderProfileMeta(el, profile) {
  if (!el) return;
  const live = profile.live;
  if (!live) {
    el.textContent = 'D1 snapshots only (add ?live=1)';
    return;
  }
  const parts = [];
  if (live.status === 'ok') parts.push('Live');
  else if (live.status === 'partial') parts.push('Partial live');
  else parts.push('Live failed');
  if (live.agent_id) parts.push(`agent ${live.agent_id}`);
  if (live.performance_acc) parts.push(`acc ${live.performance_acc.trim()}`);
  const af = live.analysis_filters;
  if (af?.start_date && af?.end_date) parts.push(`analysis ${af.start_date}–${af.end_date}`);
  const infoBlock = profileBlock(profile, 'getInfoPlayer');
  if (infoBlock?.activeSource === 'seeded') parts.push('stats from D1 seed');
  else if (infoBlock?.activeSource === 'live') parts.push('stats live');
  el.textContent = parts.join(' · ');
}

function renderProfileSources(el, profile) {
  if (!el) return;
  const sources = profile.sources;
  if (!sources?.blocks?.length) {
    el.innerHTML = '<p class="ds-subtitle">Source catalog unavailable (worker may need redeploy).</p>';
    return;
  }
  const rows = sources.blocks
    .map(
      (b) => `<tr>
        <td>${escapeHtml(b.label)}</td>
        <td>${sourceActiveCell(b)}</td>
        <td>${escapeHtml(blockFreshness(b))}</td>
        <td><code>${escapeHtml(b.ingestKey)}</code>${b.seeded?.snapshotId ? `<br><span class="ds-subtitle">${escapeHtml(b.seeded.snapshotId)}</span>` : ''}</td>
        <td class="ds-help-text">${escapeHtml(b.schedule)}</td>
      </tr>`,
    )
    .join('');
  const s = sources.schedules ?? {};
  el.innerHTML = `
    <table class="ds-table-sm"><thead><tr>
      <th>Block</th><th>Active</th><th>Last updated</th><th>Ingest / snapshot</th><th>Update schedule</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <ul class="ds-help-text ds-mt-sm">
      <li><strong>Worker ingestion:</strong> ${escapeHtml(s.workerIngestion ?? '—')}</li>
      <li><strong>Auth refresh:</strong> ${escapeHtml(s.authRefresh ?? '—')}</li>
      <li><strong>Alerts:</strong> ${escapeHtml(s.alertEvaluation ?? '—')}</li>
      <li><strong>URL scan:</strong> ${escapeHtml(s.urlScan ?? '—')}</li>
      <li><strong>Dashboard profile:</strong> ${escapeHtml(s.dashboardProfile ?? '—')}</li>
      <li><strong>Daily warmup:</strong> ${escapeHtml(s.dailyProfileWarmup ?? '—')}</li>
    </ul>`;
}

async function seedProfileFacets(ctx, customerId, loginHint) {
  const btn = $('customerProfileSeedBtn');
  if (btn) btn.disabled = true;
  try {
    const body = { customer_id: customerId };
    if (loginHint) body.login = loginHint;
    const result = await apiPost('/customer-profile/seed', body);
    ctx.showAlert(
      `Seeded ${result.facets?.filter((f) => f.ok).length ?? 0}/${result.facets?.length ?? 4} facets (${result.status})`,
      result.status === 'ok' ? 'ok' : 'warn',
    );
    await loadProfile(ctx, customerId, loginHint);
  } catch (e) {
    ctx.showAlert(e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderProfileWebLogs(el, profile) {
  if (!el) return;
  const block = profileBlock(profile, 'web_logs');
  const rows = profile.recentWebLogs ?? [];
  if (!rows.length && block?.activeSource === 'none') {
    el.classList.add('ds-hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('ds-hidden');
  const count = profile.webLogs?.count24h ?? 0;
  const list = rows.length
    ? `<ul class="ds-help-text">${rows
        .map(
          (r) =>
            `<li>${escapeHtml(r.access_date_time ?? '')} · ${escapeHtml(r.operation ?? '—')} · ${escapeHtml(r.ip_address ?? '—')}</li>`,
        )
        .join('')}</ul>`
    : '<p class="ds-subtitle">No web log rows in the last 24h (ingest getWebLog).</p>';
  el.innerHTML = `
    <h3>Web activity ${sectionSourceSubtitle(profile, 'web_logs')}</h3>
    <p class="ds-help-text">${count} login event${count === 1 ? '' : 's'} in last 24h. Full timeline on <strong>Activity</strong> view.</p>
    ${list}`;
}

function renderProfileStats(el, profile) {
  if (!el) return;
  const player = profile.player;
  const { data, balance } = getInfoFromProfile(profile);
  const pending = data?.PendingWagerCount;
  const pendingBal = data?.PendingWagerBalance;
  el.innerHTML = [
    statCard('🔑', `<span class="ds-stat-card__value--sm">${escapeHtml(player?.login ?? data?.Login ?? '—')}</span>`, 'Login'),
    statCard('📛', `<span class="ds-stat-card__value--sm">${escapeHtml(player?.name_first ?? data?.NameFirst ?? '—')}</span>`, 'Name'),
    statCard('💳', data?.CurrentBalance != null ? centsUsd(data.CurrentBalance) : '—', 'Balance'),
    statCard('🏦', balance?.AvailableBalance != null ? centsUsd(balance.AvailableBalance) : '—', 'Available'),
    statCard('⏳', pendingBal != null ? centsUsd(pendingBal) : '—', `Pending (${pending ?? '?'})`),
    statCard('🏷️', `<span class="ds-stat-card__value--sm">${escapeHtml(data?.AgentLogin ?? data?.AgentID ?? player?.agent_id ?? '—')}</span>`, 'Agent'),
  ].join('');
}

function renderProfileAccount(el, profile) {
  if (!el) return;
  const { data, balance } = getInfoFromProfile(profile);
  if (!data && !balance) {
    el.classList.add('ds-hidden');
    return;
  }
  el.classList.remove('ds-hidden');
  const status = data?.Active === 'Y' ? 'Active' : data?.SuspendAccount === 'Y' ? 'Suspended' : 'Unknown';
  const sportsbook = data?.SuspendSportsbook === 'Y' ? 'Suspended' : 'Open';
  el.innerHTML = `
    <h3>Account ${sectionSourceSubtitle(profile, 'getInfoPlayer')}</h3>
    <div class="ds-stat-grid ds-stat-grid--compact">
      ${statCard('📊', escapeHtml(status), 'Status')}
      ${statCard('🏈', escapeHtml(sportsbook), 'Sportsbook')}
      ${statCard('🎯', data?.CreditLimit != null ? centsUsd(data.CreditLimit) : '—', 'Credit limit')}
      ${statCard('📏', data?.WagerLimit != null ? centsUsd(data.WagerLimit) : '—', 'Wager limit')}
      ${statCard('🎁', data?.FreePlayBalance != null ? centsUsd(data.FreePlayBalance) : '—', 'Free play')}
      ${statCard('📒', data?.SettleFigure != null ? centsUsd(data.SettleFigure) : '—', 'Settle figure')}
    </div>
    ${data?.PlayerNotes ? `<p class="ds-help-text ds-mt-sm"><strong>Notes:</strong> ${escapeHtml(String(data.PlayerNotes).trim())}</p>` : ''}
  `;
}

function pickPerformanceColumnsForTable(rows) {
  return pickPerformanceColumns(rows, PERF_COL_PREF);
}

function renderProfilePerformance(tableEl, wrapEl, profile) {
  if (!tableEl || !wrapEl) return;
  const heading = wrapEl.querySelector('h3');
  if (heading) {
    heading.innerHTML = `Performance by sport ${sectionSourceSubtitle(profile, 'getPerformancePlayer')}`;
  }
  const perf = profile.live?.getPerformancePlayer;
  if (!perf?.ok) {
    wrapEl.classList.remove('ds-hidden');
    const err = perf?.error ?? 'Performance not available';
    tableEl.innerHTML = `<p class="ds-subtitle">${escapeHtml(err)}. Refresh auth on Endpoints if needed.</p>`;
    return;
  }
  const rows = perf.rows || [];
  if (!rows.length) {
    wrapEl.classList.remove('ds-hidden');
    tableEl.innerHTML = renderEmptyState({
      icon: '📊',
      message: 'No performance rows',
      hint: 'Upstream returned an empty LIST for this period.',
    });
    return;
  }
  wrapEl.classList.remove('ds-hidden');
  const cols = pickPerformanceColumnsForTable(rows);
  performanceTable = new SortableTable(
    'customerProfilePerformanceTable',
    cols.map((key) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').trim(),
      type: typeof rows[0][key] === 'number' ? 'number' : 'string',
      formatter: (v) => {
        if (v == null) return '-';
        if (typeof v === 'number' && /amount|volume|risk|win|net|balance/i.test(key)) {
          return centsUsd(v);
        }
        return escapeHtml(String(v).trim());
      },
    })),
  );
  performanceTable.setData(rows);
}

function statusBadge(status) {
  const s = String(status ?? '').trim().toUpperCase();
  if (s === 'W') return '<span class="ds-badge ds-badge--ok">W</span>';
  if (s === 'L') return '<span class="ds-badge ds-badge--error">L</span>';
  if (s === 'P') return '<span class="ds-badge">P</span>';
  return escapeHtml(s || '—');
}

function renderProfileAnalysis(tableEl, wrapEl, metaEl, profile) {
  if (!tableEl || !wrapEl) return;
  const heading = wrapEl.querySelector('h3');
  if (heading) {
    heading.innerHTML = `Wager analysis <span class="ds-subtitle" id="customerProfileAnalysisMeta"></span> ${sectionSourceSubtitle(profile, 'getReportPlayerAnalysis')}`;
  }
  const block = profile.live?.getReportPlayerAnalysis;
  const af = profile.live?.analysis_filters;
  const rangeMeta = wrapEl.querySelector('#customerProfileAnalysisMeta') ?? metaEl;
  if (rangeMeta && af) {
    const sum = block?.summary;
    const range = `${af.start_date} → ${af.end_date}`;
    rangeMeta.textContent = sum
      ? `${range} · ${block?.total ?? 0} wagers · ${sum.wins}W ${sum.losses}L`
      : range;
  } else if (rangeMeta) {
    rangeMeta.textContent = '';
  }
  if (!block?.ok) {
    wrapEl.classList.remove('ds-hidden');
    const err = block?.error ?? 'Wager analysis not available';
    tableEl.innerHTML = `<p class="ds-subtitle">${escapeHtml(err)}. Refresh auth on Endpoints if needed.</p>`;
    return;
  }
  const rows = block.rows || [];
  if (!rows.length) {
    wrapEl.classList.remove('ds-hidden');
    tableEl.innerHTML = renderEmptyState({
      icon: '📋',
      message: 'No graded wagers in range',
      hint: 'Try widening the date range or another report/line type.',
    });
    return;
  }
  wrapEl.classList.remove('ds-hidden');
  analysisTable = new SortableTable(
    'customerProfileAnalysisTable',
    [
      { key: 'posted_at', label: 'Posted', type: 'date', formatter: (v) => (v ? fmt(v) : '-') },
      { key: 'sport', label: 'Sport', type: 'string', formatter: (v) => escapeHtml(String(v ?? '').trim() || '—') },
      { key: 'description', label: 'Description', type: 'string', formatter: (v) => escapeHtml(String(v ?? '').trim() || '—') },
      { key: 'risk', label: 'Risk', type: 'number', formatter: centsUsd },
      { key: 'to_win', label: 'To win', type: 'number', formatter: centsUsd },
      { key: 'win_lose', label: 'W/L $', type: 'number', formatter: centsUsd },
      { key: 'wager_status', label: 'Status', type: 'string', formatter: (v) => statusBadge(v) },
    ],
  );
  analysisTable.setData(rows);
}

function renderProfileFacets(el, profile) {
  if (!el) return;
  const facets = { ...(profile.facets || {}) };
  if (profile.live?.getInfoPlayer?.ok) delete facets.getInfoPlayer;
  const keys = Object.keys(facets);
  const seededOnly = ['getCryptoInfo', 'getMail', 'getTeaserProfile'];
  const seededBlocks = (profile.sources?.blocks ?? []).filter((b) => seededOnly.includes(b.id));
  const parts = [];
  if (seededBlocks.length) {
    parts.push('<h3 class="ds-mt-sm">Seeded facets (D1)</h3>');
    parts.push(
      '<ul class="ds-help-text">',
      ...seededBlocks.map((b) => {
        const cap = b.seeded?.capturedAt ? ago(b.seeded.capturedAt) : 'never';
        return `<li><strong>${escapeHtml(b.label)}</strong> — ${sourceBadgeHtml(b)} · ${escapeHtml(cap)} · <code>${escapeHtml(b.ingestKey)}</code></li>`;
      }),
      '</ul>',
    );
  }
  if (!keys.length) {
    parts.push(
      '<p class="ds-subtitle">Run per-customer browser ingest to seed crypto, mail, and teaser facets into D1.</p>',
    );
    el.innerHTML = parts.join('');
    return;
  }
  parts.push(
    ...keys.sort().map((key) => {
      const payload = facets[key];
      const block = profileBlock(profile, key);
      const badge = block ? sourceBadgeHtml(block) : '<span class="ds-badge ds-badge--info">Seeded (D1)</span>';
      const when = block ? blockFreshness(block) : '—';
      const json = escapeHtml(JSON.stringify(payload, null, 2));
      return `<details class="ds-details ds-mt-sm"><summary class="ds-details__summary">${escapeHtml(key)} ${badge} · ${escapeHtml(when)}</summary><pre class="ds-code-block">${json}</pre></details>`;
    }),
  );
  el.innerHTML = parts.join('');
}
