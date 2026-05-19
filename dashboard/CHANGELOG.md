# Changelog

## v3.0.0 — Design System Enhancement

### Added
- Mobile responsive media queries for modal, table, toast, ticker
- `--space-xl` (32px) and `--text-md` (16px) design tokens
- `ds-empty-state` component with icon, message, action
- Print styles (`@media print`) hiding overlays, forcing light backgrounds
- Streaming JSON export (`Exporter.jsonStream()`) via `ReadableStream`
- Tooltip positioning variants: `[data-tooltip-bottom]`, `[data-tooltip-left]`, `[data-tooltip-right]`
- `:focus-visible` styles for `.ds-dropzone`

### Changed
- BEM naming standardized across button, badge, conn-status, tabs (old names kept as aliases)
- Dropzone transition scoped to `border-color` and `background` only (performance)
- ModalFactory sets `aria-hidden` on background content for screen reader isolation
- Focus trap re-focuses first element if the focused element is removed from DOM

### Fixed
- Undefined `--space-xl` and `--text-md` tokens resolved in `:root`
- ModalFactory `_cssLoaded()` test element now cleaned up in error paths
