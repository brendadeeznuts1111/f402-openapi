// dashboard/js/utils.js
// Formatters, exporter, lazy loader, modal factory, auto-refresh manager.
// ESM exports (loaded via <script type="module"> import).
// Backward-compat globals set on window for the existing inline <script>.

// ── DateFormatter ──
export const DateFormatter = {
  _plural(n, singular, plural) {
    return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
  },

  relative(iso) {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    // Strategy: Math.floor — "2 hours ago" means at least 2 full hours have passed.
    // This avoids the confusion of "1 hour ago" when 89 minutes have elapsed.
    const s = Math.floor(ms / 1000);

    // Past
    if (s >= 0) {
      if (s < 60) return "Just now";
      if (s < 3600) return `${this._plural(Math.floor(s / 60), "minute", "minutes")} ago`;
      if (s < 86400) return `${this._plural(Math.floor(s / 3600), "hour", "hours")} ago`;
      return `${this._plural(Math.floor(s / 86400), "day", "days")} ago`;
    }

    // Future
    const absS = Math.abs(s);
    if (absS < 60) return `in ${this._plural(absS, "second", "seconds")}`;
    if (absS < 3600) return `in ${this._plural(Math.floor(absS / 60), "minute", "minutes")}`;
    if (absS < 86400) return `in ${this._plural(Math.floor(absS / 3600), "hour", "hours")}`;
    return `in ${this._plural(Math.floor(absS / 86400), "day", "days")}`;
  },

  format(iso, opts = {}) {
    if (!iso) return "-";
    const d = new Date(iso);
    const { date = true, time = true } = opts;
    const parts = [];
    if (date) parts.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
    if (time) parts.push(d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
    return parts.join(" ");
  },
};

// ── NumberFormatter ──
export const NumberFormatter = {
  currency(n, currency = "USD") {
    if (n == null) return "-";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  percentage(n, decimals = 1) {
    if (n == null) return "-";
    const sign = n < 0 ? "-" : "";
    return sign + Math.abs(n).toFixed(decimals) + "%";
  },

  compact(n) {
    if (n == null) return "-";
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toLocaleString("en-US");
  },
};

// ── Exporter ──
export const Exporter = {
  csv(rows, filename = "export.csv") {
    if (!rows?.length) return;

    // Flatten nested objects with dot notation (e.g. {user: {name: "x"}} → {"user.name": "x"})
    const flatten = (obj, prefix = "") => {
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
          Object.assign(result, flatten(v, key));
        } else {
          result[key] = v;
        }
      }
      return result;
    };

    const flatRows = rows.map(flatten);
    const headers = Object.keys(flatRows[0]);

    const escape = (v) => {
      const s = v == null ? "" : String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const lines = [headers.join(",")];
    for (const row of flatRows) {
      lines.push(headers.map((h) => escape(row[h])).join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  json(data, filename = "export.json") {
    const seen = new WeakSet();
    const replacer = (_key, value) => {
      if (value !== null && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    };
    const blob = new Blob([JSON.stringify(data, replacer, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

// ── LazyLoader ──
export const LazyLoader = {
  _observer: null,
  _handlers: new WeakMap(),

  _getObserver() {
    if (!this._observer) {
      this._observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const handler = this._handlers.get(entry.target);
              if (handler) {
                handler(entry.target);
                this.unobserve(entry.target);
              }
            }
          }
        },
        { rootMargin: "100px" }
      );
    }
    return this._observer;
  },

  observe(el, callback) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    this._handlers.set(el, callback);
    this._getObserver().observe(el);
  },

  unobserve(el) {
    if (typeof el === "string") el = document.getElementById(el);
    if (!el) return;
    this._handlers.delete(el);
    this._getObserver().unobserve(el);
  },

  disconnect() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    // WeakMap clears automatically when elements are GC'd;
    // no explicit clear() needed.
  },
};

// ── AutoRefreshManager ──
export const AutoRefreshManager = {
  _timers: new Map(),

  register(name, fn, intervalMs) {
    this.unregister(name);
    const timer = setInterval(fn, intervalMs);
    this._timers.set(name, timer);
    return timer;
  },

  unregister(name) {
    const timer = this._timers.get(name);
    if (timer) {
      clearInterval(timer);
      this._timers.delete(name);
    }
  },

  pause() {
    for (const [name, timer] of this._timers) {
      clearInterval(timer);
      this._timers.set(name, null);
    }
  },

  resume() {
    for (const [name, timer] of this._timers) {
      if (timer === null) {
        // Re-register will be done by the caller; we just clear the null marker
        this._timers.delete(name);
      }
    }
  },

  clear() {
    for (const timer of this._timers.values()) {
      if (timer) clearInterval(timer);
    }
    this._timers.clear();
  },

  list() {
    return Array.from(this._timers.keys());
  },
};

// ── ModalFactory ──
export const ModalFactory = {
  _activeModal: null,
  _lastFocus: null,
  _focusableSelector:
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',

  create(id, options = {}) {
    const { title = "", body = "", onClose, buttons = [] } = options;

    const modal = document.createElement("div");
    modal.className = "ds-modal";
    modal.id = id;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", `${id}-title`);

    const btnHtml = buttons
      .map(
        (b, i) =>
          `<button class="ds-btn ${b.class || ""}" data-index="${i}">${b.label}</button>`
      )
      .join("");

    modal.innerHTML = `
      <div class="ds-modal__backdrop" data-modal-close></div>
      <div class="ds-modal__content">
        <div class="ds-modal__header">
          <span class="ds-modal__title" id="${id}-title">${title}</span>
          <button class="ds-modal__close" data-modal-close aria-label="Close">&times;</button>
        </div>
        <div class="ds-modal__body">${body}</div>
        ${btnHtml ? `<div class="ds-modal__footer">${btnHtml}</div>` : ""}
      </div>
    `;

    // Close handlers
    modal.querySelectorAll("[data-modal-close]").forEach((el) => {
      el.addEventListener("click", () => this.close(id));
    });

    // Button handlers
    buttons.forEach((b, i) => {
      const btn = modal.querySelector(`button[data-index="${i}"]`);
      if (btn && b.onClick) btn.addEventListener("click", b.onClick);
    });

    // Escape to close
    modal._keydown = (e) => {
      if (e.key === "Escape") this.close(id);
      if (e.key === "Tab") this._trapFocus(e, modal);
    };

    document.body.appendChild(modal);
    return modal;
  },

  open(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    this._lastFocus = document.activeElement;
    modal.classList.add("ds-modal--open");
    document.body.classList.add("ds-modal-open");
    document.addEventListener("keydown", modal._keydown);
    this._activeModal = modal;

    // Focus first focusable element, or modal container as fallback
    const focusable = modal.querySelectorAll(this._focusableSelector);
    if (focusable.length) {
      focusable[0].focus();
    } else {
      modal.setAttribute("tabindex", "-1");
      modal.focus();
    }
  },

  close(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("ds-modal--open");
    document.body.classList.remove("ds-modal-open");
    document.removeEventListener("keydown", modal._keydown);
    // Clean up fallback tabindex if we added it
    if (modal.hasAttribute("tabindex") && modal.getAttribute("tabindex") === "-1") {
      modal.removeAttribute("tabindex");
    }
    this._activeModal = null;
    if (this._lastFocus) this._lastFocus.focus();
  },

  _trapFocus(e, modal) {
    // Re-query DOM on every Tab keypress to handle dynamically injected content
    // (e.g., modal body that loads async data after open).
    // Alternative: MutationObserver would fire on every DOM change; re-querying
    // on Tab is cheaper since we only need focusable elements when the user tabs.
    const focusable = Array.from(modal.querySelectorAll(this._focusableSelector));
    if (!focusable.length) {
      // No focusable children — keep focus on modal container
      e.preventDefault();
      modal.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  },

  destroy(id) {
    this.close(id);
    const modal = document.getElementById(id);
    if (modal) modal.remove();
  },
};

// Backward-compat globals for the existing inline <script> in index.html
// Remove once index.html migrates to <script type="module">
if (typeof window !== 'undefined') {
  window.DateFormatter = DateFormatter;
  window.NumberFormatter = NumberFormatter;
  window.Exporter = Exporter;
  window.LazyLoader = LazyLoader;
  window.AutoRefreshManager = AutoRefreshManager;
  window.ModalFactory = ModalFactory;
}
