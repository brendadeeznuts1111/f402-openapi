/**
 * Classify where ingestion auth actually lives — avoids duplicate/conflicting automation.
 */
import { isFantasy402Origin } from './manager-console-runner.js';
import { needsAuthRefreshFromAuthHealth } from './auth-stack.js';

export const AUTO_INGEST_BACKOFF_KEY = 'f402-auto-ingest-backoff-until';

/** @returns {'manager-live'|'dashboard-browser'|'worker-kv'|'none'} */
export function classifyAutomationPlane({ authHealth, storedAuth, diagnostics }) {
  if (isFantasy402Origin()) return 'manager-live';

  const workerReady = authHealth?.status === 'ready';
  const overlay = authHealth?.authCacheOverlay?.active === true;
  const diagnosticsReady =
    diagnostics?.upstreamAuthShape?.ingestionReadiness?.status === 'ready';

  if (workerReady && (overlay || diagnosticsReady)) {
    return 'worker-kv';
  }

  if (storedAuth?.authorization) return 'dashboard-browser';
  return 'none';
}

export function readAutoIngestBackoff() {
  try {
    const raw = localStorage.getItem(AUTO_INGEST_BACKOFF_KEY);
    if (!raw) return null;
    const until = Date.parse(raw);
    return Number.isFinite(until) && until > Date.now() ? until : null;
  } catch {
    return null;
  }
}

export function setAutoIngestBackoff(ms = 5 * 60_000) {
  try {
    localStorage.setItem(AUTO_INGEST_BACKOFF_KEY, new Date(Date.now() + ms).toISOString());
  } catch { /* ignore */ }
}

export function clearAutoIngestBackoff() {
  try {
    localStorage.removeItem(AUTO_INGEST_BACKOFF_KEY);
  } catch { /* ignore */ }
}

/**
 * Dashboard should not hammer browser ingest when VPS already holds Worker KV auth.
 */
export function shouldDashboardAutomateIngest({
  plane,
  authDegraded,
  ingestStale,
  catalogPending,
  autoIngest,
  autoSync,
}) {
  if (readAutoIngestBackoff()) {
    return { run: false, reason: 'backoff', plane };
  }

  if (plane === 'worker-kv') {
    if (catalogPending || ingestStale) {
      return {
        run: false,
        reason: 'vps-handles-ingest',
        plane,
        hint: 'Worker KV auth is ready — run ingest on VPS (npm run ingest:unattended-cycle)',
      };
    }
    if (!authDegraded) {
      return { run: false, reason: 'worker-kv-idle', plane };
    }
  }

  if (!autoIngest && !(autoSync && authDegraded)) {
    return { run: false, reason: 'disabled', plane };
  }
  if (autoIngest && !authDegraded && !ingestStale && !catalogPending) {
    return { run: false, reason: 'nothing-to-do', plane };
  }
  return { run: true, reason: 'run', plane };
}

export function formatAutomationPlaneHint(plane) {
  switch (plane) {
    case 'worker-kv':
      return 'Auth on Worker (VPS/KV) — local browser ingest from Pages is not required for auth';
    case 'manager-live':
      return 'On manager.html — live session + renewToken';
    case 'dashboard-browser':
      return 'Browser capture / localStorage — sync to Worker before ingest';
    default:
      return 'Paste a /cloud/api/* capture or run VPS auth:refresh-full';
  }
}

export function isAuthDegradedForAutomation(diagnostics, authHealth) {
  return needsAuthRefreshFromAuthHealth(authHealth)
    || diagnostics?.upstreamAuthShape?.ingestionReadiness?.status !== 'ready';
}
