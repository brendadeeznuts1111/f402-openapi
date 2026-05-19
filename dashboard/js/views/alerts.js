// dashboard/js/views/alerts.js — Alerts View (events, summary, rules CRUD)

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { fmt, ago } from '../format.js';
import { renderErrorState, storeTTL, showAlert } from '../ui.js';
import { getRefreshInterval, renderEmptyState } from '../design-system.js';

const SEVERITY_COLORS = {
  critical: 'error',
  error: 'error',
  warning: 'warn',
  warn: 'warn',
  info: 'info',
};

let alertsTab = 'events';
let eventsTimer = null;
let summaryTimer = null;

export function setAlertsTab(name) {
  alertsTab = name;
}

export function getAlertsTab() {
  return alertsTab;
}

export async function loadAlertsView(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  paintAlertsTabs();
  await loadActiveAlertsTab(ctx);
}

function paintAlertsTabs() {
  document.querySelectorAll('[data-alerts-tab]').forEach((t) => {
    const on = t.dataset.alertsTab === alertsTab;
    t.classList.toggle('ds-active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.setAttribute('tabindex', on ? '0' : '-1');
  });
  document.querySelectorAll('#view-alerts .ds-tab-content').forEach((c) => {
    const active = c.id === `tab-alerts-${alertsTab}`;
    c.classList.toggle('ds-active', active);
    c.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
}

async function loadActiveAlertsTab(ctx) {
  switch (alertsTab) {
    case 'events':
      await loadAlertEvents(ctx);
      break;
    case 'summary':
      await loadAlertSummary(ctx);
      break;
    case 'rules':
      await loadAlertRules(ctx);
      break;
  }
}

export async function onAlertsTabChange(name, ctx) {
  setAlertsTab(name);
  paintAlertsTabs();
  if (eventsTimer) clearTimeout(eventsTimer);
  if (summaryTimer) clearTimeout(summaryTimer);
  await loadActiveAlertsTab(ctx);
}

async function loadAlertEvents(ctx) {
  try {
    const severity = $('alertSeverityFilter')?.value || '';
    const type = $('alertTypeFilter')?.value || '';
    let path = '/alerts?limit=100';
    if (severity) path += `&severity=${encodeURIComponent(severity)}`;
    if (type) path += `&type=${encodeURIComponent(type)}`;

    const d = await ctx.store.fetch(
      'alert-events',
      () => ctx.api(path),
      storeTTL(getRefreshInterval('/alerts')),
    );
    const events = d.events || [];
    $('alertsEventsCount').textContent = `${events.length} events`;
    if (!events.length) {
      $('alertsEventsList').innerHTML = renderEmptyState({ icon: '🔔', message: 'No alert events', hint: 'Alerts are created during ingestion runs when configured thresholds are exceeded.' });
      return;
    }
    $('alertsEventsList').innerHTML = events.map((e) => {
      const sevClass = SEVERITY_COLORS[e.severity] || 'info';
      const ctxStr = e.context ? escapeHtml(JSON.stringify(e.context, null, 2)) : '';
      return `<div class="ds-timeline__item">
        <span class="ds-timeline__dot ds-timeline__dot--${sevClass}"></span>
        <div class="ds-timeline__content">
          <div class="ds-timeline__time">${ago(e.created_at)}</div>
          <div class="ds-timeline__title">
            <span class="ds-badge ds-badge--${sevClass}">${escapeHtml(e.severity)}</span>
            <span class="ds-badge ds-badge--info">${escapeHtml(e.type)}</span>
            ${escapeHtml(e.message)}
          </div>
          ${ctxStr ? `<pre class="ds-pre ds-pre--sm">${ctxStr}</pre>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    $('alertsEventsList').innerHTML = renderErrorState(e.message, '/alerts');
  }
}

async function loadAlertSummary(ctx) {
  try {
    const d = await ctx.store.fetch(
      'alert-summary',
      () => ctx.api('/alerts/summary?days=7'),
      storeTTL(30000),
    );
    $('alertsSummaryTotal').textContent = `${d.total} total (${d.days}d)`;
    const bySeverityHtml = d.bySeverity
      ? Object.entries(d.bySeverity).map(([sev, count]) =>
          `<span class="ds-badge ds-badge--${SEVERITY_COLORS[sev] || 'info'}">${escapeHtml(sev)}: ${count}</span>`
        ).join(' ')
      : '';
    $('alertsSummaryBySeverity').innerHTML = bySeverityHtml || renderEmptyState({ message: 'No severity data' });

    const byTypeHtml = d.byType
      ? Object.entries(d.byType).map(([type, count]) =>
          `<span class="ds-badge ds-badge--info">${escapeHtml(type)}: ${count}</span>`
        ).join(' ')
      : '';
    $('alertsSummaryByType').innerHTML = byTypeHtml || renderEmptyState({ message: 'No type data' });

    const dailyHtml = d.daily?.length
      ? `<table class="ds-table-sm"><thead><tr><th>Date</th><th>Total</th><th>By Severity</th></tr></thead><tbody>${
          d.daily.map((day) =>
            `<tr><td>${escapeHtml(day.date)}</td><td>${fmt(day.total)}</td><td>${
              Object.entries(day.bySeverity || {}).map(([s, c]) =>
                `<span class="ds-badge ds-badge--${SEVERITY_COLORS[s] || 'info'} ds-badge--xs">${escapeHtml(s)}: ${c}</span>`
              ).join(' ')
            }</td></tr>`
          ).join('')
        }</tbody></table>`
      : renderEmptyState({ message: 'No daily data' });
    $('alertsSummaryDaily').innerHTML = dailyHtml;

    const groupsHtml = d.groups?.length
      ? `<table class="ds-table-sm"><thead><tr><th>Severity</th><th>Type</th><th>Count</th><th>Latest</th></tr></thead><tbody>${
          d.groups.map((g) =>
            `<tr><td><span class="ds-badge ds-badge--${SEVERITY_COLORS[g.severity] || 'info'}">${escapeHtml(g.severity)}</span></td><td><span class="ds-badge ds-badge--info">${escapeHtml(g.type)}</span></td><td>${fmt(g.count)}</td><td>${g.latest ? ago(g.latest) : '-'}</td></tr>`
          ).join('')
        }</tbody></table>`
      : renderEmptyState({ message: 'No grouped data' });
    $('alertsSummaryGroups').innerHTML = groupsHtml;
  } catch (e) {
    $('alertsSummaryTotal').textContent = 'Error loading summary';
    $('alertsSummaryBySeverity').innerHTML = renderErrorState(e.message, '/alerts/summary');
  }
}

async function loadAlertRules(ctx) {
  try {
    const d = await ctx.store.fetch(
      'alert-rules',
      () => ctx.api('/alert-rules?limit=100'),
      storeTTL(getRefreshInterval('/alert-rules')),
    );
    const rules = d.rules || [];
    $('alertsRulesCount').textContent = `${rules.length} rules`;
    if (!rules.length) {
      $('alertsRulesList').innerHTML = renderEmptyState({ icon: '⚙️', message: 'No alert rules configured', hint: 'Create a rule using the form above.' });
      return;
    }
    $('alertsRulesList').innerHTML = `<table class="ds-table-sm"><thead><tr>
      <th>Agent</th><th>Metric</th><th>Condition</th><th>Threshold</th><th>Severity</th><th>Enabled</th><th>Created</th><th>Actions</th>
    </tr></thead><tbody>${rules.map((r) => `
      <tr>
        <td><code>${escapeHtml(r.agent_id)}</code></td>
        <td>${escapeHtml(r.metric)}</td>
        <td>${escapeHtml(r.operator)}</td>
        <td>${escapeHtml(String(r.threshold))}</td>
        <td><span class="ds-badge ds-badge--${SEVERITY_COLORS[r.severity] || 'info'}">${escapeHtml(r.severity)}</span></td>
        <td>${r.enabled ? '<span class="ds-badge ds-badge--success">enabled</span>' : '<span class="ds-badge ds-badge--warn">disabled</span>'}</td>
        <td>${r.created_at ? ago(r.created_at) : '-'}</td>
        <td>
          <button class="ds-btn ds-btn--sm ds-btn--danger" data-delete-rule="${escapeHtml(r.id)}" title="Delete rule">🗑</button>
          <button class="ds-btn ds-btn--sm" data-toggle-rule="${escapeHtml(r.id)}" data-enabled="${r.enabled ? '1' : '0'}" title="${r.enabled ? 'Disable' : 'Enable'} rule">${r.enabled ? '⏸' : '▶'}</button>
        </td>
      </tr>
    `).join('')}</tbody></table>`;

    $('alertsRulesList').querySelectorAll('[data-delete-rule]').forEach((btn) => {
      btn.addEventListener('click', () => deleteRule(ctx, btn.dataset.deleteRule));
    });
    $('alertsRulesList').querySelectorAll('[data-toggle-rule]').forEach((btn) => {
      btn.addEventListener('click', () => toggleRule(ctx, btn.dataset.toggleRule, btn.dataset.enabled === '1'));
    });
  } catch (e) {
    $('alertsRulesList').innerHTML = renderErrorState(e.message, '/alert-rules');
  }
}

async function deleteRule(ctx, id) {
  if (!confirm('Delete this alert rule?')) return;
  try {
    await ctx.api(`/alert-rules?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    ctx.showAlert('Rule deleted', 'info');
    loadAlertRules(ctx);
  } catch (e) {
    ctx.showAlert(`Delete failed: ${e.message}`, 'error');
  }
}

async function toggleRule(ctx, id, currentlyEnabled) {
  try {
    await ctx.api(`/alert-rules?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !currentlyEnabled }),
    });
    ctx.showAlert(currentlyEnabled ? 'Rule disabled' : 'Rule enabled', 'info');
    loadAlertRules(ctx);
  } catch (e) {
    ctx.showAlert(`Update failed: ${e.message}`, 'error');
  }
}

export async function createAlertRule(ctx) {
  const agentId = ($('ruleAgentId')?.value || '').trim();
  const metric = $('ruleMetric')?.value;
  const operator = $('ruleOperator')?.value;
  const threshold = parseInt($('ruleThreshold')?.value, 10);
  const severity = $('ruleSeverity')?.value || 'warning';

  if (!metric || !operator || isNaN(threshold) || threshold < 0) {
    ctx.showAlert('Fill all required fields (metric, operator, threshold)', 'warn');
    return;
  }

  try {
    await ctx.api('/alert-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId || '*',
        metric,
        operator,
        threshold,
        severity,
        enabled: true,
      }),
    });
    ctx.showAlert('Alert rule created', 'info');
    $('ruleAgentId').value = '';
    $('ruleThreshold').value = '';
    loadAlertRules(ctx);
  } catch (e) {
    ctx.showAlert(`Create failed: ${e.message}`, 'error');
  }
}

export async function triggerTestAlert(ctx) {
  try {
    const severity = $('testAlertSeverity')?.value || 'warning';
    const message = ($('testAlertMessage')?.value || '').trim() || 'Manual test from dashboard';
    await ctx.api('/alerts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ severity, message }),
    });
    ctx.showAlert('Test alert created', 'info');
    $('testAlertMessage').value = '';
    if (alertsTab === 'events') loadAlertEvents(ctx);
  } catch (e) {
    ctx.showAlert(`Test alert failed: ${e.message}`, 'error');
  }
}
