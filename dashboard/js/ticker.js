// dashboard/js/ticker.js — live wager ticker + SSE lifecycle

import { $ } from './dom.js';
import { escapeHtml } from './dom.js';
import { fmt, usd, ago, tag } from './format.js';
import { isMissingTokenError } from './api-client.js';

export function createTicker(ctx) {
  let tickerSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  let tickerItems = [];
  let apiConfigured = true;

  function getMaxItems() {
    return ctx.settings.get('maxTickerItems') || 100;
  }

  function updateConn(status) {
    const el = $('connStatus');
    el.className = 'ds-conn-status ds-conn-status--' + status;
    const labels = {
      connected: 'Live (SSE)',
      connecting: 'Connecting…',
      reconnecting: 'Reconnecting…',
      polling: 'Polling',
      error: 'Connection error',
      failed: 'Stream failed',
      disconnected: 'Offline',
      degraded: 'Live only (API token missing)',
    };
    el.title = labels[status] || status;
  }

  function matchesFilters(w) {
    const type = $('tickerType').value;
    const min = parseInt($('tickerMin').value, 10) || 0;
    if (type && w.wager_type !== type) return false;
    if (min > 0 && w.amount_wagered < min * 100) return false;
    return true;
  }

  function render() {
    const feed = $('tickerFeed');
    const filtered = tickerItems.filter(matchesFilters);
    if (!filtered.length) {
      if (!apiConfigured) {
        feed.innerHTML = '<div class="ds-empty-state"><div class="ds-empty-state__icon">🔑</div><div class="ds-empty-state__message">Live wagers available via SSE. Configure Pages secret for historical ticker data.</div></div>';
        return;
      }
      feed.innerHTML = tickerItems.length === 0
        ? '<div class="ds-skeleton ds-skeleton-ticker"></div><div class="ds-skeleton ds-skeleton-ticker"></div><div class="ds-skeleton ds-skeleton-ticker"></div>'
        : '<div class="ds-empty-state"><div class="ds-empty-state__icon">📭</div><div class="ds-empty-state__message">No wagers match filters</div></div>';
      return;
    }
    feed.innerHTML = filtered.map((w) => `
      <div class="ds-ticker-item">
        <span class="ds-login">${escapeHtml(w.login || '?')}</span>
        <span>${tag(w.wager_type)}</span>
        <span class="ds-amount">${usd(w.amount_wagered)}</span>
        <span class="ds-time">${ago(w.captured_at)}</span>
      </div>
    `).join('');
  }

  function add(wager) {
    if (!wager) return;
    const key = wager.id || `${wager.login}-${wager.captured_at}`;
    if (wager.id && tickerItems.some((w) => w.id === wager.id)) return;
    tickerItems.unshift(wager);
    if (tickerItems.length > getMaxItems()) tickerItems = tickerItems.slice(0, getMaxItems());
    if (wager.captured_at && wager.captured_at > tickerSince) {
      tickerSince = wager.captured_at;
      ctx.wagerSocket.updateSince(tickerSince);
      ctx.pollFallback.updateSince(tickerSince);
    }
    render();
    $('lastUpdate').textContent = new Date().toLocaleTimeString();
  }

  function startPollingFallback() {
    ctx.pollFallback.setTickerItems(tickerItems);
    ctx.pollFallback.start();
  }

  function startSSE() {
    ctx.pollFallback.stop();
    ctx.wagerSocket.cancelFallback();
    updateConn('connecting');

    const seed = () => {
      if (!apiConfigured) return Promise.resolve();
      return ctx.api(`/bet-ticker-wagers?limit=50&since=${encodeURIComponent(tickerSince)}`, { silent: true })
        .then((d) => {
          if (d.wagers?.length) {
            for (const w of [...d.wagers].reverse()) add(w);
          }
        })
        .catch((e) => {
          if (isMissingTokenError(e)) {
            apiConfigured = false;
            render();
          } else {
            console.warn('[Ticker] seed fetch failed', e.message);
          }
        });
    };

    seed().finally(() => {
      ctx.wagerSocket.reconnect();
      ctx.wagerSocket.scheduleFallback(10000, () => {
        if (ctx.wagerSocket.source?.readyState === EventSource.OPEN) return;
        startPollingFallback();
      });
    });
  }

  function stopSSE() {
    ctx.wagerSocket.cancelFallback();
    ctx.wagerSocket.disconnect();
    ctx.pollFallback.stop();
    updateConn('disconnected');
  }

  return { render, add, startSSE, stopSSE, updateConn };
}
