/**
 * Worker /auth/health and unattended-stack UI helpers (VPS proxy is operator-side only).
 */

export async function fetchWorkerAuthHealth(ctx) {
  try {
    return await ctx.api('/auth/health', { silent: true, acceptStatuses: [200, 503] });
  } catch {
    return null;
  }
}

export function needsAuthRefreshFromAuthHealth(authHealth) {
  if (!authHealth) return false;
  if (authHealth.status === 'degraded') return true;
  const exp = authHealth.authorizationExpiry?.status;
  return exp === 'expired' || exp === 'expiring';
}

export function formatWorkerAuthHealthBadge(authHealth) {
  if (!authHealth) {
    return { label: 'Auth health unknown', className: 'ds-badge--warn', hint: 'Could not load /auth/health' };
  }
  const ready = authHealth.status === 'ready';
  const ttl = authHealth.authorizationExpiry?.ttlSeconds;
  const overlay = authHealth.authCacheOverlay?.active;
  const expStatus = authHealth.authorizationExpiry?.status;
  let label = ready ? 'Worker auth ready' : 'Worker auth blocked';
  if (expStatus === 'expiring' && ttl != null) label = `JWT expiring (${ttl}s)`;
  if (expStatus === 'expired') label = 'Worker JWT expired';
  const className = ready ? 'ds-badge--success' : expStatus === 'expiring' ? 'ds-badge--warn' : 'ds-badge--error';
  const parts = [];
  if (overlay) parts.push('KV overlay active');
  const blocker = authHealth.ingestionReadiness?.blocker;
  if (blocker && !ready) parts.push(blocker);
  return { label, className, hint: parts.join(' · ') || '' };
}

export function formatAuthStackHint(authHealth) {
  if (!authHealth || authHealth.status === 'ready') return '';
  return 'VPS: npm run auth:refresh-full · npm run auth:preflight -- --refresh';
}

export function formatAuthHealthTimelineHtml(authHealth) {
  if (!authHealth) {
    return (
      '<div class="ds-timeline__item"><span class="ds-timeline__dot"></span>' +
      '<div class="ds-timeline__content"><div class="ds-timeline__title">Worker auth health</div>' +
      '<div class="ds-timeline__meta ds-help-text">Could not load /auth/health</div></div></div>'
    );
  }
  const badge = formatWorkerAuthHealthBadge(authHealth);
  const dotClass = authHealth.status === 'ready' ? '' : ' ds-timeline__dot--warn';
  const overlay = authHealth.authCacheOverlay?.active ? 'KV overlay active' : 'no KV overlay';
  const ttl = authHealth.authorizationExpiry?.ttlSeconds;
  const ttlLine = ttl != null ? `${ttl}s JWT TTL` : '';
  const blocker = authHealth.ingestionReadiness?.blocker;
  const meta = [overlay, ttlLine].filter(Boolean).join(' · ');
  const blockerHtml =
    blocker && authHealth.status !== 'ready'
      ? `<div class="ds-timeline__meta ds-help-text">${escapeHtml(blocker)}</div>`
      : '';
  return (
    `<div class="ds-timeline__item"><span class="ds-timeline__dot${dotClass}"></span>` +
    `<div class="ds-timeline__content"><div class="ds-timeline__title">${escapeHtml(badge.label)}</div>` +
    `<div class="ds-timeline__meta">${escapeHtml(meta)}</div>${blockerHtml}</div></div>`
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const VPS_SETUP_COMMANDS = `cd workers/fantasy402-ingestion
cp deploy/systemd/ingestion.env.example .env.auth-stack
# edit INGESTION_TRIGGER_TOKEN, FANTASY402_USERNAME, FANTASY402_PASSWORD
# optional: F402_ALERT_WEBHOOK_URL for failure alerts
npm run dev:ingest-stack
# other terminal:
export WORKER_ORIGIN=http://127.0.0.1:8791
npm run auth:check-stack
npm run auth:refresh-full
npm run ingest:unattended-cycle
npm run auth:monitor`;

export async function copyVpsSetupCommands(ctx) {
  try {
    await navigator.clipboard.writeText(VPS_SETUP_COMMANDS);
    ctx.showAlert('VPS setup commands copied', 'info');
  } catch (e) {
    ctx.showAlert(`Copy failed: ${e.message}`, 'error');
  }
}

export async function probeWorkerAuthHealth(ctx) {
  return fetchWorkerAuthHealth(ctx);
}
