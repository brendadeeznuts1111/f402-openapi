// dashboard/js/websocket-client.js
// Robust SSE manager with auto-reconnect (exponential backoff) and since-aware reconnection.
// Also provides a polling fallback for when SSE is unavailable.

const BASE = '/api';

// ── SSE Client ─────────────────────────────────────────────────

export class WagerSocket {
  constructor(baseUrl = BASE, options = {}) {
    this.baseUrl = baseUrl;
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
  }

  set onWager(fn) { this._onWager = fn; }
  set onStatusChange(fn) { this._onStatusChange = fn; }

  updateSince(iso) {
    if (iso && iso > this.since) this.since = iso;
  }

  _buildUrl() {
    return `${this.baseUrl}/live-wagers?since=${encodeURIComponent(this.since)}`;
  }

  connect() {
    if (this._closed) return;
    this.source = new EventSource(this._buildUrl());

    this.source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const wager = data.wager || data;
        if (wager.captured_at) this.updateSince(wager.captured_at);
        this._onWager?.(wager);
      } catch (e) {
        console.error('[SSE] Parse error:', e);
      }
    };

    this.source.onopen = () => {
      this.reconnectDelay = 1000;
      this._reconnectCount = 0;
      this._onStatusChange?.('connected');
    };

    this.source.onerror = () => {
      this._onStatusChange?.('error');
      this.source.close();
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._closed) return;
    this._reconnectCount += 1;
    if (this._reconnectCount > this.maxReconnectAttempts) {
      this._onStatusChange?.('failed');
      return;
    }
    this._onStatusChange?.('reconnecting');
    this._reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  disconnect() {
    this._closed = true;
    this.source?.close();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._onStatusChange?.('disconnected');
  }

  reconnect() {
    this._closed = false;
    this.reconnectDelay = 1000;
    this._reconnectCount = 0;
    this.source?.close();
    this.connect();
  }
}

// ── Polling Fallback ──────────────────────────────────────────

export class PollingFallback {
  constructor(baseUrl = BASE, interval = 5000) {
    this.baseUrl = baseUrl;
    this.interval = interval;
    this.timer = null;
    this.since = new Date(Date.now() - 60000).toISOString();
    this._onWager = null;
    this._tickerItems = [];
  }

  set onWager(fn) { this._onWager = fn; }

  setTickerItems(items) {
    this._tickerItems = items;
  }

  start() {
    this.stop();
    this.timer = setInterval(async () => {
      try {
        const res = await fetch(
          `${this.baseUrl}/bet-ticker-wagers?since=${encodeURIComponent(this.since)}&limit=50`
        );
        if (!res.ok) return;
        const d = await res.json();
        if (d.wagers?.length) {
          for (const w of d.wagers) {
            const exists = this._tickerItems.some((item) => item.id === w.id);
            if (!exists) {
              if (w.captured_at && w.captured_at > this.since) {
                this.since = w.captured_at;
              }
              this._onWager?.(w);
            }
          }
        }
      } catch (e) {
        console.error('[PollFallback] Error:', e);
      }
    }, this.interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
