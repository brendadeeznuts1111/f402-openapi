// dashboard/js/ui.js — toasts, errors, breadcrumbs, tabs, drawer

import { $, escapeHtml } from './dom.js';
import { getZoneName } from './design-system.js';

let configBannerEl = null;

/** Sticky banner for deployment / proxy misconfiguration (dismissible). */
export function showConfigBanner(msg, severity = 'error') {
  if (configBannerEl) configBannerEl.remove();
  const el = document.createElement('div');
  el.className = `ds-config-banner ds-config-banner--${escapeHtml(severity)}`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `${escapeHtml(msg)} <button type="button" class="ds-config-banner__dismiss" aria-label="Dismiss">✕</button>`;
  el.querySelector('.ds-config-banner__dismiss')?.addEventListener('click', () => el.remove());
  document.body.prepend(el);
  configBannerEl = el;
}

export function showAlert(msg, severity = 'warn', settings) {
  const el = document.createElement('div');
  el.className = `ds-toast-item ds-toast-item--${escapeHtml(severity)}`;
  el.innerHTML = `${escapeHtml(msg)} <span class="ds-dismiss" data-action="dismiss-toast">✕</span>`;
  $('alertContainer').appendChild(el);
  setTimeout(() => el.remove(), 8000);
  if (settings?.get('notifications') && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Fantasy402', { body: msg });
  }
}

export function renderErrorState(msg, endpoint = '') {
  const zone = getZoneName(endpoint);
  return `<div class="ds-error-state ${zone !== 'worker' ? `ds-error-state--${escapeHtml(zone)}` : ''}">${escapeHtml(msg)}</div>`;
}

export function updateBreadcrumbs(view, tab) {
  const labels = { overview: 'Overview', analytics: 'Analytics', logs: 'Logs', settings: 'Settings', endpoints: 'Endpoints' };
  const tabLabels = {
    traffic: 'Traffic', latency: 'Latency', distribution: 'Distribution',
    events: 'Events', agent: 'Agent Logs', system: 'System',
    general: 'General', api: 'API', appearance: 'Appearance', data: 'Data',
  };
  let html = '<span class="ds-breadcrumb__item ds-breadcrumb__item--active">Dashboard</span>';
  html += '<span class="ds-breadcrumb__separator">/</span>';
  html += `<span class="ds-breadcrumb__item${tab ? '' : ' ds-breadcrumb__item--active'}">${labels[view] || view}</span>`;
  if (tab) {
    html += '<span class="ds-breadcrumb__separator">/</span>';
    html += `<span class="ds-breadcrumb__item ds-breadcrumb__item--active">${tabLabels[tab] || tab}</span>`;
  }
  $('breadcrumb').innerHTML = html;
}

export function openDrawer() {
  $('settingsDrawer').classList.add('ds-drawer--open');
  $('drawerBackdrop').classList.add('ds-drawer__backdrop--visible');
  document.body.style.overflow = 'hidden';
  const first = $('settingsDrawer').querySelector('button, select, input, textarea, [tabindex]:not([tabindex="-1"])');
  if (first) first.focus();
}

export function closeDrawer() {
  $('settingsDrawer').classList.remove('ds-drawer--open');
  $('drawerBackdrop').classList.remove('ds-drawer__backdrop--visible');
  document.body.style.overflow = '';
}

export function switchChartTab(name, handlers) {
  document.querySelectorAll('[data-chart-tab]').forEach((t) => {
    t.classList.toggle('ds-active', t.dataset.chartTab === name);
  });
  document.querySelectorAll('#view-analytics .ds-tab-content').forEach((c) => {
    c.classList.toggle('ds-active', c.id === `tab-${name}`);
    c.style.display = '';
  });
  updateBreadcrumbs('analytics', name);
  handlers?.(name);
}

export function switchLogTab(name) {
  document.querySelectorAll('[data-log-tab]').forEach((t) => t.classList.toggle('ds-active', t.dataset.logTab === name));
  document.querySelectorAll('#view-logs .ds-tab-content').forEach((c) => {
    c.style.display = c.id === `tab-${name}` ? 'block' : 'none';
  });
  updateBreadcrumbs('logs', name);
}

export function switchSettingsTab(name) {
  document.querySelectorAll('[data-settings-tab]').forEach((t) => t.classList.toggle('ds-active', t.dataset.settingsTab === name));
  document.querySelectorAll('#view-settings .ds-tab-content').forEach((c) => {
    c.style.display = c.id === `tab-${name}` ? 'block' : 'none';
  });
  updateBreadcrumbs('settings', name);
}

export function storeTTL(refreshMs) {
  if (typeof refreshMs !== 'number' || refreshMs <= 0) return 3000;
  return Math.max(refreshMs * 0.65, 3000);
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}
