# Design system tokens

Canonical tokens live in [`css/design-system.css`](css/design-system.css) on `:root`. Legacy aliases (`--bg`, `--green`, …) map to canonical names for backward compatibility.

## Color

| Token | Role |
|-------|------|
| `--primary-bg` | Page background |
| `--secondary-bg` | Cards, panels |
| `--tertiary-bg` | Nested surfaces |
| `--elevated-bg` | Emphasized cards (stat cards) |
| `--surface` | Banners, mixed surfaces |
| `--primary-text` / `--secondary-text` / `--tertiary-text` | Text hierarchy |
| `--border-ds` | Borders |
| `--hover-bg` | Hover states |
| `--success` / `--warning` / `--error` / `--info` / `--accent` / `--purple` | Semantic colors |

## Chart

| Token | Role |
|-------|------|
| `--chart-grid` | Axis grid lines (read by `ChartWrapper`) |
| `--chart-fill-alpha` | Area/line fill opacity (`chartFillColor()` in JS) |

## Layout

| Token | Default |
|-------|---------|
| `--space-xs` … `--space-xl` | 4–32px |
| `--sidebar-width` | 220px |
| `--sidebar-width-collapsed` | 56px |
| `--radius-sm` / `--md` / `--lg` / `--full` | 2 / 4 / 8 / 999px |

## Elevation

| Token | Use |
|-------|-----|
| `--shadow-sm` | Cards |
| `--shadow-md` | Stat card hover, elevated panels |
| `--shadow-lg` | Modals (future) |

## Focus

| Token | Use |
|-------|-----|
| `--focus-ring` | `outline` color |
| `--focus-ring-offset` | `outline-offset` |

## Z-index

`--z-toast` (1000) → `--z-tooltip` (5000). See comment block in `design-system.css`.

## JS helpers

| Function | Module |
|----------|--------|
| `readDesignToken(name, fallback)` | `design-system.js` |
| `getChartColors()` | `constants.js` |
| `chartFillColor(hex)` | `design-system.js` |
| `renderEmptyState({ icon, message, hint })` | `design-system.js` |
| `renderChartLegend(items)` | `design-system.js` |

Theme changes dispatch `f402-theme-change` on `<html>` (`theme.js`).
