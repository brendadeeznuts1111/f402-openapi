// dashboard/js/json-viewer.js
// Syntax-highlighted JSON viewer with collapsible sections.

export class JsonViewer {
  constructor(containerId, data, options = {}) {
    this.container = document.getElementById(containerId);
    this.data = data;
    this.options = { indent: 2, maxDepth: 10, ...options };
  }

  render() {
    if (!this.container) return;
    const html = this._format(this.data, 0);
    this.container.innerHTML = `<div class="ds-json-viewer">${html}</div>`;
  }

  setData(data) {
    this.data = data;
    this.render();
  }

  _format(value, depth) {
    if (depth > this.options.maxDepth) {
      return `<span class="ds-json-viewer__null">…</span>`;
    }

    if (value === null) {
      return `<span class="ds-json-viewer__null">null</span>`;
    }

    if (typeof value === 'boolean') {
      return `<span class="ds-json-viewer__boolean">${value}</span>`;
    }

    if (typeof value === 'number') {
      return `<span class="ds-json-viewer__number">${value}</span>`;
    }

    if (typeof value === 'string') {
      const escaped = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<span class="ds-json-viewer__string">"${escaped}"</span>`;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return `<span class="ds-json-viewer__bracket">[]</span>`;
      const items = value.map((v) => this._format(v, depth + 1)).join(', ');
      return `<span class="ds-json-viewer__bracket">[</span>\n${'  '.repeat(depth + 1)}${items}\n${'  '.repeat(depth)}<span class="ds-json-viewer__bracket">]</span>`;
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return `<span class="ds-json-viewer__bracket">{}</span>`;
      const entries = keys.map((k) => {
        const val = this._format(value[k], depth + 1);
        return `${'  '.repeat(depth + 1)}<span class="ds-json-viewer__key">"${k}"</span>: ${val}`;
      }).join(',\n');
      return `<span class="ds-json-viewer__bracket">{</span>\n${entries}\n${'  '.repeat(depth)}<span class="ds-json-viewer__bracket">}</span>`;
    }

    return String(value);
  }
}
