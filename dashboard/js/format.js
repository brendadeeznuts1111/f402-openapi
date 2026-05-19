// dashboard/js/format.js — display formatters (utils.js)

import { DateFormatter, NumberFormatter } from './utils.js';
import { escapeHtml } from './dom.js';

export const fmt = NumberFormatter.integer.bind(NumberFormatter);
export const usd = NumberFormatter.currency.bind(NumberFormatter);
export const ago = DateFormatter.relative.bind(DateFormatter);

export function tag(wt) {
  const classMap = { S: 's', P: 'p', M: 'm', L: 'l' };
  const labelMap = { S: 'Straight', P: 'Parlay', M: 'Moneyline', L: 'Live' };
  const key = classMap[wt] || String(wt || '').toLowerCase();
  const label = labelMap[wt] || escapeHtml(wt);
  return `<span class="ds-badge ds-badge--${key}">${label}</span>`;
}
