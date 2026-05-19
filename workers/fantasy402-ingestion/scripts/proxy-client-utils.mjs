/**
 * Helpers for CLI scripts calling the local ingest proxy (Bearer injected server-side).
 */

const DEFAULT_PROXY_PORT = 8791;

export function isLocalIngestProxyUrl(origin) {
  try {
    const url = new URL(origin);
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    const proxyPort = Number(process.env.LOCAL_INGEST_PROXY_PORT || DEFAULT_PROXY_PORT);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    return loopback && (port === proxyPort || url.port === "");
  } catch {
    return false;
  }
}

/** When targeting the local proxy, omit Bearer — the proxy injects it. */
export function workerAuthorizationHeaders(operatorToken, workerOrigin) {
  if (isLocalIngestProxyUrl(workerOrigin)) return {};
  if (!operatorToken?.trim()) return {};
  return { Authorization: `Bearer ${operatorToken.trim()}` };
}

export function requireOperatorTokenUnlessProxy(operatorToken, workerOrigin) {
  if (isLocalIngestProxyUrl(workerOrigin)) return;
  if (!operatorToken?.trim()) {
    throw new Error(
      "Missing INGESTION_TRIGGER_TOKEN or ARCHIVE_AUTH_TOKEN. Set one, use .archive-auth-token, or point WORKER_ORIGIN at the local ingest proxy.",
    );
  }
}

/** Worker URL for refresh-auth when WORKER_ORIGIN points at the local proxy. */
export function resolveUpstreamWorkerOrigin(workerOrigin, fallback) {
  const upstream = process.env.FANTASY402_WORKER_UPSTREAM ?? process.env.INGEST_PROXY_UPSTREAM;
  if (upstream?.trim()) return upstream.replace(/\/$/, "");
  if (isLocalIngestProxyUrl(workerOrigin)) {
    return (fallback ?? "https://fantasy402-ingestion.utahj4754.workers.dev").replace(/\/$/, "");
  }
  return (workerOrigin ?? fallback ?? "").replace(/\/$/, "");
}

export function localProxyBaseUrl() {
  const host = process.env.LOCAL_INGEST_PROXY_HOST ?? "127.0.0.1";
  const port = process.env.LOCAL_INGEST_PROXY_PORT ?? DEFAULT_PROXY_PORT;
  return `http://${host}:${port}`;
}

/** Base URL for operator Worker API calls (proxy or direct). */
export function resolveWorkerApiOrigin(workerOrigin) {
  const raw = workerOrigin ?? process.env.WORKER_ORIGIN ?? "";
  if (raw && isLocalIngestProxyUrl(raw)) return raw.replace(/\/$/, "");
  if (raw) return raw.replace(/\/$/, "");
  return localProxyBaseUrl();
}

export async function callWorkerJson(fetchImpl, workerOrigin, operatorToken, path, options = {}) {
  const origin = typeof workerOrigin === "string" ? workerOrigin : workerOrigin.href ?? String(workerOrigin);
  const headers = {
    ...workerAuthorizationHeaders(operatorToken, origin),
    Accept: "application/json",
  };
  const init = {
    method: options.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetchImpl(new URL(path, origin.endsWith("/") ? origin : `${origin}/`), init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  const expected = options.expectedStatuses ?? [200];
  if (!expected.includes(response.status)) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${String(body?.message || body?.error || text).slice(0, 240)}`,
    );
  }
  return { httpStatus: response.status, body };
}

export async function fetchAuthHealth(fetchImpl, baseUrl) {
  const origin = baseUrl.replace(/\/$/, "");
  const path = isLocalIngestProxyUrl(origin) ? "/auth/health" : "/auth/health";
  const response = await fetchImpl(`${origin}${path}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { httpStatus: response.status, body };
}
