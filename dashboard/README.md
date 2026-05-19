# Fantasy402 Dashboard — Design System

Zero-build-step live monitoring dashboard for the Fantasy402 ingestion pipeline. Served via Cloudflare Pages.

## Files

| Path | Purpose |
|------|---------|
| `index.html` | Single entry point. All views, templates, and app wiring. |
| `css/design-system.css` | Tokens (`:root`), reset, grid utilities, layout, theme, animations, print styles. |
| `css/components/*.css` | 21 independent BEM component files (badge, button, card, chart, etc.). |
| `js/utils.js` | Formatters, Exporter, LazyLoader, ModalFactory, AutoRefreshManager. |
| `js/design-system.js` | ComponentFactory (card/table/badge descriptor helpers). |
| `js/api-client.js` | Fetch wrapper with TTL cache, dedup, mock mode. |
| `js/websocket-client.js` | SSE client with exponential backoff + polling fallback. |
| `js/store.js` | TTL-cached data store with event emitter. |

## Usage

Open `index.html` in a browser or deploy via `wrangler pages publish`.

### Theme

Toggle dark/light via the theme button in the header. Persisted to `localStorage`.

### Components

```html
<button class="ds-btn">Default</button>
<button class="ds-btn ds-btn--danger">Danger</button>

<span class="ds-badge ds-badge--info">Info</span>

<div class="ds-card">
  <div class="ds-card__label">Label</div>
  <div class="ds-card__value">42</div>
</div>

<div data-tooltip="Tooltip text">Hover me</div>
```

## Naming Convention

BEM — `block__element--modifier`. See `DESIGN.md` for full system architecture.
