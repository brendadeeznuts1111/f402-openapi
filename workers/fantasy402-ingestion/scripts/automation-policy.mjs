/**
 * Shared rules for when to refresh auth vs run ingest (VPS timers, preflight, unattended cycle).
 */
import fs from "node:fs";
import path from "node:path";
import { jwtExpiryDiagnostics } from "./browser-auth-utils.mjs";

export function readAutomationPolicy(env = process.env) {
  return {
    jwtRefreshBufferSec: Number(env.F402_JWT_REFRESH_BUFFER_SEC ?? env.AUTH_HEALTH_JWT_BUFFER_SEC ?? 900),
    jwtIngestMinTtlSec: Number(env.F402_JWT_INGEST_MIN_TTL_SEC ?? 120),
    maxIngestLoopsPerCycle: Number(env.F402_MAX_INGEST_LOOPS ?? 8),
    cycleBackoffBaseMs: Number(env.F402_CYCLE_BACKOFF_MS ?? 60_000),
    cycleBackoffMaxMs: Number(env.F402_CYCLE_BACKOFF_MAX_MS ?? 3_600_000),
  };
}

export function loadLocalJwtSummary(authFile) {
  try {
    const payload = JSON.parse(fs.readFileSync(authFile, "utf8"));
    const expiry = jwtExpiryDiagnostics(payload.authorization);
    const ttlSeconds =
      typeof expiry.secondsRemaining === "number" ? expiry.secondsRemaining : null;
    let jwtStatus = expiry.status ?? "unknown";
    if (jwtStatus === "valid" && ttlSeconds != null) {
      const buffer = readAutomationPolicy().jwtRefreshBufferSec;
      if (ttlSeconds <= 0) jwtStatus = "expired";
      else if (ttlSeconds <= buffer) jwtStatus = "expiring";
    }
    return {
      jwtStatus,
      jwtTtlSeconds: ttlSeconds,
      jwtExp: expiry.expiresAt ?? null,
      source: "browser-auth.json",
      mtime: fs.statSync(authFile).mtime.toISOString(),
    };
  } catch {
    return { jwtStatus: "unknown", jwtTtlSeconds: null, jwtExp: null, source: "none" };
  }
}

/**
 * Decide whether headless auth:refresh-full should run.
 * @param {{ preflight?: { ok?: boolean, status?: string, local?: object }, local?: object, force?: boolean, autoOnFailure?: boolean }} input
 */
export function shouldRefreshAuth(input = {}) {
  const policy = readAutomationPolicy();
  const local = input.local ?? input.preflight?.local ?? null;
  const force = input.force === true;
  const autoOnFailure = input.autoOnFailure === true;

  if (force) return { run: true, reason: "forced" };

  if (local?.source === "none" || (local?.jwtStatus === "unknown" && local?.jwtTtlSeconds == null)) {
    return { run: true, reason: "no-local-auth" };
  }
  if (local?.jwtStatus === "expired") return { run: true, reason: "jwt-expired" };
  if (local?.jwtStatus === "expiring") return { run: true, reason: "jwt-expiring" };

  const ttl = local?.jwtTtlSeconds;
  if (typeof ttl === "number" && ttl <= policy.jwtRefreshBufferSec) {
    return { run: true, reason: "proactive-buffer" };
  }

  if (autoOnFailure && input.preflight?.ok === false) {
    return { run: true, reason: "preflight-failed" };
  }

  if (input.preflight?.ok === true) {
    return { run: false, reason: "preflight-ready" };
  }

  return { run: false, reason: "healthy" };
}

/** Ingest is pointless if JWT dies mid-batch. */
export function canRunIngestWithLocalAuth(local, policy = readAutomationPolicy()) {
  if (!local || local.source === "none") return { ok: false, reason: "no-local-auth" };
  if (local.jwtStatus === "expired") return { ok: false, reason: "jwt-expired" };
  const ttl = local.jwtTtlSeconds;
  if (typeof ttl === "number" && ttl < policy.jwtIngestMinTtlSec) {
    return { ok: false, reason: "jwt-too-short-for-batch" };
  }
  return { ok: true, reason: "ok" };
}

export function ingestLoopsFromCatalog(catalog, policy = readAutomationPolicy()) {
  const pending = catalog?.pendingCount ?? 0;
  if (!pending) return 1;
  const batchSize = catalog.batchSize || 12;
  const loops = Math.ceil(pending / batchSize);
  return Math.min(policy.maxIngestLoopsPerCycle, Math.max(1, loops));
}

export function computeCycleBackoffMs(consecutiveFailures, policy = readAutomationPolicy()) {
  if (!consecutiveFailures || consecutiveFailures <= 0) return 0;
  const exp = Math.min(
    policy.cycleBackoffMaxMs,
    policy.cycleBackoffBaseMs * 2 ** Math.min(consecutiveFailures - 1, 6),
  );
  return exp;
}

export async function detectLocalProxy(fetchImpl, origin) {
  try {
    const res = await fetchImpl(`${origin.replace(/\/$/, "")}/`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.service === "fantasy402-local-ingest-proxy";
  } catch {
    return false;
  }
}

export async function resolveDefaultWorkerOrigin(fetchImpl = globalThis.fetch) {
  const fromEnv = process.env.WORKER_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const { localProxyBaseUrl } = await import("./proxy-client-utils.mjs");
  const candidate = localProxyBaseUrl();
  if (await detectLocalProxy(fetchImpl, candidate)) return candidate;
  return (
    process.env.FANTASY402_WORKER_UPSTREAM ??
    "https://fantasy402-ingestion.utahj4754.workers.dev"
  ).replace(/\/$/, "");
}
