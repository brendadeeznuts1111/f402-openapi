// dashboard/js/settings-manager.js
// Settings persistence with localStorage and validation.

const SETTINGS_KEY = 'f402-dashboard-settings';

export class SettingsManager {
  constructor() {
    this._settings = this._load();
    this._listeners = [];
  }

  get(key) {
    return this._settings[key];
  }

  set(key, value) {
    this._settings[key] = value;
    this._save();
    this._notify(key, value);
  }

  getAll() {
    return { ...this._settings };
  }

  reset() {
    this._settings = this._defaults();
    this._save();
    this._notify('*', this._settings);
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i !== -1) this._listeners.splice(i, 1);
    };
  }

  _defaults() {
    return {
      theme: 'dark',
      apiBase: '/api',
      refreshInterval: 15000,
      maxTickerItems: 100,
      notifications: true,
      soundAlerts: false,
      chartType: 'line',
      logLevel: 'info',
    };
  }

  _load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...this._defaults(), ...JSON.parse(raw) };
    } catch {}
    return this._defaults();
  }

  _save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
    } catch {}
  }

  _notify(key, value) {
    for (const fn of this._listeners) {
      try { fn(key, value); } catch (e) { console.error(e); }
    }
  }
}
