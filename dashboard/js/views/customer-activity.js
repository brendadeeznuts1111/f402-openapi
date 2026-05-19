// dashboard/js/views/customer-activity.js — Customer Activity Monitor
// Combines getWebLog access logs with getBetTicker wager activity.

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { usd, fmt, ago } from '../format.js';
import { renderErrorState } from '../ui.js';
import { renderEmptyState } from '../design-system.js';

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

export function setActivityFilter(filter) {
  activityFilter = filter;
}

export async function loadActivityView(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  $('activitySearchInput').value = '';
  $('activitySearchInput').focus();
  $('activityDropdown').innerHTML = '';
  $('activityDropdown').classList.remove('ds-dropdown--visible');
  $('activityCustomerCard').classList.add('ds-hidden');
  $('activityTimelineWrap').classList.add('ds-hidden');
  selectedLogin = null;
}

function debouncedSearch(ctx) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => performSearch(ctx), 300);
}

async function performSearch(ctx) {
  const q = ($('activitySearchInput').value || '').trim();
  const dropdown = $('activityDropdown');
  if (!q) {
    dropdown.innerHTML = '';
    dropdown.classList.remove('ds-dropdown--visible');
    return;
  }
  try {
    const result = await ctx.apiPost('/customer-activity-search', { q, limit: 15 });
    const records = result.records || [];
    if (!records.length) {
      dropdown.innerHTML = '<div class="ds-dropdown__empty">No customers found</div>';
      dropdown.classList.add('ds-dropdown--visible');
      return;
    }
    dropdown.innerHTML = records.map((r) =>
      `<div class="ds-dropdown__item" data-login="${escapeHtml(r.login)}">
        <span class="ds-dropdown__primary">${escapeHtml(r.login)}</span>
        <span class="ds-dropdown__secondary">${escapeHtml(r.name_first || '')} · ${escapeHtml(r.agent_id)}</span>
      </div>`
    ).join('');
    dropdown.classList.add('ds-dropdown--visible');
    dropdown.querySelectorAll('.ds-dropdown__item').forEach((item) => {
      item.addEventListener('click', () => selectCustomer(ctx, item.dataset.login));
    });
  } catch (e) {
    dropdown.innerHTML = `<div class="ds-dropdown__empty">${escapeHtml(e.message)}</div>`;
    dropdown.classList.add('ds-dropdown--visible');
  }
}

async function selectCustomer(ctx, login) {
  selectedLogin = login;
  $('activitySearchInput').value = login;
  $('activityDropdown').classList.remove('ds-dropdown--visible');
  await loadCustomerActivity(ctx);
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
    const data = await ctx.api(`/customer-activity?login=${encodeURIComponent(selectedLogin)}&hours=${activeHours}&limit=100`);
    const customer = data.customer;
    const summary = data.summary;

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

    $('activityStatCards').innerHTML = `
      <div class="ds-stat-card"><div class="ds-stat-card__icon">📊</div><div class="ds-stat-card__value">${fmt(summary.total_wagers)}</div><div class="ds-stat-card__label">Wagers</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">💰</div><div class="ds-stat-card__value">${usd(summary.total_volume)}</div><div class="ds-stat-card__label">Volume</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">🔑</div><div class="ds-stat-card__value">${fmt(summary.total_logins)}</div><div class="ds-stat-card__label">Logins</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">🌐</div><div class="ds-stat-card__value">${fmt(summary.unique_ips)}</div><div class="ds-stat-card__label">IPs</div></div>
    `;

    const timelineEvents = buildTimeline(data);
    $('activityTimelineWrap').classList.remove('ds-hidden');
    if (!timelineEvents.length) {
      $('activityTimeline').innerHTML = renderEmptyState({ icon: '📭', message: 'No activity in this period', hint: `No web logs or wagers for ${selectedLogin} in the last ${activeHours}h` });
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
  } catch (e) {
    $('activityTimeline').innerHTML = renderErrorState(e.message, '/customer-activity');
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
    if (e.key === 'Enter') {
      const val = ($('activitySearchInput').value || '').trim();
      if (val) selectCustomer(ctx, val);
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
}
