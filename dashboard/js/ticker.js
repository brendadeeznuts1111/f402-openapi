// dashboard/js/ticker.js — live wager ticker + SSE lifecycle

import { $ } from './dom.js';
import { escapeHtml } from './dom.js';
import { fmt, usd, ago, tag } from './format.js';

export function createTicker(ctx) {
  let tickerSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  let tickerItems = [];

  function getMaxItems() {
    return ctx.settings.get('maxTickerItems') || 100;
  }

  function updateConn(status) {
    $('connStatus').className = 'ds-conn-status ds-conn-status--' + status;
  }

  function matchesFilters(w) {
    const type = $('tickerType').value;
    const min = parseInt($('tickerMin').value) || 0;
    if (type && w.wager_type !== type) return false;
    if (min > 0 && w.amount_wagered < min * 100) return false;
    return true;
  }

  function render() {
    const feed = $('tickerFeed');
    const filtered = tickerItems.filter(matchesFilters);
    if (!filtered.length) {
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
    tickerItems.unshift(wager);
    if (tickerItems.length > getMaxItems()) tickerItems = tickerItems.slice(0, getMaxItems());
    if (wager.captured_at && wager.captured_at > tickerSince) {
      tickerSince = wager.captured_at;
      ctx.wagerSocket.updateSince(tickerSince);
    }
    render();
    $('lastUpdate').textContent = new Date().toLocaleTimeString();
  }

  function startSSE() {
    ctx.pollFallback.stop();
    updateConn('polling');
    ctx.api(`/bet-ticker-wagers?limit=50&since=${encodeURIComponent(tickerSince)}`)
      .then((d) => { if (d.wagers?.length) for (const w of d.wagers.reverse()) add(w); })
      .catch((e) => console.warn('seed fetch failed', e));
    ctx.wagerSocket.reconnect();
    setTimeout(() => {
      const src = ctx.wagerSocket.source;
      if (src && src.readyState !== EventSource.OPEN && !ctx.pollFallback.timer) {
        ctx.pollFallback.setTickerItems(tickerItems);
        ctx.pollFallback.start();
      }
    }, 10000);
  }

  function stopSSE() {
    ctx.wagerSocket.disconnect();
    ctx.pollFallback.stop();
  }

  return { render, add, startSSE, stopSSE, updateConn };
}
