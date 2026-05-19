// dashboard/js/chart-wrapper.js
// Lightweight Chart.js wrapper with theme-aware defaults and deferred rendering for hidden canvases.

const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';

async function ensureChartJs() {
  if (typeof window !== 'undefined' && window.Chart) return window.Chart;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHART_CDN;
    script.onload = () => resolve(window.Chart);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function getThemeColors() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    text: isLight ? '#212529' : '#e0e0e0',
    grid: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
    tooltipBg: isLight ? '#ffffff' : '#1a1a2e',
    tooltipText: isLight ? '#212529' : '#e0e0e0',
  };
}

export class ChartWrapper {
  constructor(canvasId, type = 'line', data = {}, options = {}) {
    this.canvasId = canvasId;
    this.type = type;
    this.data = data;
    this.options = options;
    this.chart = null;
    this._deferred = false;
    this._pendingData = null;
  }

  async render(data) {
    const Chart = await ensureChartJs();
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) throw new Error(`Canvas #${this.canvasId} not found`);
    if (data) this.data = data;

    // Destroy previous instance
    if (this.chart) { this.chart.destroy(); this.chart = null; }

    // Check visibility — canvas or any parent may be display:none
    if (canvas.offsetParent === null && !canvas.hasAttribute('data-chart-force')) {
      this._deferred = true;
      return;
    }
    this._deferred = false;

    // Set explicit pixel dimensions before Chart.js init
    // Chart.js needs non-zero width/height at creation time for proper sizing
    const htmlW = parseInt(canvas.getAttribute('width'));
    const htmlH = parseInt(canvas.getAttribute('height'));
    const pw = canvas.parentElement?.clientWidth || htmlW || 800;
    const ph = canvas.parentElement?.clientHeight || htmlH || 400;
    canvas.width = pw * 2;
    canvas.height = ph * 2;

    const theme = getThemeColors();
    const defaults = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: {
          labels: { color: theme.text, font: { family: "'JetBrains Mono', monospace", size: 11 } },
        },
        tooltip: {
          backgroundColor: theme.tooltipBg,
          titleColor: theme.tooltipText,
          bodyColor: theme.tooltipText,
          borderColor: theme.grid,
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: theme.text, font: { family: "'JetBrains Mono', monospace", size: 10 } },
          grid: { color: theme.grid },
        },
        y: {
          ticks: { color: theme.text, font: { family: "'JetBrains Mono', monospace", size: 10 } },
          grid: { color: theme.grid },
        },
      },
    };

    this.chart = new Chart(canvas, {
      type: this.type,
      data: this._pendingData || this.data,
      options: { ...defaults, ...this.options },
    });
    this._pendingData = null;

    if (this.chart) this.chart.resize();
    return this.chart;
  }

  update(data) {
    if (!this.chart) {
      this._pendingData = data;
      return;
    }
    this.data = data;
    this.chart.data = data;
    this.chart.update('none');
  }

  resize() {
    if (this.chart) this.chart.resize();
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    this._deferred = false;
    this._pendingData = null;
  }
}
