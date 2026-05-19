// dashboard/js/chart-wrapper.js
// Lightweight Chart.js wrapper with theme-aware defaults.
// Loads Chart.js from CDN if not already present.

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
  }

  async render() {
    const Chart = await ensureChartJs();
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) throw new Error(`Canvas #${this.canvasId} not found`);
    if (this.chart) this.chart.destroy();

    const theme = getThemeColors();
    const defaults = {
      responsive: true,
      maintainAspectRatio: false,
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
      data: this.data,
      options: { ...defaults, ...this.options },
    });
    return this.chart;
  }

  update(data) {
    if (!this.chart) return;
    this.chart.data = data;
    this.chart.update('none');
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}
