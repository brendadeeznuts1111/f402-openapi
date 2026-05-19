// dashboard/js/store.js
// Lightweight data store with TTL cache and EventEmitter pattern.
// Used as the single source of truth for dashboard data.

export class DataStore {
  constructor() {
    this._cache = new Map();
    this._listeners = new Map();
    this._fetchQueue = new Map();
  }

  // ── Read ──

  get(key) {
    const entry = this._cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > entry.ttl) {
      this._cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  // ── Write ──

  set(key, data, ttl) {
    this._cache.set(key, { data, ts: Date.now(), ttl });
    this._emit(key, data);
  }

  invalidate(key) {
    this._cache.delete(key);
    this._emit(key, undefined);
  }

  invalidateAll() {
    const keys = Array.from(this._cache.keys());
    this._cache.clear();
    for (const key of keys) {
      this._emit(key, undefined);
    }
  }

  // ── Fetch-and-cache ──

  async fetch(key, fetcher, ttl) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    // Deduplicate concurrent fetches for the same key
    if (this._fetchQueue.has(key)) {
      return this._fetchQueue.get(key);
    }

    const promise = fetcher()
      .then((data) => {
        this.set(key, data, ttl);
        return data;
      })
      .finally(() => {
        this._fetchQueue.delete(key);
      });

    this._fetchQueue.set(key, promise);
    return promise;
  }

  // ── EventEmitter ──

  on(key, fn) {
    if (!this._listeners.has(key)) this._listeners.set(key, []);
    this._listeners.get(key).push(fn);
    return () => this.off(key, fn);
  }

  off(key, fn) {
    const fns = this._listeners.get(key);
    if (!fns) return;
    const i = fns.indexOf(fn);
    if (i !== -1) fns.splice(i, 1);
  }

  _emit(key, data) {
    const fns = this._listeners.get(key);
    if (!fns) return;
    for (const fn of fns) {
      try { fn(data); } catch (e) { console.error('[DataStore] listener error', key, e); }
    }
  }
}
