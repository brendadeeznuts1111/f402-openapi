#!/usr/bin/env bun
/**
 * Local reverse proxy: injects INGESTION_TRIGGER_TOKEN for Worker ingest routes.
 * CLI can set WORKER_ORIGIN=http://127.0.0.1:8791 without passing Bearer to children.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(scriptDir, "..");
const defaultOrigin = "https://fantasy402-ingestion.utahj4754.workers.dev";
/** Real Worker URL (not the local proxy). CLI sets WORKER_ORIGIN to this proxy separately. */
const targetOrigin = new URL(
  process.env.FANTASY402_WORKER_UPSTREAM ?? process.env.INGEST_PROXY_UPSTREAM ?? defaultOrigin,
);
const port = Number(process.env.LOCAL_INGEST_PROXY_PORT ?? 8791);
const hostname = process.env.LOCAL_INGEST_PROXY_HOST ?? "127.0.0.1";
const jwtStaleBufferSec = Number(process.env.AUTH_HEALTH_JWT_BUFFER_SEC ?? 300);

const PROXY_PREFIXES = [
  "/ingest/",
  "/ingestion/",
  "/refresh-auth",
  "/diagnostics",
  "/update-cookies",
  "/upstream-cookies-status",
];

const PROXY_EXACT = new Set(["/ingest/sync"]);

function readOperatorToken(): string {
  const fromEnv = process.env.INGESTION_TRIGGER_TOKEN || process.env.ARCHIVE_AUTH_TOKEN;
  if (fromEnv?.trim()) return fromEnv.trim();
  const tokenPath = process.env.ARCHIVE_AUTH_TOKEN_FILE || path.join(workerRoot, ".archive-auth-token");
  try {
    return fs.readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

const proxyDebug = process.env.F402_PROXY_DEBUG === "1" || process.env.F402_PROXY_DEBUG === "true";

const operatorToken = readOperatorToken();
if (!operatorToken) {
  console.error("Missing INGESTION_TRIGGER_TOKEN or .archive-auth-token — proxy cannot inject auth.");
  process.exit(1);
}

function workerPathname(pathname: string): string {
  const stripped = pathname.replace(/^\/api/, "") || "/";
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

function shouldProxy(pathname: string): boolean {
  const path = workerPathname(pathname);
  if (PROXY_EXACT.has(path)) return true;
  if (path === "/refresh-auth" || path === "/diagnostics" || path === "/update-cookies" || path === "/upstream-cookies-status") {
    return true;
  }
  return PROXY_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix));
}

function jwtMetaFromAuthorization(authorization: string | undefined) {
  const token = String(authorization ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const parts = token.split(".");
  if (parts.length < 2) return { jwtExp: null, jwtTtlSeconds: null, jwtStatus: "unknown" as const };
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { exp?: number };
    if (!decoded.exp) return { jwtExp: null, jwtTtlSeconds: null, jwtStatus: "unknown" as const };
    const jwtTtlSeconds = decoded.exp - Math.floor(Date.now() / 1000);
    const jwtExp = new Date(decoded.exp * 1000).toISOString();
    if (jwtTtlSeconds <= 0) return { jwtExp, jwtTtlSeconds, jwtStatus: "expired" as const };
    if (jwtTtlSeconds <= jwtStaleBufferSec) return { jwtExp, jwtTtlSeconds, jwtStatus: "expiring" as const };
    return { jwtExp, jwtTtlSeconds, jwtStatus: "valid" as const };
  } catch {
    return { jwtExp: null, jwtTtlSeconds: null, jwtStatus: "unknown" as const };
  }
}

function loadLocalAuthState() {
  const stateFile =
    process.env.FANTASY402_AUTH_STATE_FILE || path.join(workerRoot, "fantasy402", ".auth-refresh-state.json");
  const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE || path.join(workerRoot, "fantasy402", "browser-auth.json");

  let local: Record<string, unknown> = { source: "none", message: "No browser-auth.json or .auth-refresh-state.json" };
  try {
    local = { ...(JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>), source: "auth-refresh-state" };
  } catch {
    /* fall through to browser-auth.json */
  }

  if (local.source !== "auth-refresh-state") {
    try {
      const payload = JSON.parse(fs.readFileSync(authFile, "utf8")) as { authorization?: string };
      local = {
        ...jwtMetaFromAuthorization(payload.authorization),
        lastSuccessAt: fs.statSync(authFile).mtime.toISOString(),
        source: "browser-auth.json",
      };
    } catch {
      /* keep none */
    }
  }

  if (local.jwtExp && !local.jwtStatus) {
    const ttl = Math.floor((Date.parse(String(local.jwtExp)) - Date.now()) / 1000);
    local.jwtTtlSeconds = ttl;
    local.jwtStatus = ttl <= 0 ? "expired" : ttl <= jwtStaleBufferSec ? "expiring" : "valid";
  }
  if (!local.jwtExp) {
    try {
      const payload = JSON.parse(fs.readFileSync(authFile, "utf8")) as { authorization?: string };
      Object.assign(local, jwtMetaFromAuthorization(payload.authorization));
    } catch {
      /* ignore */
    }
  }

  return { local, stateFile, authFile };
}

async function localAuthHealth(): Promise<Response> {
  const { local } = loadLocalAuthState();
  const reasons: string[] = [];

  let worker: Record<string, unknown> | null = null;
  let workerProbe: "ok" | "degraded" | "unreachable" = "unreachable";
  try {
    const probe = await fetch(new URL("/auth/health", targetOrigin), {
      signal: AbortSignal.timeout(10_000),
    });
    workerProbe = probe.ok ? "ok" : "degraded";
    worker = (await probe.json()) as Record<string, unknown>;
    if (probe.status === 404) {
      workerProbe = "degraded";
      reasons.push("worker /auth/health not found (deploy Worker with auth-health route)");
    } else if (!probe.ok) {
      const readiness = (worker as { ingestionReadiness?: { status?: string; blocker?: string | null } })
        .ingestionReadiness;
      if (readiness?.status !== "ready") {
        reasons.push(readiness?.blocker ? String(readiness.blocker) : "worker auth not ready");
      }
    }
  } catch (error) {
    worker = {
      status: "degraded",
      message: error instanceof Error ? error.message : String(error),
    };
    reasons.push("worker probe failed");
  }

  const localJwtStatus = String(local.jwtStatus ?? "unknown");
  if (localJwtStatus === "expired") reasons.push("local JWT expired");
  if (localJwtStatus === "expiring") reasons.push(`local JWT expiring within ${jwtStaleBufferSec}s`);
  if (local.source === "none") reasons.push("no local auth files");

  const workerReady =
    workerProbe === "ok" &&
    worker &&
    (worker as { ingestionReadiness?: { status?: string } }).ingestionReadiness?.status === "ready";
  const localOk = localJwtStatus === "valid" || localJwtStatus === "expiring";

  const status = workerReady && localOk ? "ready" : "degraded";
  const httpStatus = status === "ready" ? 200 : 503;

  return jsonResponse(
    {
      status,
      timestamp: new Date().toISOString(),
      local,
      workerProbe,
      worker,
      reasons,
    },
    httpStatus,
  );
}

function discovery(): Response {
  return jsonResponse({
    service: "fantasy402-local-ingest-proxy",
    listen: `http://${hostname}:${port}`,
    upstream: targetOrigin.origin,
    routes: [
      "GET /auth/health",
      "GET|POST /ingest/*",
      "POST /ingestion/*",
      "POST /refresh-auth",
      "POST /ingest/sync",
      "GET /diagnostics",
      "…",
    ],
    cli: {
      WORKER_ORIGIN: `http://${hostname}:${port}`,
      note: "Omit INGESTION_TRIGGER_TOKEN from ingest CLI when using this proxy",
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      ...corsHeaders(),
    },
  });
}

async function proxyToWorker(request: Request, pathname: string): Promise<Response> {
  const path = workerPathname(pathname);
  const url = new URL(request.url);
  const upstreamUrl = new URL(`${path}${url.search}`, targetOrigin);

  const headers = new Headers();
  const contentType = request.headers.get("Content-Type");
  const accept = request.headers.get("Accept");
  if (contentType) headers.set("Content-Type", contentType);
  if (accept) headers.set("Accept", accept);

  const incomingAuth = request.headers.get("Authorization");
  headers.set("Authorization", incomingAuth?.trim() ? incomingAuth : `Bearer ${operatorToken}`);

  const method = request.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  if (proxyDebug) {
    console.error(`[proxy] ${method} ${path} → ${upstream.status}`);
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("Cache-Control", "no-store, max-age=0");
  for (const [key, value] of Object.entries(corsHeaders())) responseHeaders.set(key, value);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return discovery();
    }

    if (url.pathname === "/auth/health" && request.method === "GET") {
      return localAuthHealth();
    }

    if (url.pathname === "/operator/harvest.js" && request.method === "GET") {
      const js = `(() => {
  function cookieVal(name) {
    const p = name + "=";
    for (const part of document.cookie.split(";")) {
      const t = part.trim();
      if (t.startsWith(p)) return t.slice(p.length);
    }
    return "";
  }
  let jwt = "";
  try {
    const raw = sessionStorage.getItem("credentials");
    if (raw) {
      const cred = JSON.parse(raw);
      if (cred && cred.code) jwt = String(cred.code).trim();
    }
  } catch {}
  if (!jwt) {
    alert("Fantasy402 harvest: no JWT in sessionStorage — log in on manager.html first");
    return;
  }
  const payload = {
    authorization: jwt.startsWith("Bearer ") ? jwt : "Bearer " + jwt,
    cfClearance: cookieVal("cf_clearance"),
    cfBm: cookieVal("__cf_bm"),
    customerId: sessionStorage.getItem("customerID") || "",
    userAgent: navigator.userAgent,
    referer: location.href,
  };
  fetch("${`http://${hostname}:${port}`}/refresh-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((body) => alert("Worker refresh-auth: " + JSON.stringify(body)))
    .catch((e) => alert("Harvest failed: " + e.message));
})();`;
      return new Response(js, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders(),
        },
      });
    }

    if (shouldProxy(url.pathname)) {
      return proxyToWorker(request, url.pathname);
    }

    return jsonResponse(
      {
        status: "failed",
        message:
          "Unknown path. See GET / for routes. Proxy: /ingest/*, /ingestion/*, /refresh-auth, /ingest/sync, /diagnostics, /update-cookies, /upstream-cookies-status, GET /auth/health",
      },
      404,
    );
  },
});

console.log(`Fantasy402 local ingest proxy: http://${hostname}:${port}/`);
console.log(`Upstream Worker: ${targetOrigin.origin}`);
console.log(`Set WORKER_ORIGIN=http://${hostname}:${port} for ingest CLI (token optional)`);
console.log(`Listening (pid ${process.pid})`);

function shutdown(signal: string) {
  console.log(`\n${signal}: stopping proxy…`);
  server.stop();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { server };
