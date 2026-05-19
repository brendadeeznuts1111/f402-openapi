// Chart.js wrapper — fixed plot sizing, theme defaults, deferred render for hidden tabs

const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';

const RADIAL_TYPES = new Set(['doughnut', 'pie', 'polarArea']);

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
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const isLight = root.getAttribute('data-theme') === 'light';
  return {
    text: pick('--primary-text', isLight ? '#212529' : '#FFFFFF'),
    grid: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
    tooltipBg: pick('--secondary-bg', isLight ? '#ffffff' : '#141414'),
    tooltipText: pick('--primary-text', isLight ? '#212529' : '#FFFFFF'),
  };
}

function isElementVisible(el) {
  if (!el) return false;
  if (el.offsetParent !== null) return true;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function getPlotElement(canvas) {
  return canvas.closest('.ds-chart-plot') || canvas.parentElement;
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
    this._resizeObserver = null;
  }

  _buildOptions(theme) {
    const isRadial = RADIAL_TYPES.has(this.type);
    const base = {
      responsive: true,
      maintainAspectRatio: isRadial,
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
    };

    if (!isRadial) {
      base.maintainAspectRatio = false;
      base.scales = {
        x: {
          ticks: { color: theme.text, font: { family: "'JetBrains Mono', monospace", size: 10 }, maxRotation: 45 },
          grid: { color: theme.grid },
        },
        y: {
          ticks: { color: theme.text, font: { family: "'JetBrains Mono', monospace", size: 10 } },
          grid: { color: theme.grid },
        },
      };
    }

    return { ...base, ...this.options };
  }

  _attachResizeObserver(canvas) {
    const plot = getPlotElement(canvas);
    if (!plot || this._resizeObserver) return;
    this._resizeObserver = new ResizeObserver(() => {
      if (this.chart) this.chart.resize();
    });
    this._resizeObserver.observe(plot);
  }

  _detachResizeObserver() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  async render(data) {
    const Chart = await ensureChartJs();
    const canvas = document.getElementById(this.canvasId);
    if (!canvas) throw new Error(`Canvas #${this.canvasId} not found`);
    if (data) this.data = data;

    const plot = getPlotElement(canvas);
    if (!isElementVisible(plot || canvas) && !canvas.hasAttribute('data-chart-force')) {
      this._deferred = true;
      return;
    }
    this._deferred = false;

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    canvas.classList.add('ds-chart-canvas');
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');
    canvas.style.display = 'block';

    const theme = getThemeColors();
    this.chart = new Chart(canvas, {
      type: this.type,
      data: this._pendingData || this.data,
      options: this._buildOptions(theme),
    });
    this._pendingData = null;

    this._attachResizeObserver(canvas);
    this.chart.resize();
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
    this._detachResizeObserver();
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    this._deferred = false;
    this._pendingData = null;
  }
}
