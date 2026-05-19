# Dashboard UI, Charts & Design System Audit

**Date:** 2026-05-18  
**Scope:** `dashboard/` + `docs/dashboard.md`, `dashboard/DESIGN.md`, `dashboard/CHANGELOG.md`, `dashboard/README.md`  
**Version audited:** v3.4.0 (pre-fix baseline); remediations applied in same pass as this report.

---

## Executive summary

Top risks found and addressed:

1. **P0 — Inconsistent hour bucketing** — Overview used `YYYY-MM-DDTHH:00` keys; Analytics traffic used hour-of-day only (`HH:00`), making cross-view comparison misleading. **Fixed:** shared `bucketWagersByHour()` in `utils.js`.
2. **P1 — Dead `chartType` setting** — UI stored line/bar/area but volume chart always rendered as line. **Fixed:** `resolveVolumeChartType()` + settings wiring; `area` maps to line + fill.
3. **P1 — Theme/color split** — Chart axes read CSS variables; datasets used static hex in `constants.js`. **Fixed:** `getChartColors()` reads tokens at render time.
4. **P1 — Latency chart DOM churn** — `renderLatencyChart` destroyed registry and replaced wrap `innerHTML`, fighting `chart-dom.js`. **Fixed:** `showChartMessage` / `ensureChartMarkup` only.
5. **P2 — Doc/code drift** — CHANGELOG claimed `ResizeObserver` before implementation; DESIGN.md said “4 Views” with 5 nav items. **Fixed:** observer implemented; docs updated.

---

## Design system scorecard

| Area | Status | Notes |
|------|--------|-------|
| Token catalog (`design-system.css`) | Pass | Canonical + legacy aliases; added `--radius-*`, `--surface` |
| Light theme overrides | Pass | `[data-theme="light"]` block present; chart colors now runtime from tokens |
| Z-index scale | Pass | `--z-toast` … `--z-tooltip` defined and used |
| BEM `ds-` prefix | Pass | Consistent across components |
| Component CSS (24 files) | Pass | All imported via `dashboard.css` |
| Orphan CSS | Minor | `.ds-chart-legend` unused; `modal.css` used by `ModalFactory` in `utils.js` only |
| Orphan markup | None critical | Tooltip component unused in HTML/JS |
| JS color source | Fixed | `getChartColors()` replaces static-only `CHART_COLORS` for renders |

### Component coverage (summary)

| Component | HTML | JS views | Status |
|-----------|------|----------|--------|
| chart, stat-card, card, tabs | Yes | overview, analytics | Active |
| ticker, timeline, table | Yes | overview, logs, ticker | Active |
| empty-state, error-state, skeleton | Yes | All views | Active |
| config-banner, toast, drawer | Yes | app, ui | Active |
| badge, filters, form | Yes | logs, settings, endpoints | Active |
| json-viewer, dropzone | Yes | analytics, settings | Active |
| modal, tooltip, dropdown | Partial | utils (modal only) | Low use |

### Undefined token issues (resolved)

| Token | Was | Fix |
|-------|-----|-----|
| `--radius-md` | Fallback `4px` in `chart.css` only | Defined on `:root` |
| `--surface` | Used in `config-banner.css` only | Defined as `var(--primary-bg)` |

---

## Charts scorecard

| Chart | Registry | Type | Data | Empty | Error | Theme | Tab | Resize |
|-------|----------|------|------|-------|-------|-------|-----|--------|
| volume | `volume` | line/bar/area* | `/bet-ticker-wagers?limit=100` | Pass | Pass | Pass | N/A | Pass |
| traffic | `traffic` | bar | same | Pass | Pass | Pass | Pass | Pass |
| latency | `latency` | line | `/endpoint-status` → `routeLatency` | Pass | Pass | Pass | Pass | Pass |
| type | `type` | doughnut | wagers (client) | Pass | Pass | Pass | Pass | Pass |
| agent | `agent` | bar | wagers (client) | Pass | Pass | Pass | Pass | Pass |

\*Volume type driven by Settings → Appearance → Chart type (`line` / `bar` / `area`).

### Chart stack (verified)

```
index.html → views/*.js → chart-dom.js → charts.js → chart-wrapper.js → Chart.js 4.4.1 (CDN)
```

### Data correctness

| Topic | Finding | Resolution |
|-------|---------|------------|
| Bucketing | Overview datetime vs Analytics hour-only | Unified `bucketWagersByHour()` |
| Sample size | All wager charts use `limit=100` | Documented; server aggregates recommended P2 |
| `routeLatency` | Worker returns `{ path, endpoint_key, avg_duration_ms, max_duration_ms }` | Dashboard maps `path \|\| endpoint_key` — OK |
| Cent conversion | Volume/agent divide by 100 | Unchanged (cents → dollars) |

### Lifecycle (verified)

- View switch → `destroyAllCharts()`
- Theme / appearance save → `onChartsThemeChange()`
- Hidden tab → deferred `ChartWrapper.render()` until tab visible
- Window resize + sidebar → debounced `resizeAllCharts()`
- Plot resize → `ResizeObserver` on `.ds-chart-plot` (CHANGELOG now accurate)

---

## UI / views scorecard

| View | Module | Status | Notes |
|------|--------|--------|-------|
| Overview | `overview.js` | Pass | Stats, volume chart, ticker, agents, timeline |
| Analytics | `analytics.js` | Pass | 4 charts + JSON; tab lazy render |
| Logs | `logs.js` | Pass | Filters, timelines, tables |
| Settings | `settings.js` | Pass | chartType now affects volume chart |
| Endpoints | `endpoints.js` | Pass | Manifest, ingestion actions |

### Cross-cutting patterns

| Pattern | Before | After |
|---------|--------|-------|
| Chart tabs | `.ds-active` on panels | + ARIA `role="tab"`, `aria-selected`, `tabpanel` |
| Log/settings tabs | Inline `display` | `.ds-active` + ARIA (matches analytics) |
| Empty states | Mixed `innerHTML` / helpers | `showChartMessage` / `showChartError` preferred |
| Error states | Zone-colored `ds-error-state` | Consistent via `renderErrorState` |

---

## Accessibility backlog

| ID | Priority | Issue | WCAG | Status |
|----|----------|-------|------|--------|
| A1 | P1 | Analytics tabs missing full tab pattern | 4.1.2 | **Fixed** (roles, aria-selected, tabpanel) |
| A2 | P2 | Canvas charts weak for screen readers | 1.1.1 | Open — `aria-label` on canvas only |
| A3 | P2 | No keyboard nav between chart tabs | 2.1.1 | Open — add Arrow/Home/End handlers |
| A4 | P2 | No `aria-live` for chart load/error | 4.1.3 | Open |
| A5 | Pass | `prefers-reduced-motion` in ChartWrapper | 2.3.3 | Implemented |
| A6 | Pass | Focus outline on drawer close | 2.4.7 | Present in CSS |

---

## Documentation drift table

| Doc | Claim | Reality (pre-fix) | Action |
|-----|-------|-------------------|--------|
| `CHANGELOG.md` v3.3 | ResizeObserver added | Window resize only | Observer implemented in `charts.js` |
| `DESIGN.md` | “4 Views” | 5 sidebar items | Update diagram to 5 views |
| `docs/dashboard.md` | “Views (v3.2)” table | Missing endpoints emphasis | Align view list |
| `README.md` | Chart markup contract | Accurate | Add `bucketWagersByHour`, `getChartColors` notes |

---

## Remediation backlog (post-audit)

### Completed (Wave A–C)

| ID | Priority | Item | Files |
|----|----------|------|-------|
| R1 | P0 | Unify hour bucketing | `utils.js`, `overview.js`, `analytics.js` |
| R2 | P1 | Wire `chartType` for volume chart | `utils.js`, `overview.js`, `settings.js` |
| R3 | P1 | `saveAppearance` → `onChartsThemeChange` | `settings.js` |
| R4 | P1 | Per-chart errors + CDN message | `analytics.js`, `overview.js`, `chart-wrapper.js` |
| R5 | P1 | Latency empty state without DOM destroy | `analytics.js`, `chart-dom.js` |
| R6 | P1 | Theme-aware dataset colors | `constants.js`, views |
| R7 | P1 | Tab pattern for logs/settings | `ui.js`, `tabs.css` |
| R8 | P1 | ResizeObserver on plots | `charts.js`, `app.js` |
| R9 | P2 | Token gaps (`--radius-md`, `--surface`) | `design-system.css` |

### Remaining (future)

| ID | Priority | Item | Effort |
|----|----------|------|--------|
| R10 | P2 | Server-side chart aggregates (not 100-row client bucket) | L |
| R11 | P2 | Accessible data table fallback per chart | M |
| R12 | P2 | Keyboard handlers for chart tabs | S |
| R13 | P2 | Remove or use `.ds-chart-legend` | S |
| R14 | P2 | Optional vendored Chart.js for air-gapped deploy | M |

---

## Verification checklist

Run locally:

```bash
cd dashboard
npx wrangler pages dev . --binding INGESTION_TRIGGER_TOKEN=your_token
```

| Step | Expected |
|------|----------|
| Overview volume chart loads | Line/area/bar per Settings → Appearance |
| Analytics traffic x-axis | Datetime labels match overview style |
| Analytics latency empty | Message + ingestion hint (no broken canvas) |
| Theme light/dark toggle | Axes + dataset colors update |
| Sidebar collapse | Charts resize (observer + debounce) |
| View switch | No duplicate canvases in DevTools |
| CDN blocked | Error overlay on chart wraps |

---

## Design system enhancements (v3.5.0)

Subsequent pass deepened tokens and primitives:

| Enhancement | Status |
|-------------|--------|
| Expanded semantic tokens (shadow, focus, chart, layout) | Done — `design-system.css`, `TOKENS.md` |
| Theme-aware badges via `color-mix` | Done — `badge.css` |
| Utilities layer | Done — `utilities.css` |
| `renderEmptyState` / `renderChartLegend` JS | Done — `design-system.js` |
| HTML legend for wager types chart | Done — `#typeChartLegend` |
| `aria-live` chart status | Done — `#chartLiveStatus` |
| Chart tab keyboard (Arrow/Home/End) | Done — `ui.js` |
| `f402-theme-change` event | Done — `theme.js` |

Remaining P2: data table fallback per chart, server-side aggregates.

## Related files

- Token reference: `TOKENS.md`
- Audit plan: `.cursor/plans/dashboard_ui_audit_5a1800c1.plan.md` (do not edit)
- Changelog: `CHANGELOG.md` (v3.4.1+ entries)
- Operator doc: `docs/dashboard.md`
