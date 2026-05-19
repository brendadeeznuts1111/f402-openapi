// dashboard/js/theme.js

import { $ } from './dom.js';

export function resolveTheme(preference) {
  if (preference === 'auto') {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return preference === 'light' ? 'light' : 'dark';
}

export function applyTheme(settings, preference) {
  const pref = preference ?? settings.get('theme') ?? 'dark';
  const theme = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('f402-theme', theme);
  $('themeToggle').textContent = theme === 'light' ? '☀️' : '🌙';
  document.documentElement.dispatchEvent(
    new CustomEvent('f402-theme-change', { detail: { theme } }),
  );
}

export function initTheme(settings, onThemeChange) {
  applyTheme(settings);
  window.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener('change', () => {
    if (settings.get('theme') === 'auto') onThemeChange?.();
  });
}
