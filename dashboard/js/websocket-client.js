// dashboard/js/websocket-client.js
// SSE live-wager stream (same-origin) + external WebSocket + polling fallback.

import { DEFAULT_BET_TICKER_WS_URL } from './constants.js';

const BASE = '/api';

function isExternalWsUrl(endpoint) {
  return /^wss?:\/\//i.test(endpoint);
}

function parseWagerPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const wager = raw.wager || raw;
  if (!wager || typeof wager !== 'object') return null;
  if (!wager.captured_at && !wager.id && !wager.login) return null;
  return wager;
}

// ── Live stream client (SSE or WebSocket) ───────────────────────

export class WagerSocket {
  constructor(baseUrl = BASE, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.wsEndpoint = options.wsEndpoint ?? DEFAULT_BET_TICKER_WS_URL;
    this.transport = isExternalWsUrl(this.wsEndpoint) ? 'websocket' : 'sse';
    this.source = null;
    this.ws = null;
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

  get mode() {
    return this.transport;
  }

  setWsEndpoint(endpoint) {
    const next = endpoint || DEFAULT_BET_TICKER_WS_URL;
    const nextTransport = isExternalWsUrl(next) ? 'websocket' : 'sse';
    this.wsEndpoint = next;
    this.transport = nextTransport;
  }

  updateSince(iso) {
    if (iso && iso > this.since) this.since = iso;
  }

  isConnected() {
    if (this.transport === 'websocket') {
      return this.ws?.readyState === WebSocket.OPEN;
    }
    return this.source?.readyState === EventSource.OPEN;
  }

  _buildUrl() {
    if (this.transport === 'websocket') return this.wsEndpoint;
    const path = this.wsEndpoint.startsWith('/') ? this.wsEndpoint : `/${this.wsEndpoint}`;
    return `${this.baseUrl}${path}?since=${encodeURIComponent(this.since)}`;
  }

  _emit(status) {
    this._onStatusChange?.(status);
  }

  _handleWager(wager) {
    if (!wager) return;
    if (wager.captured_at) this.updateSince(wager.captured_at);
    this._onWager?.(wager);
  }

  connect() {
    if (this._closed) return;
    this._emit('connecting');
    if (this.transport === 'websocket') {
      this._connectWebSocket();
      return;
    }
    this._connectSSE();
  }

  _connectSSE() {
    this.source?.close();
    this.ws?.close();
    this.ws = null;
    this.source = new EventSource(this._buildUrl());

    this.source.onopen = () => {
      this.reconnectDelay = 1000;
      this._reconnectCount = 0;
      this._emit('connected');
    };

    this.source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleWager(parseWagerPayload(data));
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

  _connectWebSocket() {
    this.source?.close();
    this.source = null;
    this.ws?.close();
    this.ws = new WebSocket(this._buildUrl());

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this._reconnectCount = 0;
      this._emit('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this._handleWager(parseWagerPayload(data));
      } catch (e) {
        console.warn('[WS] Parse error:', e);
      }
    };

    this.ws.onerror = () => {
      this._emit('error');
    };

    this.ws.onclose = () => {
      if (this._closed) {
        this._emit('disconnected');
        return;
      }
      this._emit('reconnecting');
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
    this.ws?.close();
    this.ws = null;
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
    this.source = null;
    this.ws?.close();
    this.ws = null;
    this.connect();
  }

  /** Start polling fallback if the live stream has not connected within ms. */
  scheduleFallback(ms, onStart) {
    if (this._fallbackTimer) clearTimeout(this._fallbackTimer);
    this._fallbackTimer = setTimeout(() => {
      if (this._closed) return;
      if (this.isConnected()) return;
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
