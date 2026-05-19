// dashboard/js/sortable-table.js
// Lightweight sortable table with click-to-sort headers.

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class SortableTable {
  constructor(containerId, columns, options = {}) {
    this.container = document.getElementById(containerId);
    this.columns = columns; // [{ key, label, type: 'string'|'number'|'date', formatter? }]
    this.rows = [];
    this.sortKey = null;
    this.sortDir = 'asc';
    this.options = { emptyText: 'No data', ...options };
  }

  setData(rows) {
    this.rows = rows;
    this.render();
  }

  render() {
    if (!this.rows.length) {
      this.container.innerHTML = `<div class="ds-loading">${this.options.emptyText}</div>`;
      return;
    }

    const headerHtml = this.columns.map((col) => {
      const isSorted = this.sortKey === col.key;
      const arrow = isSorted ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="ds-sortable-header${isSorted ? ' ds-sortable-header--active' : ''}" data-sort="${col.key}">${col.label}${arrow}</th>`;
    }).join('');

    const bodyHtml = this.rows.map((row) => {
      const cells = this.columns.map((col) => {
        const value = row[col.key];
        const display = col.formatter ? col.formatter(value, row) : (value == null ? '-' : value);
        return `<td>${escapeHtml(display)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    this.container.innerHTML = `<table class="ds-table-sm"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;

    this.container.querySelectorAll('.ds-sortable-header').forEach((th) => {
      th.addEventListener('click', () => this._sort(th.dataset.sort));
    });
  }

  _sort(key) {
    const col = this.columns.find((c) => c.key === key);
    if (!col) return;

    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }

    this.rows.sort((a, b) => {
      let av = a[key];
      let bv = b[key];

      if (col.type === 'number') {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      } else if (col.type === 'date') {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      } else {
        av = String(av).toLowerCase();
        bv = String(bv).toLowerCase();
      }

      if (av < bv) return this.sortDir === 'asc' ? -1 : 1;
      if (av > bv) return this.sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    this.render();
  }
}
