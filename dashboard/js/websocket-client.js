// dashboard/js/websocket-client.js
// SSE live-wager stream + polling fallback when SSE is unavailable.

const BASE = '/api';

function parseWagerPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const wager = raw.wager || raw;
  if (!wager || typeof wager !== 'object') return null;
  if (!wager.captured_at && !wager.id && !wager.login) return null;
  return wager;
}

// ── SSE Client ─────────────────────────────────────────────────

export class WagerSocket {
  constructor(baseUrl = BASE, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.source = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this._reconnectCount = 0;
    this.since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    this._onWager = null;
    this._onStatusChange = null;
    this._reconnectTimer = null;
    this._closed = false;
    this._fallbackTimer = null;
  }

  set onWager(fn) { this._onWager = fn; }
  set onStatusChange(fn) { this._onStatusChange = fn; }

  updateSince(iso) {
    if (iso && iso > this.since) this.since = iso;
  }

  _buildUrl() {
    return `${this.baseUrl}/live-wagers?since=${encodeURIComponent(this.since)}`;
  }

  _emit(status) {
    this._onStatusChange?.(status);
  }

  connect() {
    if (this._closed) return;
    this._emit('connecting');
    this.source?.close();
    this.source = new EventSource(this._buildUrl());

    this.source.onopen = () => {
      this.reconnectDelay = 1000;
      this._reconnectCount = 0;
      this._emit('connected');
    };

    this.source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const wager = parseWagerPayload(data);
        if (!wager) return;
        if (wager.captured_at) this.updateSince(wager.captured_at);
        this._onWager?.(wager);
      } catch (e) {
        console.warn('[SSE] Parse error:', e);
      }
    };

    this.source.onerror = () => {
      const state = this.source?.readyState;
      if (state === EventSource.CONNECTING) {
        this._emit('reconnecting');
        return;
      }
      this._emit('error');
      this.source?.close();
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._closed) return;
    this._reconnectCount += 1;
    if (this._reconnectCount > this.maxReconnectAttempts) {
      this._emit('failed');
      return;
    }
    this._emit('reconnecting');
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  disconnect() {
    this._closed = true;
    this.source?.close();
    this.source = null;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
    }
    this._emit('disconnected');
  }

  reconnect() {
    this._closed = false;
    this.reconnectDelay = 1000;
    this._reconnectCount = 0;
    this.source?.close();
    this.connect();
  }

  /** Start polling fallback if SSE has not connected within ms. */
  scheduleFallback(ms, onStart) {
    if (this._fallbackTimer) clearTimeout(this._fallbackTimer);
    this._fallbackTimer = setTimeout(() => {
      if (this._closed) return;
      if (this.source?.readyState === EventSource.OPEN) return;
      onStart?.();
    }, ms);
  }

  cancelFallback() {
    if (this._fallbackTimer) {
      clearTimeout(this._fallbackTimer);
      this._fallbackTimer = null;
    }
  }
}

// ── Polling Fallback ──────────────────────────────────────────

export class PollingFallback {
  constructor(baseUrl = BASE, interval = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.interval = interval;
    this.timer = null;
    this.since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    this._onWager = null;
    this._onStatusChange = null;
    this._tickerItems = [];
    this._seenIds = new Set();
  }

  set onWager(fn) { this._onWager = fn; }
  set onStatusChange(fn) { this._onStatusChange = fn; }

  setTickerItems(items) {
    this._tickerItems = items;
    this._seenIds = new Set(items.map((w) => w.id).filter(Boolean));
  }

  updateSince(iso) {
    if (iso && iso > this.since) this.since = iso;
  }

  async pollOnce() {
    const url = `${this.baseUrl}/bet-ticker-wagers?since=${encodeURIComponent(this.since)}&limit=50`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.message) detail = body.message;
      } catch {}
      throw new Error(detail);
    }
    return res.json();
  }

  start() {
    this.stop();
    this._onStatusChange?.('polling');
    const tick = async () => {
      try {
        const d = await this.pollOnce();
        if (d.wagers?.length) {
          for (const w of d.wagers) {
            const key = w.id || `${w.login}-${w.captured_at}-${w.wager_number}`;
            if (this._seenIds.has(key)) continue;
            this._seenIds.add(key);
            if (w.captured_at && w.captured_at > this.since) {
              this.since = w.captured_at;
            }
            this._onWager?.(w);
          }
        }
      } catch (e) {
        console.warn('[PollFallback]', e.message);
      }
    };
    tick();
    this.timer = setInterval(tick, this.interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
