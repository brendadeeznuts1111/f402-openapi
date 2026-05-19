#!/usr/bin/env bun
/**
 * Post-deploy smoke: public auth health + catalog plane summary.
 */
const workerOrigin =
  process.env.FANTASY402_WORKER_UPSTREAM ??
  process.env.WORKER_ORIGIN ??
  "https://fantasy402-ingestion.utahj4754.workers.dev";

async function main() {
  const findings = [];
  const base = workerOrigin.replace(/\/$/, "");

  let auth;
  try {
    const res = await fetch(`${base}/auth/health`, { signal: AbortSignal.timeout(15_000) });
    auth = await res.json();
    if (res.status === 404) findings.push("/auth/health returned 404 — deploy latest Worker");
    else if (auth.status !== "ready") {
      findings.push(`auth not ready: ${auth.ingestionReadiness?.blocker ?? auth.status}`);
    }
  } catch (error) {
    findings.push(`auth/health unreachable: ${error instanceof Error ? error.message : String(error)}`);
    auth = null;
  }

  let catalog = null;
  const token = process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN;
  if (token?.trim()) {
    try {
      const res = await fetch(`${base}/ingest/catalog-status`, {
        headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      catalog = await res.json();
    } catch {
      /* optional */
    }
  }

  const report = {
    workerOrigin: base,
    authHealth: auth,
    catalog: catalog
      ? {
          pendingCount: catalog.pendingCount,
          onlineCount: catalog.onlineCount,
          workerTriggerMode: catalog.workerTriggerMode,
          ingestPlane: catalog.ingestPlane,
        }
      : null,
    findings,
    nextSteps: findings.length
      ? [
          "VPS: npm run auth:refresh-full",
          "VPS: npm run ingest:unattended-cycle",
          "Dashboard: paste capture or Install auto-runner on manager.html",
        ]
      : ["Auth ready — run ingest:unattended-cycle or enable VPS timers"],
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(findings.length ? 1 : 0);
}

main();
