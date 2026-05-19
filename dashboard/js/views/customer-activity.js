// dashboard/js/views/customer-activity.js — Customer Activity Monitor
// Combines getWebLog access logs with getBetTicker wager activity.

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { usd, fmt, ago } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { renderEmptyState, getRefreshInterval } from '../design-system.js';
import { AutoRefreshManager } from '../utils.js';

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

let selectedLogin = null;
let activeHours = 24;
let activityFilter = 'all';
let searchTimer = null;
let dropdownIndex = -1;

export function setActivityFilter(filter) {
  activityFilter = filter;
}

export async function loadActivityView(ctx) {
  AutoRefreshManager.unregister('customer-activity');
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  $('activitySearchInput').value = '';
  $('activitySearchInput').focus();
  hideDropdown();
  $('activityCustomerCard').classList.add('ds-hidden');
  $('activityTimelineWrap').classList.add('ds-hidden');
  $('activityFreshness').classList.add('ds-hidden');
  selectedLogin = null;
}

function hideDropdown() {
  $('activityDropdown').innerHTML = '';
  $('activityDropdown').classList.remove('ds-dropdown--visible');
  dropdownIndex = -1;
}

function debouncedSearch(ctx) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => performSearch(ctx), 300);
}

async function performSearch(ctx) {
  const q = ($('activitySearchInput').value || '').trim();
  const dropdown = $('activityDropdown');
  if (!q) {
    hideDropdown();
    return;
  }
  try {
    const result = await ctx.apiPost('/customer-activity-search', { q, limit: 15 });
    const records = result.records || [];
    if (!records.length) {
      dropdown.innerHTML = '<div class="ds-dropdown__empty">No customers found</div>';
      dropdown.classList.add('ds-dropdown--visible');
      dropdownIndex = -1;
      return;
    }
    dropdown.innerHTML = records.map((r, i) =>
      `<div class="ds-dropdown__item" data-index="${i}" data-login="${escapeHtml(r.login)}">
        <span class="ds-dropdown__primary">${escapeHtml(r.login)}</span>
        <span class="ds-dropdown__secondary">${escapeHtml(r.name_first || '')} · ${escapeHtml(r.agent_id)} · ${escapeHtml(r.customer_id)}</span>
      </div>`
    ).join('');
    dropdown.classList.add('ds-dropdown--visible');
    dropdownIndex = -1;
    highlightDropdownItem(dropdown);
    dropdown.querySelectorAll('.ds-dropdown__item').forEach((item) => {
      item.addEventListener('click', () => selectCustomer(ctx, item.dataset.login));
    });
  } catch (e) {
    dropdown.innerHTML = `<div class="ds-dropdown__empty">${escapeHtml(e.message)}</div>`;
    dropdown.classList.add('ds-dropdown--visible');
    dropdownIndex = -1;
  }
}

function highlightDropdownItem(dropdown) {
  dropdown.querySelectorAll('.ds-dropdown__item').forEach((item, i) => {
    item.classList.toggle('ds-dropdown__item--active', i === dropdownIndex);
  });
  if (dropdownIndex >= 0) {
    const active = dropdown.querySelector(`[data-index="${dropdownIndex}"]`);
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
}

async function selectCustomer(ctx, login) {
  selectedLogin = login;
  $('activitySearchInput').value = login;
  hideDropdown();
  await loadCustomerActivity(ctx);
  AutoRefreshManager.register('customer-activity', () => loadCustomerActivity(ctx), getRefreshInterval('/customer-activity'));
}

function paintTimeRanges() {
  document.querySelectorAll('[data-activity-hours]').forEach((btn) => {
    const active = Number(btn.dataset.activityHours) === activeHours;
    btn.classList.toggle('ds-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function paintActivityFilters() {
  document.querySelectorAll('[data-activity-filter]').forEach((btn) => {
    const active = btn.dataset.activityFilter === activityFilter;
    btn.classList.toggle('ds-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

async function loadCustomerActivity(ctx) {
  if (!selectedLogin) return;
  try {
    $('activityTimeline').innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div><div class="ds-skeleton ds-skeleton-row ds-skeleton-row--medium"></div>';
    const data = await ctx.api(`/customer-activity?login=${encodeURIComponent(selectedLogin)}&hours=${activeHours}&limit=100`);
    const customer = data.customer;
    const summary = data.summary;
    const profile = data.profile;

    $('activityCustomerCard').classList.remove('ds-hidden');
    if (customer) {
      $('activityCustomerInfo').innerHTML = `
        <span class="ds-badge ds-badge--info">${escapeHtml(customer.customer_id)}</span>
        <span class="ds-badge ds-badge--success">${escapeHtml(customer.login)}</span>
        <span class="ds-badge">${escapeHtml(customer.name_first || '')}</span>
        <span class="ds-badge ds-badge--warn">${escapeHtml(customer.agent_id)}</span>
      `;
    } else {
      $('activityCustomerInfo').innerHTML = `<span class="ds-badge">Login: ${escapeHtml(selectedLogin)}</span>`;
    }

    const infoPlayer = profile?.facets?.getInfoPlayer;
    const info = infoPlayer?.INFO?.data;
    const account = profile?.account?.data;
    const balance = infoPlayer?.INFO?.balance;

    $('activityStatCards').innerHTML = `
      <div class="ds-stat-card"><div class="ds-stat-card__icon">📊</div><div class="ds-stat-card__value">${fmt(summary.total_wagers)}</div><div class="ds-stat-card__label">Wagers</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">💰</div><div class="ds-stat-card__value">${usd(summary.total_volume)}</div><div class="ds-stat-card__label">Volume</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">🔑</div><div class="ds-stat-card__value">${fmt(summary.total_logins)}</div><div class="ds-stat-card__label">Logins</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">🌐</div><div class="ds-stat-card__value">${fmt(summary.unique_ips)}</div><div class="ds-stat-card__label">IPs</div></div>
    `;

    if (info || account) {
      const bal = info?.CurrentBalance ?? account?.CurrentBalance;
      const avail = balance?.AvailableBalance ?? account?.AvailableBalance;
      const pending = info?.PendingWagerBalance ?? account?.PendingWagerBalance;
      const creditLimit = info?.CreditLimit ?? account?.CreditLimit;
      const wagerLimit = info?.WagerLimit ?? account?.WagerLimit;
      const freeplay = info?.FreePlayBalance ?? account?.FreePlayBalance;
      const status = info?.Active === 'Y' ? 'Active' : info?.SuspendAccount === 'Y' ? 'Suspended' : 'Unknown';
      const sportsbook = info?.SuspendSportsbook === 'Y' ? '🔴 Suspended' : '🟢 Open';

      $('activityBalanceCard').classList.remove('ds-hidden');
      $('activityBalanceCard').innerHTML = `
        <h2>Account</h2>
        <div class="ds-stat-grid ds-stat-grid--compact">
          <div class="ds-stat-card"><div class="ds-stat-card__icon">💳</div><div class="ds-stat-card__value">${bal != null ? usd(bal) : '—'}</div><div class="ds-stat-card__label">Balance</div></div>
          <div class="ds-stat-card"><div class="ds-stat-card__icon">🏦</div><div class="ds-stat-card__value">${avail != null ? usd(avail) : '—'}</div><div class="ds-stat-card__label">Available</div></div>
          <div class="ds-stat-card"><div class="ds-stat-card__icon">⏳</div><div class="ds-stat-card__value">${pending != null ? usd(pending) : '—'}</div><div class="ds-stat-card__label">Pending</div></div>
          <div class="ds-stat-card"><div class="ds-stat-card__icon">🎯</div><div class="ds-stat-card__value">${creditLimit != null ? usd(creditLimit) : '—'}</div><div class="ds-stat-card__label">Credit Limit</div></div>
          <div class="ds-stat-card"><div class="ds-stat-card__icon">📏</div><div class="ds-stat-card__value">${wagerLimit != null ? usd(wagerLimit) : '—'}</div><div class="ds-stat-card__label">Wager Limit</div></div>
          <div class="ds-stat-card"><div class="ds-stat-card__icon">🎁</div><div class="ds-stat-card__value">${freeplay != null ? usd(freeplay) : '—'}</div><div class="ds-stat-card__label">FreePlay</div></div>
        </div>
        <div class="ds-mt-sm">
          <span class="ds-badge ds-badge--${status === 'Active' ? 'success' : 'error'}">${escapeHtml(status)}</span>
          ${info?.DenyLiveBetting === 'Y' ? '<span class="ds-badge ds-badge--warn">No Live</span>' : '<span class="ds-badge ds-badge--success">Live OK</span>'}
          ${sportsbook}
          ${info?.SuspectedBot === 'Y' ? '<span class="ds-badge ds-badge--error">Bot Flag</span>' : ''}
          ${info?.AllowRoundRobin === 'Y' ? '<span class="ds-badge">Round Robin</span>' : ''}
        </div>
      `;
    } else {
      $('activityBalanceCard').classList.add('ds-hidden');
    }

    const hasWebLogs = data.webLogs && data.webLogs.length > 0;
    const hasWagers = data.wagers && data.wagers.length > 0;
    if (!hasWebLogs && !hasWagers) {
      $('activityFreshness').classList.remove('ds-hidden');
    } else {
      $('activityFreshness').classList.add('ds-hidden');
    }

    const timelineEvents = buildTimeline(data);
    $('activityTimelineWrap').classList.remove('ds-hidden');
    if (!timelineEvents.length) {
      $('activityTimeline').innerHTML = renderEmptyState({ icon: '📭', message: 'No activity in this period', hint: `No web logs or wagers for ${selectedLogin} in the last ${activeHours}h. Web logs populate after the next ingestion run.` });
      return;
    }
    $('activityTimeline').innerHTML = timelineEvents.map((e) => `
      <div class="ds-timeline__item">
        <span class="ds-timeline__dot ds-timeline__dot--${e.dotClass}"></span>
        <div class="ds-timeline__content">
          <div class="ds-timeline__time">${ago(e.time)}</div>
          <div class="ds-timeline__title">${e.title}</div>
          <div class="ds-timeline__meta">${e.meta}</div>
        </div>
      </div>
    `).join('');

    const cid = customer?.customer_id || profile?.customerId;
    if (cid) {
      $('activityTransactionsWrap').classList.remove('ds-hidden');
      await loadCustomerTransactions(ctx, cid);
    } else {
      $('activityTransactionsWrap').classList.add('ds-hidden');
    }
  } catch (e) {
    $('activityTimeline').innerHTML = renderErrorState(e.message, '/customer-activity');
  }
}

async function loadCustomerTransactions(ctx, customerId) {
  const txType = ($('activityTxType')?.value || 'player').trim();
  const today = new Date().toISOString().slice(0, 10);
  const startDate = $('activityTxStart')?.value || today;
  const endDate = $('activityTxEnd')?.value || today;
  try {
    $('activityTransactions').innerHTML = '<div class="ds-skeleton ds-skeleton-row"></div><div class="ds-skeleton ds-skeleton-row ds-skeleton-row--medium"></div>';
    const url = `/transactions-live?type=${encodeURIComponent(txType)}&customer_id=${encodeURIComponent(customerId)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&limit=50`;
    const res = await ctx.api(url);
    const rows = res.rows || [];
    if (!rows.length) {
      $('activityTransactions').innerHTML = renderEmptyState({ icon: '📄', message: 'No transactions', hint: `${res.type_label || txType} for this period.` });
      return;
    }
    $('activityTransactions').innerHTML = `<table class="ds-table-sm"><thead><tr>
      <th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>Balance</th><th>Reference</th>
    </tr></thead><tbody>${rows.map((r) => `
      <tr>
        <td>${r.posted_at ? ago(r.posted_at) : '-'}</td>
        <td>${escapeHtml(r.transaction_type || '')}</td>
        <td>${escapeHtml(r.description || '')}</td>
        <td class="ds-num">${r.amount != null ? usd(Number(r.amount) / 100) : '-'}</td>
        <td class="ds-num">${r.balance != null ? usd(Number(r.balance) / 100) : '-'}</td>
        <td>${escapeHtml(r.reference || '')}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch (e) {
    $('activityTransactions').innerHTML = renderErrorState(e.message, '/transactions-live');
  }
}

function buildTimeline(data) {
  const webLogs = (data.webLogs || []).map((w) => ({
    type: 'web',
    time: w.access_date_time,
    dotClass: 'info',
    title: `<span class="ds-badge ds-badge--info">web</span> ${escapeHtml(w.operation || 'unknown')}`,
    meta: `IP: ${escapeHtml(w.ip_address || '—')}${w.data ? ` · ${escapeHtml(w.data)}` : ''}`,
  }));
  const wagers = (data.wagers || []).map((w) => ({
    type: 'wager',
    time: w.captured_at,
    dotClass: 'success',
    title: `<span class="ds-badge ds-badge--success">wager</span> ${usd(w.amount_wagered)} (${escapeHtml(w.wager_type)})`,
    meta: `#${w.wager_number}${w.short_desc ? ` · ${escapeHtml(w.short_desc)}` : ''}`,
  }));
  const all = [...webLogs, ...wagers].sort((a, b) => new Date(b.time) - new Date(a.time));
  if (activityFilter === 'web') return all.filter((e) => e.type === 'web');
  if (activityFilter === 'wager') return all.filter((e) => e.type === 'wager');
  return all;
}

export function initActivityView(ctx) {
  $('activitySearchInput').addEventListener('input', () => debouncedSearch(ctx));
  $('activitySearchInput').addEventListener('keydown', (e) => {
    const dropdown = $('activityDropdown');
    const items = dropdown.querySelectorAll('.ds-dropdown__item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      dropdownIndex = Math.min(dropdownIndex + 1, items.length - 1);
      highlightDropdownItem(dropdown);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      dropdownIndex = Math.max(dropdownIndex - 1, 0);
      highlightDropdownItem(dropdown);
    } else if (e.key === 'Enter' && dropdownIndex >= 0 && items[dropdownIndex]) {
      e.preventDefault();
      selectCustomer(ctx, items[dropdownIndex].dataset.login);
    } else if (e.key === 'Enter') {
      const val = ($('activitySearchInput').value || '').trim();
      if (val) selectCustomer(ctx, val);
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });
  document.addEventListener('click', (e) => {
    const dropdown = $('activityDropdown');
    if (dropdown && !e.target.closest('#activitySearchWrap')) {
      dropdown.classList.remove('ds-dropdown--visible');
    }
  });
  document.querySelectorAll('[data-activity-hours]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      activeHours = Number(btn.dataset.activityHours);
      paintTimeRanges();
      if (selectedLogin) await loadCustomerActivity(ctx);
    });
  });
  document.querySelectorAll('[data-activity-filter]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      activityFilter = btn.dataset.activityFilter;
      paintActivityFilters();
      if (selectedLogin) await loadCustomerActivity(ctx);
    });
  });
  $('activityTxType')?.addEventListener('change', async () => {
    if (selectedLogin) {
      const data = await ctx.api(`/customer-activity?login=${encodeURIComponent(selectedLogin)}&hours=1&limit=1`);
      const cid = data?.customer?.customer_id || data?.profile?.customerId;
      if (cid) loadCustomerTransactions(ctx, cid);
    }
  });
  $('activityTxRefresh')?.addEventListener('click', async () => {
    if (selectedLogin) {
      const data = await ctx.api(`/customer-activity?login=${encodeURIComponent(selectedLogin)}&hours=1&limit=1`);
      const cid = data?.customer?.customer_id || data?.profile?.customerId;
      if (cid) loadCustomerTransactions(ctx, cid);
    }
  });
}
