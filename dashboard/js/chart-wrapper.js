// Chart.js wrapper — fixed plot frame, no resize feedback loops

const CHART_VENDOR = 'vendor/chart.umd.min.js';
const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';

const RADIAL_TYPES = new Set(['doughnut', 'pie', 'polarArea']);

let chartDefaultsApplied = false;

function applyChartDefaults(Chart) {
  if (chartDefaultsApplied) return;
  chartDefaultsApplied = true;
  Chart.defaults.animation = false;
  Chart.defaults.animations = {
    colors: false,
    x: false,
    y: false,
  };
  Chart.defaults.transitions = {
    active: { animation: { duration: 0 } },
    resize: { animation: { duration: 0 } },
    show: { animation: { duration: 0 } },
    hide: { animation: { duration: 0 } },
  };
  Chart.defaults.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
}

async function ensureChartJs() {
  if (typeof window !== 'undefined' && window.Chart) {
    applyChartDefaults(window.Chart);
    return window.Chart;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let triedCdn = false;

    const onLoad = () => {
      applyChartDefaults(window.Chart);
      resolve(window.Chart);
    };

    const onError = () => {
      if (!triedCdn) {
        triedCdn = true;
        script.src = CHART_CDN;
        return;
      }
      reject(new Error('Chart.js failed to load (vendor and CDN)'));
    };

    script.onload = onLoad;
    script.onerror = onError;
    script.src = CHART_VENDOR;
    document.head.appendChild(script);
  });
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function getThemeColors() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const pick = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const isLight = root.getAttribute('data-theme') === 'light';
  return {
    text: pick('--primary-text', isLight ? '#212529' : '#FFFFFF'),
    grid: pick('--chart-grid', isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'),
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
  return canvas.closest('.ds-chart-plot');
}

/** Chart.js sizes to the canvas parent — fixed inner frame keeps canvas out of document flow. */
function ensurePlotFrame(canvas) {
  if (canvas.parentElement?.classList.contains('ds-chart-plot__frame')) {
    return canvas.parentElement;
  }
  const plot = getPlotElement(canvas);
  if (!plot) return canvas.parentElement;

  const frame = document.createElement('div');
  frame.className = 'ds-chart-plot__frame';
  plot.appendChild(frame);
  frame.appendChild(canvas);
  return frame;
}

function resetCanvasElement(canvas) {
  canvas.classList.add('ds-chart-canvas');
  canvas.removeAttribute('width');
  canvas.removeAttribute('height');
  canvas.style.width = '';
  canvas.style.height = '';
  canvas.style.maxWidth = '';
  canvas.style.maxHeight = '';
  canvas.style.boxSizing = 'border-box';
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

  get hasChart() {
    return Boolean(this.chart);
  }

  _buildOptions(theme) {
    const isRadial = RADIAL_TYPES.has(this.type);
    const noMotion = prefersReducedMotion();
    const base = {
      responsive: true,
      maintainAspectRatio: isRadial,
      animation: false,
      animations: noMotion ? false : { colors: false, x: false, y: false },
      transitions: {
        active: { animation: { duration: 0 } },
        resize: { animation: { duration: 0 } },
      },
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
      base.interaction = { mode: 'nearest', intersect: false };
      base.elements = { point: { radius: 0, hoverRadius: 4 }, line: { borderWidth: 2 } };
      base.datasets = {
        line: { tension: 0.25 },
      };
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

  async render(data, { force = false } = {}) {
    if (data) this.data = data;

    let canvas = document.getElementById(this.canvasId);
    if (!canvas) {
      throw new Error(`Canvas #${this.canvasId} not found — call ensureChartMarkup() first`);
    }

    const plot = getPlotElement(canvas);
    if (!isElementVisible(plot || canvas) && !canvas.hasAttribute('data-chart-force')) {
      this._deferred = true;
      if (data) this._pendingData = data;
      return;
    }
    this._deferred = false;

    if (this.chart && !force) {
      return this.update(this._pendingData || this.data);
    }

    await ensureChartJs();
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    const frame = ensurePlotFrame(canvas);
    resetCanvasElement(canvas);
    canvas.style.display = 'block';
    if (frame) {
      frame.style.display = 'block';
    }

    const theme = getThemeColors();
    this.chart = new window.Chart(canvas, {
      type: this.type,
      data: this._pendingData || this.data,
      options: this._buildOptions(theme),
    });
    this._pendingData = null;
    return this.chart;
  }

  update(data) {
    if (data) this.data = data;
    const payload = data || this.data;
    if (!payload) return;

    if (!this.chart) {
      this._pendingData = payload;
      return;
    }

    this.chart.data = payload;
    this.chart.update('none');
  }

  resize() {
    if (!this.chart) return;
    const canvas = document.getElementById(this.canvasId);
    if (canvas) resetCanvasElement(canvas);
    this.chart.resize();
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    const canvas = document.getElementById(this.canvasId);
    if (canvas) resetCanvasElement(canvas);
    this._deferred = false;
    this._pendingData = null;
  }
}
