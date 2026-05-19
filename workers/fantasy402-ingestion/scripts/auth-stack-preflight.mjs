#!/usr/bin/env bun
/**
 * Preflight checks for unattended ingest: proxy up, auth health, optional refresh.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readTokenFile } from "./browser-auth-utils.mjs";
import { shouldRefreshAuth } from "./automation-policy.mjs";
import {
  fetchAuthHealth,
  isLocalIngestProxyUrl,
  localProxyBaseUrl,
  requireOperatorTokenUnlessProxy,
  resolveWorkerApiOrigin,
} from "./proxy-client-utils.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runAuthStackPreflight(options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const workerOrigin = options.workerOrigin ?? process.env.WORKER_ORIGIN ?? localProxyBaseUrl();
  const operatorToken =
    options.operatorToken ?? process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN ?? readTokenFile();
  const proxyMode = isLocalIngestProxyUrl(workerOrigin);
  const apiOrigin = resolveWorkerApiOrigin(workerOrigin);
  const findings = [];

  requireOperatorTokenUnlessProxy(operatorToken, workerOrigin);

  if (proxyMode) {
    try {
      const discovery = await fetchImpl(`${apiOrigin}/`, { signal: AbortSignal.timeout(5_000) });
      if (!discovery.ok) findings.push(`local proxy GET / returned HTTP ${discovery.status}`);
    } catch (error) {
      findings.push(`local proxy unreachable at ${apiOrigin}: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, proxyMode, apiOrigin, findings, local: null, worker: null };
    }
  }

  let health;
  try {
    health = await fetchAuthHealth(fetchImpl, apiOrigin);
  } catch (error) {
    findings.push(`auth health probe failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, proxyMode, apiOrigin, findings, local: null, worker: null };
  }

  const body = health.body ?? {};
  const local = body.local ?? null;
  const worker = body.worker ?? body;
  const status = body.status ?? (health.httpStatus === 200 ? "ready" : "degraded");
  const reasons = Array.isArray(body.reasons) ? body.reasons : [];

  if (status !== "ready") {
    for (const reason of reasons) findings.push(reason);
    const workerReadiness = worker?.ingestionReadiness;
    if (workerReadiness?.blocker) findings.push(String(workerReadiness.blocker));
    if (local?.jwtStatus === "expired") findings.push("local JWT expired");
    if (local?.jwtStatus === "expiring") findings.push("local JWT expiring soon");
    if (local?.source === "none") findings.push("no local auth files — run auth:refresh-full");
  }

  const autoEnv =
    process.env.F402_AUTO_REFRESH_AUTH === "1" || process.env.F402_AUTO_REFRESH_AUTH === "true";
  const smartRefresh = options.smartRefresh !== false;
  const refreshDecision = shouldRefreshAuth({
    preflight: { ok: status === "ready", status, local },
    local,
    force: options.refresh === true,
    autoOnFailure: autoEnv || smartRefresh,
  });
  const shouldRunRefresh =
    options.refresh === true || autoEnv || (smartRefresh && refreshDecision.run);

  if (shouldRunRefresh && refreshDecision.run && !options.refreshAttempted) {
    console.error("Preflight: auth not ready — running auth:refresh-full…");
    const refresh = spawnSync("npm", ["run", "auth:refresh-full"], {
      cwd: workerRoot,
      stdio: "inherit",
      env: { ...process.env, WORKER_ORIGIN: workerOrigin },
    });
    if (refresh.status !== 0) {
      findings.push("auth:refresh-full exited non-zero");
      return { ok: false, proxyMode, apiOrigin, findings, local, worker, refreshed: false };
    }
    return runAuthStackPreflight({ ...options, refresh: false, refreshAttempted: true });
  }

  return {
    ok: status === "ready",
    proxyMode,
    apiOrigin,
    httpStatus: health.httpStatus,
    status,
    local,
    worker,
    workerProbe: body.workerProbe ?? null,
    findings,
    refreshed: Boolean(options.refreshAttempted),
  };
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const jsonOnly = process.argv.includes("--json");
  const result = await runAuthStackPreflight({ refresh });

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Auth stack preflight: ${result.ok ? "OK" : "FAILED"} (${result.apiOrigin})`);
    if (result.local) console.log("  local:", JSON.stringify(result.local));
    if (result.workerProbe) console.log("  workerProbe:", result.workerProbe);
    if (result.findings.length) {
      console.log("  findings:");
      for (const f of result.findings) console.log(`    - ${f}`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
