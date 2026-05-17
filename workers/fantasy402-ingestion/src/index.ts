import { diagnoseUrlScanner, submitAndWait, UrlScannerApiError } from "./url-scanner";
import { summarizeHar, type HarNetworkSummary, type HarRequestSummary } from "./har-summary";

export interface Env {
  SESSION_KV: KVNamespace;
  AUTH_CACHE: KVNamespace;
  ANALYTICS_DB: D1Database;
  RAW_ARCHIVE: R2Bucket;
  ENVIRONMENT: string;
  WORKER_NAME: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  FANTASY402_BASE_URL: string;
  FANTASY402_INGESTION_ENDPOINTS: string;
  FANTASY402_USERNAME: string;
  FANTASY402_PASSWORD: string;
  FANTASY402_SESSION_COOKIE?: string;
  FANTASY402_CF_CLEARANCE?: string;
  FANTASY402_CF_BM?: string;
  FANTASY402_AUTHORIZATION?: string;
  FANTASY402_USER_AGENT?: string;
  FANTASY402_REFERER?: string;
  FANTASY402_BROWSER_HEADERS_JSON?: string;
  FANTASY402_AGENT_ID: string;
  FANTASY402_CUSTOMER_ID?: string;
  FANTASY402_ALLOWED_SCAN_HOSTS?: string;
  INGESTION_TRIGGER_TOKEN?: string;
  ARCHIVE_AUTH_TOKEN?: string;
  ALERT_WEBHOOK_URL?: string;
}

interface SecretsStoreBinding {
  get(): Promise<string>;
}

type EndpointKey =
  | "getAgentPerformance"
  | "getAgentBilling"
  | "getEnterTransactions"
  | "getPending"
  | "Pending"
  | "getPlayers"
  | "getAddedInfo"
  | "getCommunicationMessages"
  | "getLineTypes"
  | "getHeriarchy";

interface SessionRecord {
  cookie: string;
  authorization?: string;
  expiresAt: number;
}

interface AuthCacheRecord {
  authorization?: string;
  sessionCookie?: string;
  cfClearance?: string;
  cfBm?: string;
  browserHeadersJson?: string;
  userAgent?: string;
  referer?: string;
  customerId?: string;
  updatedAt: string;
  expiresAt: number;
}

interface AuthMaterial {
  sessionCookie: string;
  authorization?: string;
}

interface EndpointConfig {
  key: EndpointKey;
  path: string;
  contentType?: "form" | "json";
  requiresCustomerId?: boolean;
  buildBody: (env: Env, now: Date) => Record<string, string | number>;
}

interface UpstreamRequestDiagnostics {
  contentType: string;
  bodyKeys: string[];
  hasAuthorization: boolean;
  hasCookie: boolean;
  hasSessionCookie: boolean;
  hasCfClearance: boolean;
  hasCfBm: boolean;
  cookieNames: string[];
  origin: string;
  referer: string;
  userAgent: string;
}

interface ApiResult {
  endpoint: EndpointConfig;
  status: number;
  attempts: number;
  data: unknown;
  r2Key: string;
  r2Etag: string;
  r2Size: number;
  r2StorageClass: string;
  responseHash: string;
  snapshotId: string;
}

interface RunResult {
  runId: string;
  status: "success" | "failed";
  endpointsSucceeded: number;
  endpointsFailed: number;
}

interface LocalIngestItem {
  endpointKey: EndpointKey;
  httpStatus: number;
  data: unknown;
  capturedAt?: string;
}

interface AlertEventInput {
  severity: "info" | "warning" | "critical";
  type: string;
  message: string;
  context?: Record<string, unknown>;
}

const SESSION_KEY = "fantasy402:session";
const AUTH_CACHE_KEY = "fantasy402:auth-overlay";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 4;
const DEFAULT_AUTH_CACHE_TTL_SECONDS = 60 * 60;
const MAX_AUTH_CACHE_TTL_SECONDS = 60 * 60 * 8;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ENDPOINT_ATTEMPTS = 3;
const R2_ARCHIVE_PREFIX = "fantasy402";
const R2_ARCHIVE_STORAGE_CLASS = "InfrequentAccess";

class UpstreamHttpError extends Error {
  readonly retryable: boolean;
  readonly endpoint: EndpointConfig;
  readonly status: number;
  readonly statusText: string;
  readonly responseBody: string;
  readonly responseHeaders: Record<string, string>;
  readonly request: UpstreamRequestDiagnostics;

  constructor(
    endpoint: EndpointConfig,
    status: number,
    statusText: string,
    responseBody: string,
    responseHeaders: Record<string, string>,
    request: UpstreamRequestDiagnostics,
  ) {
    super(`Fantasy402 API error HTTP ${status} on ${endpoint.key}`);
    this.endpoint = endpoint;
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders;
    this.request = request;
    this.retryable = status === 429 || status >= 500;
  }
}

class EndpointAttemptError extends Error {
  readonly attempts: number;
  readonly originalError: unknown;

  constructor(error: unknown, attempts: number) {
    super(errorMessage(error));
    this.attempts = attempts;
    this.originalError = error;
  }
}

const ENDPOINTS: Record<EndpointKey, EndpointConfig> = {
  getAgentPerformance: {
    key: "getAgentPerformance",
    path: "/cloud/api/Manager/getAgentPerformance",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getAgentPerformance" }),
  },
  getAgentBilling: {
    key: "getAgentBilling",
    path: "/cloud/api/Manager/getAgentBilling",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getAgentBilling" }),
  },
  getEnterTransactions: {
    key: "getEnterTransactions",
    path: "/cloud/api/Manager/getEnterTransactions",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getEnterTransactions" }),
  },
  getPending: {
    key: "getPending",
    path: "/cloud/api/Manager/getPending",
    contentType: "json",
    requiresCustomerId: true,
    buildBody: (env, now) => ({
      RRO: 1,
      agentID: env.FANTASY402_AGENT_ID,
      agentOwner: env.FANTASY402_AGENT_ID,
      customerID: required(env.FANTASY402_CUSTOMER_ID, "FANTASY402_CUSTOMER_ID"),
      date: now.toISOString(),
      path: "",
      wagerType: "",
      sort: "",
      typeSort: "",
      week: 0,
    }),
  },
  Pending: {
    key: "Pending",
    path: "/cloud/api/Report/Pending",
    requiresCustomerId: true,
    buildBody: (env, now) =>
      withDateRange(env, now, {
        agentID: env.FANTASY402_AGENT_ID,
        customerID: required(env.FANTASY402_CUSTOMER_ID, "FANTASY402_CUSTOMER_ID"),
        operation: "Pending",
      }),
  },
  getPlayers: {
    key: "getPlayers",
    path: "/cloud/api/Manager/getPlayers",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getPlayers" }),
  },
  getAddedInfo: {
    key: "getAddedInfo",
    path: "/cloud/api/Manager/getAddedInfo",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getAddedInfo" }),
  },
  getCommunicationMessages: {
    key: "getCommunicationMessages",
    path: "/cloud/api/Customer/getCommunicationMessages",
    requiresCustomerId: true,
    buildBody: (env, now) =>
      withDateRange(env, now, {
        agentID: env.FANTASY402_AGENT_ID,
        customerID: required(env.FANTASY402_CUSTOMER_ID, "FANTASY402_CUSTOMER_ID"),
        operation: "getCommunicationMessages",
      }),
  },
  getLineTypes: {
    key: "getLineTypes",
    path: "/cloud/api/Manager/getLineTypes",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getLineTypes" }),
  },
  getHeriarchy: {
    key: "getHeriarchy",
    path: "/cloud/api/Manager/getHeriarchy",
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getHeriarchy" }),
  },
};

const worker = {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const runtimeEnv = await materializeSecretBindings(env);
    if (event.cron === "0 */6 * * *") {
      ctx.waitUntil(runScheduledScan(runtimeEnv));
      return;
    }

    ctx.waitUntil(runIngestion(runtimeEnv));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok", environment: env.ENVIRONMENT }, 200);
    }

    if (url.pathname === "/archive/viewer" && request.method === "GET") {
      return archiveViewer();
    }

    if (url.pathname === "/refresh-auth" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return refreshAuth(request, env);
    }

    if (url.pathname === "/ingest/local" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return ingestLocalResponses(request, env);
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }

      try {
        const result = await runIngestion(await materializeSecretBindings(env));
        return json(result, result.status === "success" ? 202 : 500);
      } catch (error) {
        return json(
          {
            status: "failed",
            message: errorMessage(error),
          },
          500,
        );
      }
    }

    if (url.pathname === "/archive" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listArchiveObjects(url, env);
    }

    if (url.pathname === "/archive/object" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getArchiveObject(url, env);
    }

    if (url.pathname === "/diagnostics" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return diagnostics(await materializeSecretBindings(env));
    }

    if (url.pathname === "/alerts" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listAlertEvents(url, env);
    }

    if (url.pathname === "/alerts/summary" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return summarizeAlertEvents(url, env);
    }

    if (url.pathname === "/alerts/test" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return createSyntheticAlert(request, env);
    }

    if (url.pathname === "/alerts/policy-test" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return createSyntheticPolicyAlert(env);
    }

    if (url.pathname === "/scanner/diagnostics" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      try {
        return json(await diagnoseUrlScanner(await materializeSecretBindings(env)), 200);
      } catch (error) {
        console.error("[URL Scanner] diagnostics secret resolution failed", safeError(error, { subsystem: "cloudflare-url-scanner" }));
        return json(scannerSecretResolutionError(error, env), 200);
      }
    }

    if (url.pathname === "/scans" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return listScanVerdicts(url, env);
    }

    if (url.pathname === "/scans/summary" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return summarizeScanVerdicts(url, env);
    }

    if (url.pathname === "/scans/detail" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanDetail(url, env);
    }

    if (url.pathname === "/scans/screenshot" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanScreenshot(url, env);
    }

    if (url.pathname === "/scans/har" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanHar(url, env);
    }

    if (url.pathname === "/scans/network-summary" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return getScanNetworkSummary(url, env);
    }

    if (url.pathname === "/scans/network-diff" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return diffScanNetworkSummaries(url, env);
    }

    if (url.pathname === "/scans/export" && request.method === "GET") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      return exportScanEvidence(url, env);
    }

    if ((url.pathname === "/scans/trigger" || url.pathname === "/trigger-scan") && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }
      const body = await safeJson(request);
      const targetUrl = typeof body?.url === "string" && body.url.length > 0 ? body.url : "https://fantasy402.com";
      if (!isHttpUrl(targetUrl)) {
        return json({ status: "failed", message: "Invalid URL" }, 400);
      }
      try {
        const result = await runScheduledScan(await materializeSecretBindings(env), targetUrl);
        return json(
          {
            scanId: result.task.uuid,
            url: result.task.url,
            malicious: Boolean(result.verdicts?.overall?.malicious),
            tlsValidDays: result.page?.tlsValidDays ?? null,
          },
          202,
        );
      } catch (error) {
        return json(scanErrorResponse(error), 500);
      }
    }

    return json({ status: "failed", message: "Not Found" }, 404);
  },
};

export default worker;

async function runIngestion(env: Env): Promise<RunResult> {
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const endpointConfigs = selectEndpoints(env);

  await env.ANALYTICS_DB.prepare(
    "INSERT INTO ingestion_runs (id, started_at, status, endpoints_requested) VALUES (?, ?, 'running', ?)",
  )
    .bind(runId, startedAt.toISOString(), endpointConfigs.map((endpoint) => endpoint.key).join(","))
    .run();

  let endpointsSucceeded = 0;
  let endpointsFailed = 0;

  try {
    const sessionCookie = await getOrRefreshSession(env);

    for (const endpoint of endpointConfigs) {
      try {
        const result = await fetchAndArchiveEndpoint(env, runId, endpoint, sessionCookie, new Date());
        await storeSnapshot(env, runId, result);

        if (endpoint.key === "getAgentPerformance") {
          const metric = mapAgentPerformance(result.data, env.FANTASY402_AGENT_ID, result.snapshotId, runId);
          await storeAgentPerformance(env, metric);
        }

        endpointsSucceeded += 1;
      } catch (error) {
        endpointsFailed += 1;
        await storeEndpointFailure(env, runId, endpoint, error);
        console.error("endpoint ingestion failed", safeError(error, { endpoint: endpoint.key, runId }));
      }
    }

    const status = endpointsFailed === 0 ? "success" : "failed";
    await finishRun(env, runId, status, endpointsSucceeded, endpointsFailed, endpointsFailed ? "One or more endpoints failed" : undefined);

    if (status === "failed") {
      await sendFailureAlert(env, {
        severity: "warning",
        type: "ingestion-endpoint-failures",
        message: `Fantasy402 ingestion run ${runId} had ${endpointsFailed} endpoint failure(s).`,
        context: { runId, endpointsSucceeded, endpointsFailed },
      });
    }

    return { runId, status, endpointsSucceeded, endpointsFailed };
  } catch (error) {
    await finishRun(env, runId, "failed", endpointsSucceeded, endpointsFailed, errorMessage(error));
    await sendFailureAlert(env, {
      severity: "critical",
      type: "ingestion-run-failed",
      message: `Fantasy402 ingestion run ${runId} failed: ${errorMessage(error)}`,
      context: { runId, endpointsSucceeded, endpointsFailed },
    });
    throw error;
  }
}

async function ingestLocalResponses(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ status: "failed", message: "Expected JSON body" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ status: "failed", message: "Expected JSON object" }, 400);
  }

  const items = (payload as { results?: unknown }).results;
  if (!Array.isArray(items) || items.length === 0 || items.length > 25) {
    return json({ status: "failed", message: "results must contain 1-25 endpoint response objects" }, 400);
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const endpointKeys: string[] = [];
  await env.ANALYTICS_DB.prepare(
    "INSERT INTO ingestion_runs (id, started_at, status, endpoints_requested) VALUES (?, ?, 'running', ?)",
  )
    .bind(runId, startedAt.toISOString(), "local-upload")
    .run();

  let endpointsSucceeded = 0;
  let endpointsFailed = 0;
  const stored: Array<Record<string, unknown>> = [];

  try {
    for (const rawItem of items) {
      const item = normalizeLocalIngestItem(rawItem);
      if (!item) {
        endpointsFailed += 1;
        continue;
      }
      endpointKeys.push(item.endpointKey);
      const endpoint = ENDPOINTS[item.endpointKey];
      try {
        const result = await archiveLocalIngestItem(env, runId, endpoint, item);
        await storeSnapshot(env, runId, result);
        if (endpoint.key === "getAgentPerformance") {
          await storeAgentPerformance(env, mapAgentPerformance(result.data, env.FANTASY402_AGENT_ID, result.snapshotId, runId));
        }
        endpointsSucceeded += 1;
        stored.push({
          endpointKey: endpoint.key,
          httpStatus: item.httpStatus,
          r2Key: result.r2Key,
          snapshotId: result.snapshotId,
          itemCount: countItems(result.data),
        });
      } catch (error) {
        endpointsFailed += 1;
        console.error("local endpoint ingestion failed", safeError(error, { endpoint: item.endpointKey, runId }));
      }
    }

    const status = endpointsFailed === 0 ? "success" : "failed";
    await env.ANALYTICS_DB.prepare("UPDATE ingestion_runs SET endpoints_requested = ? WHERE id = ?")
      .bind(endpointKeys.join(","), runId)
      .run();
    await finishRun(env, runId, status, endpointsSucceeded, endpointsFailed);
    return json({ runId, status, endpointsSucceeded, endpointsFailed, stored }, status === "success" ? 202 : 500);
  } catch (error) {
    await finishRun(env, runId, "failed", endpointsSucceeded, endpointsFailed, errorMessage(error));
    return json({ status: "failed", message: errorMessage(error), runId }, 500);
  }
}

function normalizeLocalIngestItem(value: unknown): LocalIngestItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const endpointKey = String(record.endpointKey ?? "");
  if (!isEndpointKey(endpointKey)) return null;
  const httpStatus = clampInteger(Number(record.httpStatus ?? 200), 100, 599);
  const capturedAt = typeof record.capturedAt === "string" ? record.capturedAt : undefined;
  const item: LocalIngestItem = {
    endpointKey,
    httpStatus,
    data: record.data,
  };
  if (capturedAt) item.capturedAt = capturedAt;
  return item;
}

async function archiveLocalIngestItem(env: Env, runId: string, endpoint: EndpointConfig, item: LocalIngestItem): Promise<ApiResult> {
  const capturedAt = validDateOrNow(item.capturedAt);
  const data = redactResponse(item.data);
  const serialized = JSON.stringify(data);
  const responseHash = await sha256Hex(serialized);
  const snapshotId = crypto.randomUUID();
  const date = capturedAt.toISOString().slice(0, 10);
  const r2Key = archiveKey(endpoint.key, date, snapshotId);
  const r2Object = await putArchiveObject(env, r2Key, serialized, {
    source: "fantasy402",
    archiveType: "success",
    ingestionMode: "local-browser-upload",
    endpoint: endpoint.key,
    path: endpoint.path,
    runId,
    snapshotId,
    responseHash,
    capturedAt: capturedAt.toISOString(),
    size: String(serialized.length),
  });

  return {
    endpoint,
    status: item.httpStatus,
    attempts: 1,
    data,
    r2Key,
    r2Etag: r2Object.etag,
    r2Size: r2Object.size,
    r2StorageClass: r2Object.storageClass,
    responseHash,
    snapshotId,
  };
}

function validDateOrNow(value: string | undefined): Date {
  if (value) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date();
}

async function runScheduledScan(env: Env, targetUrl = "https://fantasy402.com") {
  try {
    required(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
    console.log("[URL Scanner] Starting scheduled scan", { url: targetUrl });
    const result = await submitAndWait(targetUrl, env, {
      agentReadiness: true,
      screenshots: ["desktop", "mobile"],
    });
    console.log("[URL Scanner] Scan completed", {
      scanId: result.task.uuid,
      url: result.task.url,
      malicious: Boolean(result.verdicts?.overall?.malicious),
      tlsValidDays: result.page?.tlsValidDays ?? null,
    });

    if (result.verdicts?.overall?.malicious) {
      await sendFailureAlert(env, {
        severity: "critical",
        type: "url-scan-malicious",
        message: `URL Scanner malicious verdict for ${result.task.url}. Scan ID: ${result.task.uuid}`,
        context: { scanId: result.task.uuid, url: result.task.url },
      });
    }

    const tlsValidDays = result.page?.tlsValidDays;
    if (typeof tlsValidDays === "number" && tlsValidDays < 7) {
      await sendFailureAlert(env, {
        severity: "warning",
        type: "url-scan-tls-expiring",
        message: `URL Scanner TLS warning for ${result.task.url}: certificate expires in ${tlsValidDays} day(s).`,
        context: { scanId: result.task.uuid, url: result.task.url, tlsValidDays },
      });
    }

    const persistedSummary = await getPersistedNetworkSummary(result.task.uuid, env);
    const networkSummary = persistedSummary?.summary ?? result.networkSummary;
    if (networkSummary) {
      await alertOnNetworkSummary(env, result.task.uuid, result.task.url, networkSummary);
    }

    return result;
  } catch (error) {
    await sendFailureAlert(env, {
      severity: "critical",
      type: "url-scan-failed",
      message: `URL Scanner failed for ${targetUrl}: ${errorMessage(error)}`,
      context: { url: targetUrl },
    });
    throw error;
  }
}

async function alertOnNetworkSummary(env: Env, scanId: string, scannedUrl: string, summary: HarNetworkSummary): Promise<void> {
  const allowedHosts = allowedScanHosts(env, scannedUrl);
  const observedHosts = Object.keys(summary.byHost);
  const unexpectedHosts = observedHosts.filter((host) => !allowedHosts.has(host));
  const thirdPartyHosts = unexpectedHosts.filter((host) => isThirdPartyHost(host, scannedUrl));
  if (unexpectedHosts.length > 0) {
    await sendFailureAlert(env, {
      severity: "warning",
      type: "url-scan-unexpected-hosts",
      message: `URL Scanner observed unexpected host(s) for ${scannedUrl}: ${unexpectedHosts.join(", ")}`,
      context: {
        scanId,
        url: scannedUrl,
        allowedHosts: [...allowedHosts],
        unexpectedHosts,
        observedHosts,
      },
    });
  }

  if (thirdPartyHosts.length > 0) {
    await sendFailureAlert(env, {
      severity: "warning",
      type: "url-scan-new-third-party",
      message: `URL Scanner observed new third-party host(s) for ${scannedUrl}: ${thirdPartyHosts.join(", ")}`,
      context: {
        scanId,
        url: scannedUrl,
        allowedHosts: [...allowedHosts],
        thirdPartyHosts,
        observedHosts,
        hostCounts: Object.fromEntries(thirdPartyHosts.map((host) => [host, summary.byHost[host] ?? 0])),
      },
    });
  }

  if (summary.failedRequests.length > 0) {
    await sendFailureAlert(env, {
      severity: "warning",
      type: "url-scan-failed-requests",
      message: `URL Scanner observed ${summary.failedRequests.length} failed request(s) for ${scannedUrl}. Scan ID: ${scanId}`,
      context: {
        scanId,
        url: scannedUrl,
        failedCount: summary.failedRequests.length,
        failedRequests: summary.failedRequests.slice(0, 10),
      },
    });
  }
}

function isThirdPartyHost(host: string, scannedUrl: string): boolean {
  const normalizedHost = host.toLowerCase();
  const root = firstPartyRoot(scannedUrl);
  if (!root) return true;
  return normalizedHost !== root && !normalizedHost.endsWith(`.${root}`);
}

function firstPartyRoot(scannedUrl: string): string | null {
  try {
    return new URL(scannedUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function allowedScanHosts(env: Env, scannedUrl: string): Set<string> {
  const hosts = new Set(["fantasy402.com", "www.fantasy402.com"]);
  try {
    hosts.add(new URL(scannedUrl).hostname);
  } catch {
    // Ignore invalid scanned URL here; validation happens before scan submission.
  }
  for (const host of (env.FANTASY402_ALLOWED_SCAN_HOSTS ?? "").split(",")) {
    const clean = host.trim().toLowerCase();
    if (/^[a-z0-9.-]{1,253}$/.test(clean)) hosts.add(clean);
  }
  return hosts;
}

async function refreshAuth(request: Request, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ status: "failed", message: "Expected JSON body" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ status: "failed", message: "Expected JSON object" }, 400);
  }

  const body = payload as Record<string, unknown>;
  const record: AuthCacheRecord = {
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + authCacheTtlSeconds(body.expiresInSeconds) * 1000,
  };
  const accepted: string[] = [];

  setAuthCacheString(record, accepted, "authorization", body.authorization, 8192, normalizeAuthorization);
  setAuthCacheString(record, accepted, "sessionCookie", body.sessionCookie, 8192);
  setAuthCacheString(record, accepted, "cfClearance", body.cfClearance, 4096, (value) => normalizeCookieValue("cf_clearance", value));
  setAuthCacheString(record, accepted, "cfBm", body.cfBm, 4096, (value) => normalizeCookieValue("__cf_bm", value));
  setAuthCacheString(record, accepted, "userAgent", body.userAgent, 512);
  setAuthCacheString(record, accepted, "referer", body.referer, 2048);
  setAuthCacheString(record, accepted, "customerId", body.customerId, 128);

  const browserHeadersJson = normalizeBrowserHeadersInput(body.browserHeadersJson ?? body.browserHeaders);
  if (browserHeadersJson) {
    record.browserHeadersJson = browserHeadersJson;
    accepted.push("browserHeadersJson");
  }

  if (accepted.length === 0) {
    return json({ status: "failed", message: "No supported auth fields provided" }, 400);
  }

  const ttl = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000));
  await env.AUTH_CACHE.put(AUTH_CACHE_KEY, JSON.stringify(record), { expirationTtl: ttl });

  return json(
    {
      status: "ok",
      accepted,
      expiresAt: new Date(record.expiresAt).toISOString(),
      ttlSeconds: ttl,
    },
    200,
  );
}

function authCacheTtlSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AUTH_CACHE_TTL_SECONDS;
  return clampInteger(value, 60, MAX_AUTH_CACHE_TTL_SECONDS);
}

function setAuthCacheString(
  record: AuthCacheRecord,
  accepted: string[],
  key: keyof Omit<AuthCacheRecord, "updatedAt" | "expiresAt">,
  value: unknown,
  maxLength: number,
  normalize: (value: string) => string | null = (input) => input.trim(),
): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/.test(trimmed)) return;
  const normalized = normalize(trimmed);
  if (!normalized) return;
  record[key] = normalized;
  accepted.push(key);
}

function normalizeBrowserHeadersInput(value: unknown): string | null {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value.trim().slice(0, 8192);
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value).slice(0, 8192);
  }
  return null;
}

async function getOrRefreshSession(env: Env): Promise<string> {
  const configuredSessionCookie = env.FANTASY402_SESSION_COOKIE;
  const configuredSession = typeof configuredSessionCookie === "string" ? configuredSessionCookie.trim() : "";

  const cachedAuth = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  if (cachedAuth && cachedAuth.expiresAt > Date.now() + 5 * 60_000) {
    applyAuthRecord(env, cachedAuth);
    return cachedAuth.sessionCookie ?? configuredSession;
  }

  if (cachedAuth?.authorization && (cachedAuth.sessionCookie || configuredSession)) {
    applyAuthRecord(env, cachedAuth);
    const renewed = await tryRenewFantasy402Token(env, cachedAuth.sessionCookie ?? configuredSession);
    if (renewed) return renewed.sessionCookie;
  }

  if (normalizeAuthorization(env.FANTASY402_AUTHORIZATION)) {
    return env.FANTASY402_SESSION_COOKIE ?? configuredSession;
  }

  const cached = await env.SESSION_KV.get<SessionRecord>(SESSION_KEY, "json");
  if (cached && cached.expiresAt > Date.now() + 60_000 && (cached.cookie.length > 0 || cached.authorization)) {
    if (cached.authorization) env.FANTASY402_AUTHORIZATION = cached.authorization;
    return cached.cookie;
  }

  const authenticated = await authenticateFantasy402(env);
  await cacheFantasy402Auth(env, authenticated, DEFAULT_SESSION_TTL_SECONDS);
  return authenticated.sessionCookie;
}

async function authenticateFantasy402(env: Env): Promise<AuthMaterial> {
  const form = new URLSearchParams();
  const customerId = env.FANTASY402_USERNAME.toLocaleUpperCase();
  form.set("customerID", customerId);
  form.set("state", "true");
  form.set("password", env.FANTASY402_PASSWORD.toLocaleUpperCase());
  form.set("sufix", "");
  form.set("prefix", "");
  form.set("multiaccount", "1");
  form.set("response_type", "code");
  form.set("client_id", customerId);
  form.set("domain", "fantasy402.com");
  form.set("redirect_uri", "fantasy402.com");
  form.set("operation", "authenticateCustomer");
  form.set("RRO", "1");

  const response = await fetchWithTimeout(`${baseUrl(env)}/cloud/api/System/authenticateCustomer`, {
    method: "POST",
    body: form,
    headers: fantasy402ApiHeaders(env, "", "application/x-www-form-urlencoded; charset=UTF-8"),
  });

  if (!response.ok) {
    throw new Error(`Fantasy402 authenticateCustomer failed with HTTP ${response.status}`);
  }

  const authResponse = await safeReadJson(response);
  const authorization = normalizeAuthorization(extractAuthToken(authResponse));
  const cookie = optionalFirstSetCookie(response.headers);
  if (authorization) env.FANTASY402_AUTHORIZATION = authorization;
  if (!authorization && !cookie) {
    throw new Error("Fantasy402 authenticateCustomer response did not include bearer token or session cookie");
  }

  const session: SessionRecord = {
    cookie: cookie ?? "",
    expiresAt: Date.now() + DEFAULT_SESSION_TTL_SECONDS * 1000,
  };
  if (authorization) session.authorization = authorization;

  await env.SESSION_KV.put(SESSION_KEY, JSON.stringify(session), {
    expirationTtl: DEFAULT_SESSION_TTL_SECONDS,
  });

  const material: AuthMaterial = {
    sessionCookie: session.cookie,
  };
  if (session.authorization) material.authorization = session.authorization;
  return material;
}

async function tryRenewFantasy402Token(env: Env, sessionCookie: string): Promise<AuthMaterial | null> {
  try {
    const response = await fetchWithTimeout(`${baseUrl(env)}/cloud/api/System/renewToken`, {
      method: "POST",
      body: new URLSearchParams(),
      headers: fantasy402ApiHeaders(env, sessionCookie, "application/x-www-form-urlencoded; charset=UTF-8"),
    });
    if (!response.ok) {
      console.warn("[Fantasy402] renewToken failed", { status: response.status });
      return null;
    }
    const authResponse = await safeReadJson(response);
    const authorization = normalizeAuthorization(extractAuthToken(authResponse));
    const cookie = optionalFirstSetCookie(response.headers) ?? sessionCookie;
    if (!authorization && !cookie) return null;
    if (authorization) env.FANTASY402_AUTHORIZATION = authorization;
    if (cookie) env.FANTASY402_SESSION_COOKIE = cookie;
    const renewed: AuthMaterial = { sessionCookie: cookie };
    if (authorization) renewed.authorization = authorization;
    await cacheFantasy402Auth(env, renewed, DEFAULT_SESSION_TTL_SECONDS);
    return renewed;
  } catch (error) {
    console.warn("[Fantasy402] renewToken failed", { message: errorMessage(error) });
    return null;
  }
}

async function cacheFantasy402Auth(env: Env, auth: AuthMaterial, ttlSeconds: number): Promise<void> {
  const record: AuthCacheRecord = {
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  if (auth.authorization) record.authorization = auth.authorization;
  if (auth.sessionCookie) record.sessionCookie = auth.sessionCookie;
  const cfClearance = normalizeCookieValue("cf_clearance", env.FANTASY402_CF_CLEARANCE);
  const cfBm = normalizeCookieValue("__cf_bm", env.FANTASY402_CF_BM);
  if (cfClearance) record.cfClearance = cfClearance;
  if (cfBm) record.cfBm = cfBm;
  if (env.FANTASY402_BROWSER_HEADERS_JSON) record.browserHeadersJson = env.FANTASY402_BROWSER_HEADERS_JSON;
  if (env.FANTASY402_USER_AGENT) record.userAgent = env.FANTASY402_USER_AGENT;
  if (env.FANTASY402_REFERER) record.referer = env.FANTASY402_REFERER;
  if (env.FANTASY402_CUSTOMER_ID) record.customerId = env.FANTASY402_CUSTOMER_ID;
  await env.AUTH_CACHE.put(AUTH_CACHE_KEY, JSON.stringify(record), { expirationTtl: ttlSeconds });
}

function applyAuthRecord(env: Env, record: AuthCacheRecord): void {
  if (record.authorization) env.FANTASY402_AUTHORIZATION = record.authorization;
  if (record.sessionCookie) env.FANTASY402_SESSION_COOKIE = record.sessionCookie;
  if (record.cfClearance) env.FANTASY402_CF_CLEARANCE = record.cfClearance;
  if (record.cfBm) env.FANTASY402_CF_BM = record.cfBm;
  if (record.browserHeadersJson) env.FANTASY402_BROWSER_HEADERS_JSON = record.browserHeadersJson;
  if (record.userAgent) env.FANTASY402_USER_AGENT = record.userAgent;
  if (record.referer) env.FANTASY402_REFERER = record.referer;
  if (record.customerId) env.FANTASY402_CUSTOMER_ID = record.customerId;
}

async function fetchAndArchiveEndpoint(
  env: Env,
  runId: string,
  endpoint: EndpointConfig,
  sessionCookie: string,
  now: Date,
): Promise<ApiResult> {
  const attempted = await withRetries(() => postFantasy402(env, endpoint, sessionCookie, now), MAX_ENDPOINT_ATTEMPTS);
  const data = await attempted.response.json<unknown>();
  const serialized = JSON.stringify(redactResponse(data));
  const responseHash = await sha256Hex(serialized);
  const snapshotId = crypto.randomUUID();
  const date = now.toISOString().slice(0, 10);
  const r2Key = archiveKey(endpoint.key, date, snapshotId);
  const r2Object = await putArchiveObject(env, r2Key, serialized, {
    source: "fantasy402",
    archiveType: "success",
    endpoint: endpoint.key,
    path: endpoint.path,
    runId,
    snapshotId,
    responseHash,
    capturedAt: now.toISOString(),
    size: String(serialized.length),
  });

  console.log("r2 archive write", {
    key: r2Key,
    etag: r2Object.etag,
    size: r2Object.size,
    storageClass: r2Object.storageClass,
  });

  return {
    endpoint,
    status: attempted.response.status,
    attempts: attempted.attempts,
    data,
    r2Key,
    r2Etag: r2Object.etag,
    r2Size: r2Object.size,
    r2StorageClass: r2Object.storageClass,
    responseHash,
    snapshotId,
  };
}

interface AttemptedResponse {
  response: Response;
  attempts: number;
}

async function postFantasy402(env: Env, endpoint: EndpointConfig, sessionCookie: string, now: Date): Promise<Response> {
  const body = endpoint.buildBody(env, now);
  const encodedBody = encodeRequestBody(endpoint, body);
  const headers = fantasy402ApiHeaders(env, sessionCookie, encodedBody.contentType);

  const response = await fetchWithTimeout(`${baseUrl(env)}${endpoint.path}`, {
    method: "POST",
    body: encodedBody.body,
    headers,
  });

  if (!response.ok) {
    throw new UpstreamHttpError(
      endpoint,
      response.status,
      response.statusText,
      await safeReadResponseText(response),
      safeResponseHeaders(response.headers),
      requestDiagnostics(headers, body),
    );
  }

  return response;
}

function fantasy402ApiHeaders(env: Env, sessionCookie: string, contentType: string): Record<string, string> {
  const base = baseUrl(env);
  const headers: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": contentType,
    Cookie: fantasy402CookieHeader(env, sessionCookie),
    Origin: base,
    Referer: env.FANTASY402_REFERER || `${base}/manager.html`,
    "User-Agent": env.FANTASY402_USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    Priority: "u=1, i",
    "Sec-CH-UA": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest",
  };
  applyObservedBrowserHeaders(headers, env.FANTASY402_BROWSER_HEADERS_JSON);
  headers["Content-Type"] = contentType;
  headers.Cookie = fantasy402CookieHeader(env, sessionCookie);
  const authorization = normalizeAuthorization(env.FANTASY402_AUTHORIZATION);
  if (authorization) headers.Authorization = authorization;
  return headers;
}

const OBSERVED_BROWSER_HEADER_NAMES = new Map(
  [
    "accept",
    "accept-language",
    "origin",
    "priority",
    "referer",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent",
    "x-requested-with",
  ].map((name) => [name, canonicalHeaderName(name)]),
);

function applyObservedBrowserHeaders(headers: Record<string, string>, rawJson: string | undefined): void {
  if (typeof rawJson !== "string" || rawJson.trim().length === 0) return;
  const jsonText = rawJson.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error("[Fantasy402] Ignoring invalid FANTASY402_BROWSER_HEADERS_JSON", { message: errorMessage(error) });
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

  for (const [rawName, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawValue !== "string") continue;
    const normalized = rawName.toLowerCase();
    const canonical = OBSERVED_BROWSER_HEADER_NAMES.get(normalized);
    if (!canonical) continue;
    const value = rawValue.trim();
    if (value) headers[canonical] = value.slice(0, 500);
  }
}

function canonicalHeaderName(name: string): string {
  if (name === "sec-ch-ua") return "Sec-CH-UA";
  if (name === "sec-ch-ua-mobile") return "Sec-CH-UA-Mobile";
  if (name === "sec-ch-ua-platform") return "Sec-CH-UA-Platform";
  return name
    .split("-")
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join("-");
}

function fantasy402CookieHeader(env: Env, sessionCookie: string): string {
  const cookies: string[] = [];
  appendCookieHeaderIfMissing(cookies, env.FANTASY402_SESSION_COOKIE);
  appendCookieHeaderIfMissing(cookies, sessionCookie);
  appendCookieIfMissing(cookies, "cf_clearance", env.FANTASY402_CF_CLEARANCE);
  appendCookieIfMissing(cookies, "__cf_bm", env.FANTASY402_CF_BM);
  return cookies.join("; ");
}

function splitCookieHeader(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function appendCookieHeaderIfMissing(cookies: string[], value: string | undefined): void {
  if (typeof value !== "string") return;
  for (const cookie of splitCookieHeader(value)) {
    const name = cookieName(cookie);
    if (!name) continue;
    if (cookies.some((existing) => cookieName(existing)?.toLowerCase() === name.toLowerCase())) continue;
    cookies.push(cookie);
  }
}

function cookieName(cookie: string): string | null {
  const index = cookie.indexOf("=");
  if (index <= 0) return null;
  return cookie.slice(0, index).trim() || null;
}

function appendCookieIfMissing(cookies: string[], name: string, value: string | undefined): void {
  const clean = normalizeCookieValue(name, value);
  if (!clean) return;
  if (cookies.some((cookie) => cookieName(cookie)?.toLowerCase() === name.toLowerCase())) return;
  cookies.push(clean);
}

function normalizeCookieValue(name: string, value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.includes("=") ? trimmed : `${name}=${trimmed}`;
}

function normalizeAuthorization(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function encodeRequestBody(endpoint: EndpointConfig, body: Record<string, string | number>): { body: string | URLSearchParams; contentType: string } {
  if (endpoint.contentType === "json") {
    return {
      body: JSON.stringify(body),
      contentType: "application/json",
    };
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    form.set(key, String(value));
  }
  return {
    body: form,
    contentType: "application/x-www-form-urlencoded",
  };
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 4000);
  } catch (error) {
    return `Unable to read response body: ${errorMessage(error)}`;
  }
}

function safeResponseHeaders(headers: Headers): Record<string, string> {
  const allowed = new Set([
    "cache-control",
    "cf-cache-status",
    "cf-ray",
    "content-length",
    "content-type",
    "date",
    "location",
    "server",
    "vary",
    "www-authenticate",
  ]);
  const safe: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (allowed.has(normalized) || normalized.startsWith("x-")) {
      safe[normalized] = value.slice(0, 500);
    }
  });
  return safe;
}

function requestDiagnostics(headers: Record<string, string>, body: Record<string, string | number>): UpstreamRequestDiagnostics {
  const cookieNames = splitCookieHeader(headers.Cookie ?? "")
    .map((cookie) => cookieName(cookie))
    .filter((name): name is string => Boolean(name));
  const hasCookieName = (name: string) => cookieNames.some((cookie) => cookie.toLowerCase() === name.toLowerCase());
  return {
    contentType: headers["Content-Type"] ?? "",
    bodyKeys: Object.keys(body).sort(),
    hasAuthorization: hasEnvValue(headers.Authorization),
    hasCookie: hasEnvValue(headers.Cookie),
    hasSessionCookie: cookieNames.some((name) => !isCloudflareCookieName(name)),
    hasCfClearance: hasCookieName("cf_clearance"),
    hasCfBm: hasCookieName("__cf_bm"),
    cookieNames,
    origin: headers.Origin ?? "",
    referer: headers.Referer ?? "",
    userAgent: headers["User-Agent"] ?? "",
  };
}

async function withRetries(request: () => Promise<Response>, maxAttempts: number): Promise<AttemptedResponse> {
  let lastError: unknown;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      const response = await request();
      return { response, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryableError(error)) break;
      await sleep(250 * attempt);
    }
  }

  throw new EndpointAttemptError(lastError, attempts);
}

async function storeSnapshot(env: Env, runId: string, result: ApiResult): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO api_snapshots
       (id, run_id, endpoint_key, path, captured_at, http_status, r2_key, response_hash, item_count,
        attempts, r2_etag, r2_size, r2_storage_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      result.snapshotId,
      runId,
      result.endpoint.key,
      result.endpoint.path,
      new Date().toISOString(),
      result.status,
      result.r2Key,
      result.responseHash,
      countItems(result.data),
      result.attempts,
      result.r2Etag,
      result.r2Size,
      result.r2StorageClass,
    )
    .run();
}

async function storeEndpointFailure(env: Env, runId: string, endpoint: EndpointConfig, error: unknown): Promise<void> {
  const failureId = crypto.randomUUID();
  const failedAt = new Date();
  const attempts = error instanceof EndpointAttemptError ? error.attempts : 1;
  const upstreamError = unwrapUpstreamHttpError(error);
  const body = JSON.stringify({
    source: "fantasy402-ingestion-worker",
    archiveType: "failure",
    failureId,
    runId,
    endpoint: endpoint.key,
    path: endpoint.path,
    attempts,
    failedAt: failedAt.toISOString(),
    error: errorMessage(error).slice(0, 1000),
    upstream: upstreamError
      ? {
          status: upstreamError.status,
          statusText: upstreamError.statusText,
          responseHeaders: upstreamError.responseHeaders,
          responseBody: upstreamError.responseBody,
          request: upstreamError.request,
        }
      : null,
  }, null, 2);
  const responseHash = await sha256Hex(body);
  const r2Key = archiveKey(`${endpoint.key}/failures`, failedAt.toISOString().slice(0, 10), failureId);
  const r2Object = await putArchiveObject(env, r2Key, body, {
    source: "fantasy402-ingestion-worker",
    archiveType: "failure",
    endpoint: endpoint.key,
    path: endpoint.path,
    runId,
    failureId,
    responseHash,
    failedAt: failedAt.toISOString(),
    size: String(body.length),
  });

  await env.ANALYTICS_DB.prepare(
    `INSERT INTO endpoint_failures
       (id, run_id, endpoint_key, path, failed_at, attempts, error_message,
        r2_key, r2_etag, r2_size, r2_storage_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      failureId,
      runId,
      endpoint.key,
      endpoint.path,
      failedAt.toISOString(),
      attempts,
      errorMessage(error).slice(0, 1000),
      r2Key,
      r2Object.etag,
      r2Object.size,
      r2Object.storageClass,
    )
    .run();

  console.error("r2 failure archive write", {
    key: r2Key,
    etag: r2Object.etag,
    size: r2Object.size,
    storageClass: r2Object.storageClass,
    upstreamStatus: upstreamError?.status ?? null,
  });
}

function unwrapUpstreamHttpError(error: unknown): UpstreamHttpError | null {
  if (error instanceof UpstreamHttpError) return error;
  if (error instanceof EndpointAttemptError && error.originalError instanceof UpstreamHttpError) {
    return error.originalError;
  }
  return null;
}

async function storeAgentPerformance(
  env: Env,
  metric: {
    id: string;
    runId: string;
    capturedAt: string;
    agentId: string;
    totalWagers: number;
    totalVolume: number;
    winRate: number;
    rawSnapshotId: string;
  },
): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO agent_performance
       (id, run_id, captured_at, agent_id, total_wagers, total_volume, win_rate, raw_snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      metric.id,
      metric.runId,
      metric.capturedAt,
      metric.agentId,
      metric.totalWagers,
      metric.totalVolume,
      metric.winRate,
      metric.rawSnapshotId,
    )
    .run();
}

function mapAgentPerformance(data: unknown, fallbackAgentId: string, rawSnapshotId: string, runId: string) {
  const record = firstObject(data);
  return {
    id: crypto.randomUUID(),
    runId,
    capturedAt: new Date().toISOString(),
    agentId: stringField(record, ["agentID", "AgentID", "agent_id"], fallbackAgentId),
    totalWagers: numberField(record, ["totalWagers", "TotalWagers", "Wagers"], 0),
    totalVolume: numberField(record, ["totalVolume", "TotalVolume", "Handle", "Volume"], 0),
    winRate: numberField(record, ["winRate", "WinRate"], 0),
    rawSnapshotId,
  };
}

async function finishRun(
  env: Env,
  runId: string,
  status: "success" | "failed",
  endpointsSucceeded: number,
  endpointsFailed: number,
  error?: string,
): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `UPDATE ingestion_runs
     SET finished_at = ?, status = ?, endpoints_succeeded = ?, endpoints_failed = ?, error_message = ?
     WHERE id = ?`,
  )
    .bind(new Date().toISOString(), status, endpointsSucceeded, endpointsFailed, error ?? null, runId)
    .run();
}

async function listAlertEvents(url: URL, env: Env): Promise<Response> {
  const limit = clampInteger(Number(url.searchParams.get("limit") ?? "20"), 1, 100);
  const severity = cleanAlertSeverity(url.searchParams.get("severity"));
  const type = cleanAlertType(url.searchParams.get("type"));
  const where: string[] = [];
  const bindings: string[] = [];
  if (severity) {
    where.push("severity = ?");
    bindings.push(severity);
  }
  if (type) {
    where.push("type = ?");
    bindings.push(type);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, created_at, severity, type, message, context_json, r2_key
     FROM alert_events
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all();
  const events = (result.results ?? []).map((event) => ({
    ...event,
    context: parseJsonString(typeof event.context_json === "string" ? event.context_json : null),
  }));
  return json({ filters: { severity, type }, events }, 200);
}

async function summarizeAlertEvents(url: URL, env: Env): Promise<Response> {
  const days = clampInteger(Number(url.searchParams.get("days") ?? "7"), 1, 90);
  const severity = cleanAlertSeverity(url.searchParams.get("severity"));
  const type = cleanAlertType(url.searchParams.get("type"));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const where = ["created_at >= ?"];
  const bindings: string[] = [since];
  if (severity) {
    where.push("severity = ?");
    bindings.push(severity);
  }
  if (type) {
    where.push("type = ?");
    bindings.push(type);
  }
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT id, created_at, severity, type, message, context_json, r2_key
     FROM alert_events
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 500`,
  )
    .bind(...bindings)
    .all();
  const rows = (result.results ?? []) as Array<Record<string, unknown>>;
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byDay: Record<string, { total: number; bySeverity: Record<string, number> }> = {};
  const grouped = new Map<string, { severity: string; type: string; count: number; latest: string | null }>();
  const scanCounts = new Map<string, { scanId: string; count: number; latest: string | null; types: Set<string> }>();

  for (const row of rows) {
    const severity = typeof row.severity === "string" ? row.severity : "unknown";
    const type = typeof row.type === "string" ? row.type : "unknown";
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    const day = createdAt.slice(0, 10) || "unknown";
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    byType[type] = (byType[type] ?? 0) + 1;
    byDay[day] ??= { total: 0, bySeverity: {} };
    byDay[day].total += 1;
    byDay[day].bySeverity[severity] = (byDay[day].bySeverity[severity] ?? 0) + 1;

    const groupKey = `${severity}\0${type}`;
    const group = grouped.get(groupKey) ?? { severity, type, count: 0, latest: null };
    group.count += 1;
    if (!group.latest || createdAt > group.latest) group.latest = createdAt || null;
    grouped.set(groupKey, group);

    const context = parseJsonString(typeof row.context_json === "string" ? row.context_json : null);
    const scanId = context && typeof context === "object" && !Array.isArray(context) && typeof (context as Record<string, unknown>).scanId === "string"
      ? String((context as Record<string, unknown>).scanId)
      : null;
    if (scanId) {
      const scan = scanCounts.get(scanId) ?? { scanId, count: 0, latest: null, types: new Set<string>() };
      scan.count += 1;
      if (!scan.latest || createdAt > scan.latest) scan.latest = createdAt || null;
      scan.types.add(type);
      scanCounts.set(scanId, scan);
    }
  }

  const groups = [...grouped.values()].sort((a, b) => b.count - a.count || String(b.latest).localeCompare(String(a.latest)));
  const daily = Object.entries(byDay)
    .map(([date, bucket]) => ({ date, ...bucket }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const topAffectedScans = [...scanCounts.values()]
    .sort((a, b) => b.count - a.count || String(b.latest).localeCompare(String(a.latest)))
    .slice(0, 10)
    .map((scan) => ({ scanId: scan.scanId, count: scan.count, latest: scan.latest, types: [...scan.types].sort() }));

  return json({ days, since, filters: { severity, type }, total: rows.length, bySeverity, byType, daily, topAffectedScans, groups }, 200);
}

async function createSyntheticAlert(request: Request, env: Env): Promise<Response> {
  const body = await safeJson(request);
  const severity = cleanAlertSeverity(typeof body?.severity === "string" ? body.severity : null) ?? "warning";
  const message = cleanAlertMessage(typeof body?.message === "string" ? body.message : null) ?? "Synthetic alert test";
  const event = await sendFailureAlert(env, {
    severity,
    type: "synthetic-test",
    message,
    context: {
      synthetic: true,
      source: "operator-api",
    },
  });
  return json({ status: "created", event }, 201);
}

async function createSyntheticPolicyAlert(env: Env): Promise<Response> {
  const scanId = crypto.randomUUID();
  const url = env.FANTASY402_BASE_URL || "https://fantasy402.com";
  const summary: HarNetworkSummary = {
    totalRequests: 2,
    byMethod: { GET: 2 },
    byStatus: { "200": 1, "500": 1 },
    byHost: { "fantasy402.com": 1, "unexpected.example": 1 },
    byMimeType: { "text/html": 1, "application/javascript": 1 },
    failedRequests: [
      {
        method: "GET",
        url: "https://unexpected.example/synthetic-policy-test.js",
        host: "unexpected.example",
        status: 500,
        statusText: "Synthetic Failure",
        timeMs: 25,
        bodySize: 10,
      },
    ],
    slowestRequests: [],
    largestResponses: [],
  };
  await alertOnNetworkSummary(env, scanId, url, summary);
  return json({ status: "created", scanId, synthetic: true, summary }, 201);
}

async function sendFailureAlert(env: Env, alert: AlertEventInput): Promise<Record<string, unknown> | null> {
  const event = await storeAlertEvent(env, alert);
  if (!env.ALERT_WEBHOOK_URL) {
    console.error("ingestion alert", alert.message);
    return event;
  }

  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: alert.message, severity: alert.severity, type: alert.type, context: alert.context ?? {} }),
  });
  return event;
}

async function storeAlertEvent(env: Env, alert: AlertEventInput): Promise<Record<string, unknown> | null> {
  try {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = {
      id,
      created_at: createdAt,
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      context: alert.context ?? null,
    };
    const r2Key = archiveKey(`alerts/${alert.type}`, createdAt.slice(0, 10), id);
    await putArchiveObject(env, r2Key, JSON.stringify(payload, null, 2), {
      source: "fantasy402-ingestion-worker",
      archiveType: "alert-event",
      alertType: alert.type,
      severity: alert.severity,
      alertId: id,
      createdAt,
    });
    const event = {
      id,
      created_at: createdAt,
      severity: alert.severity,
      type: alert.type,
      message: alert.message,
      context_json: alert.context ? JSON.stringify(alert.context) : null,
      r2_key: r2Key,
    };
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO alert_events (id, created_at, severity, type, message, context_json, r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        event.id,
        event.created_at,
        event.severity,
        event.type,
        event.message,
        event.context_json,
        event.r2_key,
      )
      .run();
    return { ...event, context: alert.context ?? null };
  } catch (error) {
    console.error("alert event persistence failed", safeError(error, { type: alert.type, severity: alert.severity }));
    return null;
  }
}

function selectEndpoints(env: Env): EndpointConfig[] {
  return env.FANTASY402_INGESTION_ENDPOINTS.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((key) => {
      if (!isEndpointKey(key)) {
        throw new Error(`Unknown endpoint configured: ${key}`);
      }
      const endpoint = ENDPOINTS[key];
      if (endpoint.requiresCustomerId && !env.FANTASY402_CUSTOMER_ID) {
        throw new Error(`${key} requires FANTASY402_CUSTOMER_ID`);
      }
      return endpoint;
    });
}

function withDateRange(env: Env, now: Date, input: Record<string, string | number>): Record<string, string | number> {
  const date = now.toISOString().slice(0, 10);
  return {
    RRO: 1,
    agentOwner: env.FANTASY402_AGENT_ID,
    startDate: date,
    endDate: date,
    start: date,
    end: date,
    ...input,
  };
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractAuthToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["tokenauth", "tokenAuth", "token", "access_token", "authorization"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  for (const child of Object.values(record)) {
    const candidate = extractAuthToken(child);
    if (candidate) return candidate;
  }
  return undefined;
}

function optionalFirstSetCookie(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.trim().split(";")[0] ?? "")
    .find((cookie) => cookie.length > 0);

  return sessionCookie ?? null;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("request-timeout"), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function redactResponse(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactResponse);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = isCredentialField(key) ? "[REDACTED]" : redactResponse(nested);
    }
    return output;
  }
  return value;
}

function isCredentialField(key: string): boolean {
  return /^(password|pass|passwordf|payoutpassword|placewagerpassword)$/i.test(key);
}

function countItems(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value.length;
    }
  }
  return null;
}

function firstObject(data: unknown): Record<string, unknown> {
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    return data[0] as Record<string, unknown>;
  }
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (Array.isArray(value) && value[0] && typeof value[0] === "object") {
        return value[0] as Record<string, unknown>;
      }
    }
    return data as Record<string, unknown>;
  }
  return {};
}

function stringField(record: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return fallback;
}

function numberField(record: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function baseUrl(env: Env): string {
  return env.FANTASY402_BASE_URL.replace(/\/+$/, "");
}

async function putArchiveObject(
  env: Env,
  key: string,
  body: string,
  customMetadata: Record<string, string>,
): Promise<R2Object> {
  return env.RAW_ARCHIVE.put(key, body, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store, max-age=0",
    },
    customMetadata: {
      ...customMetadata,
      storageClass: "infrequent_access",
    },
    storageClass: R2_ARCHIVE_STORAGE_CLASS,
  });
}

async function listArchiveObjects(url: URL, env: Env): Promise<Response> {
  const filters = archiveFilters(url);
  const prefix = filters.prefix;
  const limit = clampInteger(Number(url.searchParams.get("limit") ?? "50"), 1, 1000);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const listed = await env.RAW_ARCHIVE.list(cursor ? { prefix, limit, cursor } : { prefix, limit });
  const objects = listed.objects
    .filter((object) => matchesArchiveFilters(object, filters))
    .map((object) => ({
      key: object.key,
      etag: object.etag,
      size: object.size,
      uploaded: object.uploaded.toISOString(),
      storageClass: object.storageClass,
      httpMetadata: object.httpMetadata ?? {},
      customMetadata: object.customMetadata ?? {},
    }));

  return json(
    {
      filters,
      objects,
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    },
    200,
  );
}

interface ArchiveFilters {
  prefix: string;
  endpoint: string | null;
  date: string | null;
  archiveType: string | null;
}

function archiveFilters(url: URL): ArchiveFilters {
  const endpoint = cleanPathSegment(url.searchParams.get("endpoint"));
  const date = validDate(url.searchParams.get("date"));
  const archiveType = cleanMetadataValue(url.searchParams.get("archiveType"));
  const explicitPrefix = url.searchParams.get("prefix");
  const prefix = explicitPrefix ? normalizeArchivePrefix(explicitPrefix) : archivePrefix(endpoint, date);
  return { prefix, endpoint, date, archiveType };
}

function archivePrefix(endpoint: string | null, date: string | null): string {
  if (endpoint && date) return `${R2_ARCHIVE_PREFIX}/${endpoint}/${date}`;
  if (endpoint) return `${R2_ARCHIVE_PREFIX}/${endpoint}`;
  return R2_ARCHIVE_PREFIX;
}

function matchesArchiveFilters(object: R2Object, filters: ArchiveFilters): boolean {
  const metadata = object.customMetadata ?? {};
  if (filters.archiveType && metadata.archiveType !== filters.archiveType) return false;
  return true;
}

async function getArchiveObject(url: URL, env: Env): Promise<Response> {
  const key = url.searchParams.get("key");
  if (!key) return json({ status: "failed", message: "Missing key" }, 400);
  if (!key.startsWith(`${R2_ARCHIVE_PREFIX}/`)) return json({ status: "failed", message: "Invalid key prefix" }, 400);

  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) return json({ status: "failed", message: "Archive object not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("ETag", object.etag);
  headers.set("X-Archive-Key", object.key);
  headers.set("X-Archive-Storage-Class", object.storageClass);
  headers.set("X-Archive-Size", String(object.size));

  return new Response(object.body, { headers });
}

async function listScanVerdicts(url: URL, env: Env): Promise<Response> {
  const limit = clampInteger(Number(url.searchParams.get("limit") ?? "20"), 1, 100);
  const filters = scanListFilters(url);
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (filters.malicious !== null) {
    where.push("malicious = ?");
    bindings.push(filters.malicious);
  }
  if (filters.urlContains !== null) {
    where.push("url LIKE ?");
    bindings.push(`%${filters.urlContains}%`);
  }
  if (filters.since !== null) {
    where.push("timestamp >= ?");
    bindings.push(`${filters.since}T00:00:00.000Z`);
  }
  if (filters.until !== null) {
    where.push("timestamp <= ?");
    bindings.push(`${filters.until}T23:59:59.999Z`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await env.ANALYTICS_DB.prepare(
    `SELECT scan_id, timestamp, url, malicious, tls_valid_days, agent_readiness_level,
            scan_r2_key, screenshot_r2_key, har_r2_key
     FROM scans_verdicts
     ${whereSql}
     ORDER BY timestamp DESC
     LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all();

  return json({ filters, results: result.results ?? [] }, 200);
}

async function summarizeScanVerdicts(url: URL, env: Env): Promise<Response> {
  const days = clampInteger(Number(url.searchParams.get("days") ?? "7"), 1, 90);
  const tlsWarningDays = clampInteger(Number(url.searchParams.get("tlsWarningDays") ?? "7"), 1, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const query = await env.ANALYTICS_DB.prepare(
    `SELECT scan_id, timestamp, url, malicious, tls_valid_days, agent_readiness_level,
            scan_r2_key, screenshot_r2_key, har_r2_key
     FROM scans_verdicts
     WHERE timestamp >= ?
     ORDER BY timestamp DESC
     LIMIT 1000`,
  )
    .bind(since)
    .all();
  const rows = (query.results ?? []) as Array<Record<string, unknown>>;
  const maliciousCount = rows.filter((row) => Number(row.malicious) === 1).length;
  const tlsExpiringCount = rows.filter((row) => typeof row.tls_valid_days === "number" && row.tls_valid_days <= tlsWarningDays).length;
  const tlsValues = rows.map((row) => row.tls_valid_days).filter((value): value is number => typeof value === "number");

  return json(
    {
      window: {
        days,
        since,
        tlsWarningDays,
        scannedRows: rows.length,
        capped: rows.length >= 1000,
      },
      totals: {
        scans: rows.length,
        malicious: maliciousCount,
        clean: rows.length - maliciousCount,
        tlsExpiring: tlsExpiringCount,
        minTlsValidDays: tlsValues.length ? Math.min(...tlsValues) : null,
      },
      latest: rows[0] ?? null,
      status:
        maliciousCount > 0
          ? "alert"
          : tlsExpiringCount > 0
            ? "warning"
            : rows.length > 0
              ? "ok"
              : "empty",
    },
    200,
  );
}

async function getScanDetail(url: URL, env: Env): Promise<Response> {
  const scanId = url.searchParams.get("scanId");
  if (!scanId) return json({ status: "failed", message: "Missing scanId" }, 400);
  if (!isUuid(scanId)) return json({ status: "failed", message: "Invalid scanId" }, 400);

  const result = await getScanVerdict(scanId, env);
  if (!result) return json({ status: "failed", message: "Scan verdict not found" }, 404);

  const includeRaw = url.searchParams.get("includeRaw") === "true";
  const scanR2Key = typeof result.scan_r2_key === "string" ? result.scan_r2_key : null;
  const archive = scanR2Key ? await scanArchiveSummary(scanR2Key, env, includeRaw) : null;
  return json({ verdict: result, archive }, 200);
}

async function getScanScreenshot(url: URL, env: Env): Promise<Response> {
  return streamScanArtifact(url, env, {
    column: "screenshot_r2_key",
    prefix: `${R2_ARCHIVE_PREFIX}/screenshots/`,
    contentType: "image/png",
    notAvailableMessage: "Scan screenshot not available",
    invalidKeyMessage: "Invalid screenshot archive key",
    notFoundMessage: "Scan screenshot object not found",
  });
}

async function getScanHar(url: URL, env: Env): Promise<Response> {
  return streamScanArtifact(url, env, {
    column: "har_r2_key",
    prefix: `${R2_ARCHIVE_PREFIX}/hars/`,
    contentType: "application/json; charset=utf-8",
    notAvailableMessage: "Scan HAR not available",
    invalidKeyMessage: "Invalid HAR archive key",
    notFoundMessage: "Scan HAR object not found",
  });
}

async function getScanNetworkSummary(url: URL, env: Env): Promise<Response> {
  const scanId = url.searchParams.get("scanId");
  if (!scanId) return json({ status: "failed", message: "Missing scanId" }, 400);
  if (!isUuid(scanId)) return json({ status: "failed", message: "Invalid scanId" }, 400);

  const persisted = await getPersistedNetworkSummary(scanId, env);
  if (persisted) {
    return json(
      {
        scanId,
        harR2Key: persisted.harR2Key,
        generatedAt: new Date().toISOString(),
        source: "d1",
        summary: persisted.summary,
      },
      200,
    );
  }

  const fallback = await computeNetworkSummaryFromHar(scanId, env);
  if (fallback instanceof Response) return fallback;
  return json({ scanId, harR2Key: fallback.harR2Key, generatedAt: new Date().toISOString(), source: "r2", summary: fallback.summary }, 200);
}

async function diffScanNetworkSummaries(url: URL, env: Env): Promise<Response> {
  const baseScanId = url.searchParams.get("baseScanId");
  const compareScanId = url.searchParams.get("compareScanId");
  if (!baseScanId || !compareScanId) return json({ status: "failed", message: "Missing baseScanId or compareScanId" }, 400);
  if (!isUuid(baseScanId) || !isUuid(compareScanId)) return json({ status: "failed", message: "Invalid scan ID" }, 400);

  const [base, compare] = await Promise.all([
    getNetworkSummaryForComparison(baseScanId, env),
    getNetworkSummaryForComparison(compareScanId, env),
  ]);
  if (base instanceof Response) return base;
  if (compare instanceof Response) return compare;

  return json(
    {
      generatedAt: new Date().toISOString(),
      base: { scanId: baseScanId, source: base.source, harR2Key: base.harR2Key, totalRequests: base.summary.totalRequests },
      compare: { scanId: compareScanId, source: compare.source, harR2Key: compare.harR2Key, totalRequests: compare.summary.totalRequests },
      diff: {
        totalRequestsDelta: compare.summary.totalRequests - base.summary.totalRequests,
        hosts: diffCounts(base.summary.byHost, compare.summary.byHost),
        statuses: diffCounts(base.summary.byStatus, compare.summary.byStatus),
        methods: diffCounts(base.summary.byMethod, compare.summary.byMethod),
        mimeTypes: diffCounts(base.summary.byMimeType, compare.summary.byMimeType),
        failedRequestsDelta: compare.summary.failedRequests.length - base.summary.failedRequests.length,
      },
    },
    200,
  );
}

async function getNetworkSummaryForComparison(scanId: string, env: Env): Promise<{ source: "d1" | "r2"; harR2Key: string; summary: ReturnType<typeof summarizeHar> } | Response> {
  const persisted = await getPersistedNetworkSummary(scanId, env);
  if (persisted) return { source: "d1", ...persisted };
  const computed = await computeNetworkSummaryFromHar(scanId, env);
  if (computed instanceof Response) return computed;
  return { source: "r2", ...computed };
}

async function getPersistedNetworkSummary(scanId: string, env: Env): Promise<{ harR2Key: string; summary: ReturnType<typeof summarizeHar> } | null> {
  const query = await env.ANALYTICS_DB.prepare(
    `SELECT total_requests, status_counts_json, method_counts_json, host_counts_json,
            mime_counts_json, failed_requests_json, slowest_requests_json,
            largest_responses_json, har_r2_key
     FROM scan_network_summary
     WHERE scan_id = ?
     LIMIT 1`,
  )
    .bind(scanId)
    .all();
  const row = (query.results ?? [])[0] as Record<string, unknown> | undefined;
  if (!row || typeof row.total_requests !== "number") return null;
  return {
    harR2Key: typeof row.har_r2_key === "string" ? row.har_r2_key : "",
    summary: {
      totalRequests: row.total_requests,
      byStatus: parseJsonObjectOfNumbers(row.status_counts_json),
      byMethod: parseJsonObjectOfNumbers(row.method_counts_json),
      byHost: parseJsonObjectOfNumbers(row.host_counts_json),
      byMimeType: parseJsonObjectOfNumbers(row.mime_counts_json),
      failedRequests: parseJsonArray(row.failed_requests_json),
      slowestRequests: parseJsonArray(row.slowest_requests_json),
      largestResponses: parseJsonArray(row.largest_responses_json),
    },
  };
}

async function computeNetworkSummaryFromHar(scanId: string, env: Env): Promise<{ harR2Key: string; summary: ReturnType<typeof summarizeHar> } | Response> {
  const verdict = await getScanVerdict(scanId, env);
  if (!verdict) return json({ status: "failed", message: "Scan verdict not found" }, 404);

  const key = typeof verdict.har_r2_key === "string" ? verdict.har_r2_key : "";
  if (!key) return json({ status: "failed", message: "Scan HAR not available" }, 404);
  if (!key.startsWith(`${R2_ARCHIVE_PREFIX}/hars/`)) {
    return json({ status: "failed", message: "Invalid HAR archive key" }, 400);
  }

  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) return json({ status: "failed", message: "Scan HAR object not found" }, 404);

  let har: unknown;
  try {
    har = JSON.parse(await object.text());
  } catch {
    return json({ status: "failed", message: "Invalid HAR JSON" }, 422);
  }

  return { harR2Key: key, summary: summarizeHar(har) };
}

function parseJsonObjectOfNumbers(value: unknown): Record<string, number> {
  const parsed = parseJsonString(typeof value === "string" ? value : null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  );
}

function parseJsonArray(value: unknown): HarRequestSummary[] {
  const parsed = parseJsonString(typeof value === "string" ? value : null);
  return Array.isArray(parsed) ? parsed.filter(isHarRequestSummary) : [];
}

function isHarRequestSummary(value: unknown): value is HarRequestSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.method === "string"
    && typeof item.url === "string"
    && typeof item.host === "string"
    && typeof item.status === "number"
    && typeof item.statusText === "string"
    && typeof item.timeMs === "number"
    && typeof item.bodySize === "number";
}

function diffCounts(base: Record<string, number>, compare: Record<string, number>): Record<string, { base: number; compare: number; delta: number }> {
  const keys = new Set([...Object.keys(base), ...Object.keys(compare)]);
  return Object.fromEntries(
    [...keys]
      .map((key) => ({ key, base: base[key] ?? 0, compare: compare[key] ?? 0 }))
      .filter((entry) => entry.base !== entry.compare)
      .sort((a, b) => Math.abs(b.compare - b.base) - Math.abs(a.compare - a.base) || a.key.localeCompare(b.key))
      .map((entry) => [entry.key, { base: entry.base, compare: entry.compare, delta: entry.compare - entry.base }]),
  );
}

async function streamScanArtifact(
  url: URL,
  env: Env,
  options: {
    column: "screenshot_r2_key" | "har_r2_key";
    prefix: string;
    contentType: string;
    notAvailableMessage: string;
    invalidKeyMessage: string;
    notFoundMessage: string;
  },
): Promise<Response> {
  const scanId = url.searchParams.get("scanId");
  if (!scanId) return json({ status: "failed", message: "Missing scanId" }, 400);
  if (!isUuid(scanId)) return json({ status: "failed", message: "Invalid scanId" }, 400);

  const verdict = await getScanVerdict(scanId, env);
  if (!verdict) return json({ status: "failed", message: "Scan verdict not found" }, 404);

  const artifactKey = verdict[options.column];
  const key = typeof artifactKey === "string" ? artifactKey : "";
  if (!key) return json({ status: "failed", message: options.notAvailableMessage }, 404);
  if (!key.startsWith(options.prefix)) {
    return json({ status: "failed", message: options.invalidKeyMessage }, 400);
  }

  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) return json({ status: "failed", message: options.notFoundMessage }, 404);

  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": options.contentType,
    "X-Archive-Key": key,
    "ETag": object.etag,
  });
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Content-Type", options.contentType);
  return new Response(object.body, { status: 200, headers });
}

async function exportScanEvidence(url: URL, env: Env): Promise<Response> {
  const scanId = url.searchParams.get("scanId");
  if (!scanId) return json({ status: "failed", message: "Missing scanId" }, 400);
  if (!isUuid(scanId)) return json({ status: "failed", message: "Invalid scanId" }, 400);

  const verdict = await getScanVerdict(scanId, env);
  if (!verdict) return json({ status: "failed", message: "Scan verdict not found" }, 404);

  const artifactKeys: Array<{ type: "scan" | "screenshot" | "har"; key: unknown }> = [
    { type: "scan", key: verdict.scan_r2_key },
    { type: "screenshot", key: verdict.screenshot_r2_key },
    { type: "har", key: verdict.har_r2_key },
  ];
  const artifacts = await Promise.all(
    artifactKeys
      .filter((entry): entry is { type: "scan" | "screenshot" | "har"; key: string } => typeof entry.key === "string" && entry.key.length > 0)
      .map(async ({ type, key }) => ({ type, ...(await archiveEvidenceSummary(key, env)) })),
  );

  return json(
    {
      generatedAt: new Date().toISOString(),
      scanId,
      verdict,
      artifacts,
    },
    200,
  );
}

async function getScanVerdict(scanId: string, env: Env): Promise<Record<string, unknown> | undefined> {
  const query = await env.ANALYTICS_DB.prepare(
    `SELECT scan_id, timestamp, url, malicious, tls_valid_days, agent_readiness_level,
            scan_r2_key, screenshot_r2_key, har_r2_key
     FROM scans_verdicts
     WHERE scan_id = ?
     LIMIT 1`,
  )
    .bind(scanId)
    .all();
  return (query.results ?? [])[0] as Record<string, unknown> | undefined;
}

async function scanArchiveSummary(key: string, env: Env, includeRaw: boolean): Promise<Record<string, unknown> | null> {
  if (!key.startsWith(`${R2_ARCHIVE_PREFIX}/scans/`)) return null;
  return archiveEvidenceSummary(key, env, includeRaw);
}

async function archiveEvidenceSummary(key: string, env: Env, includeRaw = false): Promise<Record<string, unknown>> {
  if (!key.startsWith(`${R2_ARCHIVE_PREFIX}/`)) {
    return { key, found: false, reason: "invalid-prefix" };
  }
  const object = await env.RAW_ARCHIVE.get(key);
  if (!object) {
    return { key, found: false };
  }
  const summary: Record<string, unknown> = {
    key: object.key,
    found: true,
    etag: object.etag,
    size: object.size,
    uploaded: object.uploaded.toISOString(),
    storageClass: object.storageClass,
    httpMetadata: object.httpMetadata ?? {},
    customMetadata: object.customMetadata ?? {},
  };
  if (includeRaw) {
    const text = await object.text();
    try {
      summary.raw = JSON.parse(text);
    } catch {
      summary.raw = text;
    }
  }
  return summary;
}

interface ScanListFilters {
  malicious: 0 | 1 | null;
  urlContains: string | null;
  since: string | null;
  until: string | null;
}

function scanListFilters(url: URL): ScanListFilters {
  const maliciousParam = url.searchParams.get("malicious");
  return {
    malicious: maliciousParam === "true" || maliciousParam === "1" ? 1 : maliciousParam === "false" || maliciousParam === "0" ? 0 : null,
    urlContains: cleanSearchText(url.searchParams.get("urlContains"), 120),
    since: validDate(url.searchParams.get("since")),
    until: validDate(url.searchParams.get("until")),
  };
}

function diagnostics(env: Env): Response {
  const requiredSecrets = [
    "FANTASY402_USERNAME",
    "FANTASY402_PASSWORD",
    "FANTASY402_AGENT_ID",
    "CLOUDFLARE_API_TOKEN",
  ] as const;
  const authReady = hasEnvValue(authToken(env));
  const optionalSecrets = [
    "FANTASY402_CUSTOMER_ID",
    "FANTASY402_SESSION_COOKIE",
    "FANTASY402_CF_CLEARANCE",
    "FANTASY402_CF_BM",
    "FANTASY402_AUTHORIZATION",
    "FANTASY402_USER_AGENT",
    "FANTASY402_REFERER",
    "FANTASY402_BROWSER_HEADERS_JSON",
    "ALERT_WEBHOOK_URL",
  ] as const;
  const presentRequiredSecrets = requiredSecrets.filter((name) => hasEnvValue(env[name]));
  const missingRequiredSecrets = requiredSecrets.filter((name) => !hasEnvValue(env[name]));

  return json(
    {
      status: missingRequiredSecrets.length === 0 && authReady ? "ready" : "degraded",
      environment: env.ENVIRONMENT,
      workerName: env.WORKER_NAME,
      cloudflare: {
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        zoneId: env.CLOUDFLARE_ZONE_ID,
      },
      bindings: {
        sessionKv: Boolean(env.SESSION_KV),
        authCache: Boolean(env.AUTH_CACHE),
        analyticsDb: Boolean(env.ANALYTICS_DB),
        rawArchive: Boolean(env.RAW_ARCHIVE),
      },
      requiredSecrets: {
        present: presentRequiredSecrets,
        missing: missingRequiredSecrets,
      },
      auth: {
        configured: authReady,
        acceptedSecrets: ["INGESTION_TRIGGER_TOKEN", "ARCHIVE_AUTH_TOKEN"],
        preferredSecret: "INGESTION_TRIGGER_TOKEN",
      },
      upstreamAuthShape: upstreamAuthDiagnostics(env),
      optionalSecrets: Object.fromEntries(optionalSecrets.map((name) => [name, hasEnvValue(env[name])])),
      scanPolicy: {
        allowedHosts: [...allowedScanHosts(env, env.FANTASY402_BASE_URL || "https://fantasy402.com")],
      },
      configuredEndpoints: env.FANTASY402_INGESTION_ENDPOINTS.split(",").map((endpoint) => endpoint.trim()).filter(Boolean),
      archive: {
        prefix: R2_ARCHIVE_PREFIX,
        storageClass: R2_ARCHIVE_STORAGE_CLASS,
      },
    },
    200,
  );
}

function upstreamAuthDiagnostics(env: Env): Record<string, unknown> {
  const cookieNames = splitCookieHeader(fantasy402CookieHeader(env, ""))
    .map((cookie) => cookieName(cookie))
    .filter((name): name is string => Boolean(name));
  const hasCookieName = (name: string) => cookieNames.some((cookie) => cookie.toLowerCase() === name.toLowerCase());
  return {
    hasAuthorization: Boolean(normalizeAuthorization(env.FANTASY402_AUTHORIZATION)),
    hasCookie: cookieNames.length > 0,
    hasSessionCookie: cookieNames.some((name) => !isCloudflareCookieName(name)),
    hasCfClearance: hasCookieName("cf_clearance"),
    hasCfBm: hasCookieName("__cf_bm"),
    cookieNames,
    browserHeaderCount: observedBrowserHeaderCount(env.FANTASY402_BROWSER_HEADERS_JSON),
  };
}

function isCloudflareCookieName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "cf_clearance" || normalized === "__cf_bm";
}

function observedBrowserHeaderCount(rawJson: string | undefined): number {
  if (typeof rawJson !== "string" || rawJson.trim().length === 0) return 0;
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).length : 0;
  } catch {
    return 0;
  }
}

function archiveKey(endpointSegment: string, date: string, id: string): string {
  return `${R2_ARCHIVE_PREFIX}/${endpointSegment}/${date}/${id}.json`;
}

function normalizeArchivePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "");
  if (trimmed === R2_ARCHIVE_PREFIX || trimmed.startsWith(`${R2_ARCHIVE_PREFIX}/`)) return trimmed;
  return R2_ARCHIVE_PREFIX;
}

function cleanPathSegment(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanMetadataValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanAlertSeverity(value: string | null): "info" | "warning" | "critical" | null {
  return value === "info" || value === "warning" || value === "critical" ? value : null;
}

function cleanAlertType(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

function cleanAlertMessage(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

function cleanSearchText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  if (!/^[\w .:/?&=%-]+$/.test(trimmed)) return null;
  return trimmed;
}

function parseJsonString(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function validDate(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return Number.isNaN(Date.parse(`${trimmed}T00:00:00.000Z`)) ? null : trimmed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isAuthorized(request: Request, env: Env): boolean {
  const token = authToken(env);
  if (!token) return false;
  return request.headers.get("Authorization") === `Bearer ${token}`;
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

function authToken(env: Env): string | undefined {
  return env.INGESTION_TRIGGER_TOKEN || env.ARCHIVE_AUTH_TOKEN;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return await request.json<Record<string, unknown>>();
  } catch {
    return null;
  }
}

function archiveViewer(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fantasy402 Archive Viewer</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #111827; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
    h1 { font-size: 24px; margin: 0; }
    .controls { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(150px, 220px) minmax(130px, 180px) minmax(120px, 160px) 92px 104px; gap: 8px; margin-bottom: 16px; }
    input, button, textarea, select { font: inherit; border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px 10px; background: #fff; color: #111827; }
    button { cursor: pointer; background: #0f172a; color: white; border-color: #0f172a; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; }
    th { background: #eef2f7; color: #334155; font-weight: 650; }
    tr:hover td { background: #f8fafc; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr); gap: 16px; align-items: start; }
    .panel { border: 1px solid #e2e8f0; background: #fff; border-radius: 6px; overflow: hidden; }
    .panel h2 { font-size: 14px; margin: 0; padding: 10px 12px; background: #eef2f7; border-bottom: 1px solid #e2e8f0; }
    pre { margin: 0; padding: 12px; min-height: 460px; max-height: 720px; overflow: auto; font-size: 12px; line-height: 1.45; white-space: pre-wrap; }
    .status { min-height: 20px; font-size: 13px; color: #475569; }
    .error { color: #b91c1c; }
    .screenshot-wrap { padding: 12px; border-bottom: 1px solid #e2e8f0; }
    .screenshot-wrap img { display: block; width: 100%; max-height: 520px; object-fit: contain; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
    .screenshot-wrap[hidden] { display: none; }
    .mini-card { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 12px; border-bottom: 1px solid #e2e8f0; }
    .metric { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #f8fafc; min-width: 0; }
    .metric b { display: block; font-size: 12px; color: #475569; margin-bottom: 4px; }
    .metric span { overflow-wrap: anywhere; font-size: 13px; }
    .badges { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px; border-bottom: 1px solid #e2e8f0; }
    .badge { border-radius: 999px; padding: 4px 9px; font-size: 12px; font-weight: 700; background: #e2e8f0; color: #334155; }
    .badge.critical { background: #fee2e2; color: #991b1b; }
    .badge.warning { background: #fef3c7; color: #92400e; }
    .badge.info { background: #dbeafe; color: #1e40af; }
    @media (max-width: 900px) { .controls, .layout { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } }
    @media (prefers-color-scheme: dark) {
      body { background: #0b1020; color: #e5e7eb; }
      input, textarea, select, table, .panel { background: #111827; color: #e5e7eb; border-color: #334155; }
      th, .panel h2 { background: #1f2937; color: #e5e7eb; border-color: #334155; }
      tr:hover td { background: #172033; }
      td, th { border-color: #334155; }
      .screenshot-wrap { border-color: #334155; }
      .screenshot-wrap img { background: #0b1020; border-color: #334155; }
      .mini-card, .badges { border-color: #334155; }
      .metric { background: #172033; border-color: #334155; }
      .metric b { color: #cbd5e1; }
      button { background: #e5e7eb; color: #111827; border-color: #e5e7eb; }
      .status { color: #cbd5e1; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Fantasy402 Archive Viewer</h1>
      <div class="status" id="status">Enter a bearer token to list archived R2 objects.</div>
    </header>
    <section class="controls">
      <input id="prefix" value="fantasy402/" aria-label="Archive prefix">
      <input id="endpoint" placeholder="Endpoint" aria-label="Endpoint filter">
      <input id="date" type="date" aria-label="Archive date filter">
      <input id="archiveType" placeholder="Archive type" aria-label="Archive type filter">
      <input id="token" type="password" autocomplete="off" placeholder="Bearer token" aria-label="Bearer token">
      <input id="limit" type="number" min="1" max="1000" value="50" aria-label="Limit">
      <button id="list">List</button>
    </section>
    <section class="layout">
      <div class="panel">
        <h2>Objects</h2>
        <table>
          <thead><tr><th>Key</th><th>Size</th><th>Uploaded</th><th>Class</th></tr></thead>
          <tbody id="objects"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Preview</h2>
        <pre id="preview"></pre>
      </div>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <h2>Scan Verdicts</h2>
      <div class="controls" style="grid-template-columns: minmax(260px, 1fr) 120px 1fr; margin: 12px;">
        <input id="scanNowUrl" value="https://fantasy402.com" aria-label="Manual scan URL">
        <button id="scanNow">Scan Now</button>
        <div class="status" id="scanNowStatus"></div>
      </div>
      <div class="controls" style="grid-template-columns: minmax(160px, 1fr) 132px 140px 140px 96px 120px 1fr; margin: 12px;">
        <input id="scanUrlContains" placeholder="URL contains" aria-label="Scan URL contains">
        <select id="scanMalicious" aria-label="Malicious filter">
          <option value="">Any verdict</option>
          <option value="false">Clean</option>
          <option value="true">Malicious</option>
        </select>
        <input id="scanSince" type="date" aria-label="Scan since date">
        <input id="scanUntil" type="date" aria-label="Scan until date">
        <input id="scanLimit" type="number" min="1" max="100" value="20" aria-label="Scan limit">
        <button id="loadScans">Load Scans</button>
        <div class="status" id="scanStatus"></div>
      </div>
      <div class="controls" style="grid-template-columns: 120px 150px 140px 1fr; margin: 12px;">
        <input id="summaryDays" type="number" min="1" max="90" value="7" aria-label="Summary window days">
        <input id="tlsWarningDays" type="number" min="1" max="90" value="7" aria-label="TLS warning days">
        <button id="loadScanSummary">Load Summary</button>
        <div class="status" id="summaryStatus"></div>
      </div>
      <pre id="scanSummary"></pre>
      <pre id="scans"></pre>
      <div class="screenshot-wrap" id="scanScreenshotWrap" hidden>
        <img id="scanScreenshot" alt="Latest selected scan screenshot">
      </div>
      <div class="mini-card" id="scanNetworkCard" hidden></div>
      <div class="controls" style="grid-template-columns: 130px 1fr; margin: 12px;">
        <button id="loadScanHar" disabled>Load HAR</button>
        <div class="status" id="scanHarStatus"></div>
      </div>
      <pre id="scanNetworkSummary"></pre>
      <pre id="scanHar"></pre>
      <pre id="scanDetail"></pre>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <h2>Diagnostics</h2>
      <div class="controls" style="grid-template-columns: 160px 1fr; margin: 12px;">
        <button id="loadDiagnostics">Load Diagnostics</button>
        <div class="status" id="diagnosticsStatus"></div>
      </div>
      <pre id="diagnostics"></pre>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <h2>Alerts</h2>
      <div class="controls" style="grid-template-columns: 150px 180px 96px 120px 140px 150px 1fr; margin: 12px;">
        <select id="alertSeverity" aria-label="Alert severity filter">
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <input id="alertType" placeholder="Alert type" aria-label="Alert type filter">
        <input id="alertLimit" type="number" min="1" max="100" value="20" aria-label="Alert limit">
        <button id="loadAlerts">Load Alerts</button>
        <button id="testAlert">Test Alert</button>
        <button id="testPolicyAlert">Test Policy</button>
        <div class="status" id="alertsStatus"></div>
      </div>
      <div class="badges" id="alertBadges"></div>
      <pre id="alertsSummary"></pre>
      <pre id="alerts"></pre>
    </section>
  </main>
  <script>
    const statusEl = document.querySelector("#status");
    const objectsEl = document.querySelector("#objects");
    const previewEl = document.querySelector("#preview");
    const scanStatusEl = document.querySelector("#scanStatus");
    const scanNowStatusEl = document.querySelector("#scanNowStatus");
    const scansEl = document.querySelector("#scans");
    const scanDetailEl = document.querySelector("#scanDetail");
    const scanScreenshotWrapEl = document.querySelector("#scanScreenshotWrap");
    const scanScreenshotEl = document.querySelector("#scanScreenshot");
    const scanHarButtonEl = document.querySelector("#loadScanHar");
    const scanHarStatusEl = document.querySelector("#scanHarStatus");
    const scanHarEl = document.querySelector("#scanHar");
    const scanNetworkSummaryEl = document.querySelector("#scanNetworkSummary");
    const scanNetworkCardEl = document.querySelector("#scanNetworkCard");
    const summaryStatusEl = document.querySelector("#summaryStatus");
    const scanSummaryEl = document.querySelector("#scanSummary");
    const diagnosticsStatusEl = document.querySelector("#diagnosticsStatus");
    const diagnosticsEl = document.querySelector("#diagnostics");
    const alertsStatusEl = document.querySelector("#alertsStatus");
    const alertBadgesEl = document.querySelector("#alertBadges");
    const alertsSummaryEl = document.querySelector("#alertsSummary");
    const alertsEl = document.querySelector("#alerts");
    let scanScreenshotUrl = null;

    document.querySelector("#list").addEventListener("click", listObjects);
    document.querySelector("#scanNow").addEventListener("click", scanNow);
    document.querySelector("#loadScans").addEventListener("click", listScans);
    scanHarButtonEl.addEventListener("click", () => loadScanHar(scanHarButtonEl.dataset.scanId));
    document.querySelector("#loadScanSummary").addEventListener("click", loadScanSummary);
    document.querySelector("#loadDiagnostics").addEventListener("click", loadDiagnostics);
    document.querySelector("#loadAlerts").addEventListener("click", loadAlerts);
    document.querySelector("#testAlert").addEventListener("click", testAlert);
    document.querySelector("#testPolicyAlert").addEventListener("click", testPolicyAlert);

    async function listObjects() {
      const prefix = document.querySelector("#prefix").value || "fantasy402/";
      const limit = document.querySelector("#limit").value || "50";
      const endpoint = document.querySelector("#endpoint").value;
      const date = document.querySelector("#date").value;
      const archiveType = document.querySelector("#archiveType").value;
      const token = document.querySelector("#token").value;
      if (!token) return setStatus("Missing bearer token.", true);
      setStatus("Loading archive objects...");
      previewEl.textContent = "";
      objectsEl.textContent = "";
      const params = new URLSearchParams({ prefix, limit });
      if (endpoint) params.set("endpoint", endpoint);
      if (date) params.set("date", date);
      if (archiveType) params.set("archiveType", archiveType);
      const response = await fetch("/archive?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const body = await response.json();
      if (!response.ok) return setStatus(body.message || "Archive list failed.", true);
      for (const object of body.objects) {
        const row = document.createElement("tr");
        row.innerHTML = "<td><button data-key=" + JSON.stringify(object.key) + ">Open</button> <code></code></td><td></td><td></td><td></td>";
        row.querySelector("code").textContent = object.key;
        row.children[1].textContent = String(object.size);
        row.children[2].textContent = object.uploaded;
        row.children[3].textContent = object.storageClass;
        row.querySelector("button").addEventListener("click", () => openObject(object.key));
        objectsEl.append(row);
      }
      setStatus("Loaded " + body.objects.length + " object(s)." + (body.truncated ? " More results are available with cursor paging." : ""));
    }

    async function openObject(key) {
      const token = document.querySelector("#token").value;
      if (!token) return setStatus("Missing bearer token.", true);
      setStatus("Loading " + key + "...");
      const response = await fetch("/archive/object?key=" + encodeURIComponent(key), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setStatus("Archive object load failed.", true);
        previewEl.textContent = text;
        return;
      }
      setStatus("Loaded " + key + ".");
      try {
        previewEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        previewEl.textContent = text;
      }
    }

    async function scanNow() {
      const token = document.querySelector("#token").value;
      const url = document.querySelector("#scanNowUrl").value || "https://fantasy402.com";
      if (!token) return setScanNowStatus("Missing bearer token.", true);
      setScanNowStatus("Submitting scan...");
      scanDetailEl.textContent = "";
      clearScanHar();
      clearScanScreenshot();
      const response = await fetch("/trigger-scan", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url })
      });
      const text = await response.text();
      if (!response.ok) {
        setScanNowStatus("Scan failed.", true);
        scanDetailEl.textContent = text;
        return;
      }
      const body = parseJsonOrText(text);
      setScanNowStatus("Scan completed: " + body.scanId + ".");
      scanDetailEl.textContent = JSON.stringify(body, null, 2);
      await Promise.all([loadScanSummary(), listScans(), loadAlerts()]);
    }

    async function loadDiagnostics() {
      const token = document.querySelector("#token").value;
      if (!token) return setDiagnosticsStatus("Missing bearer token.", true);
      setDiagnosticsStatus("Loading diagnostics...");
      diagnosticsEl.textContent = "";
      const [runtimeResponse, scannerResponse] = await Promise.all([
        fetch("/diagnostics", {
          headers: { Authorization: "Bearer " + token }
        }),
        fetch("/scanner/diagnostics", {
          headers: { Authorization: "Bearer " + token }
        })
      ]);
      const runtimeText = await runtimeResponse.text();
      const scannerText = await scannerResponse.text();
      if (!runtimeResponse.ok || !scannerResponse.ok) {
        setDiagnosticsStatus("Diagnostics failed.", true);
        diagnosticsEl.textContent = JSON.stringify({
          runtime: parseJsonOrText(runtimeText),
          scanner: parseJsonOrText(scannerText)
        }, null, 2);
        return;
      }
      const diagnostics = {
        runtime: parseJsonOrText(runtimeText),
        scanner: parseJsonOrText(scannerText)
      };
      setDiagnosticsStatus(diagnostics.scanner.status === "ready" ? "Loaded diagnostics." : "Loaded diagnostics with scanner issues.", diagnostics.scanner.status !== "ready");
      diagnosticsEl.textContent = JSON.stringify(diagnostics, null, 2);
    }

    async function loadAlerts() {
      const token = document.querySelector("#token").value;
      const severity = document.querySelector("#alertSeverity").value;
      const type = document.querySelector("#alertType").value;
      const limit = document.querySelector("#alertLimit").value || "20";
      if (!token) return setAlertsStatus("Missing bearer token.", true);
      setAlertsStatus("Loading alerts...");
      alertsEl.textContent = "";
      alertsSummaryEl.textContent = "";
      const params = new URLSearchParams({ limit });
      if (severity) params.set("severity", severity);
      if (type) params.set("type", type);
      const response = await fetch("/alerts?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setAlertsStatus("Alerts failed.", true);
        alertsEl.textContent = text;
        return;
      }
      const body = parseJsonOrText(text);
      setAlertsStatus("Loaded " + (body.events ? body.events.length : 0) + " alert(s).", false);
      alertsEl.textContent = JSON.stringify(body, null, 2);
      await loadAlertsSummary();
    }

    async function loadAlertsSummary() {
      const token = document.querySelector("#token").value;
      if (!token) return;
      const response = await fetch("/alerts/summary?days=7", {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      const body = parseJsonOrText(text);
      if (response.ok) renderAlertBadges(body);
      alertsSummaryEl.textContent = response.ok ? JSON.stringify(body, null, 2) : text;
    }

    function renderAlertBadges(summary) {
      alertBadgesEl.textContent = "";
      const severities = summary.bySeverity || {};
      for (const severity of ["critical", "warning", "info"]) {
        const count = severities[severity] || 0;
        const badge = document.createElement("span");
        badge.className = "badge " + severity;
        badge.textContent = severity + ": " + count;
        alertBadgesEl.append(badge);
      }
    }

    async function testAlert() {
      const token = document.querySelector("#token").value;
      if (!token) return setAlertsStatus("Missing bearer token.", true);
      setAlertsStatus("Creating synthetic alert...");
      const response = await fetch("/alerts/test", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          severity: "warning",
          message: "Synthetic alert test from archive viewer"
        })
      });
      const text = await response.text();
      if (!response.ok) {
        setAlertsStatus("Synthetic alert failed.", true);
        alertsEl.textContent = text;
        return;
      }
      setAlertsStatus("Synthetic alert created.");
      alertsEl.textContent = JSON.stringify(parseJsonOrText(text), null, 2);
      await loadAlerts();
    }

    async function testPolicyAlert() {
      const token = document.querySelector("#token").value;
      if (!token) return setAlertsStatus("Missing bearer token.", true);
      setAlertsStatus("Creating synthetic policy alerts...");
      const response = await fetch("/alerts/policy-test", {
        method: "POST",
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setAlertsStatus("Synthetic policy alert failed.", true);
        alertsEl.textContent = text;
        return;
      }
      setAlertsStatus("Synthetic policy alerts created.");
      alertsEl.textContent = JSON.stringify(parseJsonOrText(text), null, 2);
      await loadAlerts();
    }

    function parseJsonOrText(text) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    async function listScans() {
      const token = document.querySelector("#token").value;
      const limit = document.querySelector("#scanLimit").value || "20";
      const urlContains = document.querySelector("#scanUrlContains").value;
      const malicious = document.querySelector("#scanMalicious").value;
      const since = document.querySelector("#scanSince").value;
      const until = document.querySelector("#scanUntil").value;
      if (!token) return setScanStatus("Missing bearer token.", true);
      setScanStatus("Loading scan verdicts...");
      scansEl.textContent = "";
      scanDetailEl.textContent = "";
      clearScanHar();
      const params = new URLSearchParams({ limit });
      if (urlContains) params.set("urlContains", urlContains);
      if (malicious) params.set("malicious", malicious);
      if (since) params.set("since", since);
      if (until) params.set("until", until);
      const response = await fetch("/scans?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setScanStatus("Scan list failed.", true);
        scansEl.textContent = text;
        clearScanHar();
        clearScanScreenshot();
        return;
      }
      setScanStatus("Loaded scan verdicts.");
      try {
        const body = JSON.parse(text);
        scansEl.textContent = JSON.stringify(body, null, 2);
        if (body.results && body.results.length > 0) {
          await loadScanDetail(body.results[0].scan_id);
        }
      } catch {
        scansEl.textContent = text;
      }
    }

    async function loadScanSummary() {
      const token = document.querySelector("#token").value;
      const days = document.querySelector("#summaryDays").value || "7";
      const tlsWarningDays = document.querySelector("#tlsWarningDays").value || "7";
      if (!token) return setSummaryStatus("Missing bearer token.", true);
      setSummaryStatus("Loading scan summary...");
      scanSummaryEl.textContent = "";
      const params = new URLSearchParams({ days, tlsWarningDays });
      const response = await fetch("/scans/summary?" + params.toString(), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setSummaryStatus("Scan summary failed.", true);
        scanSummaryEl.textContent = text;
        return;
      }
      const body = parseJsonOrText(text);
      const hasIssue = body.status === "alert" || body.status === "warning";
      setSummaryStatus("Loaded scan summary: " + body.status + ".", hasIssue);
      scanSummaryEl.textContent = JSON.stringify(body, null, 2);
    }

    async function loadScanDetail(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return;
      scanDetailEl.textContent = "";
      clearScanHar();
      clearScanScreenshot();
      const response = await fetch("/scans/detail?includeRaw=true&scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      try {
        scanDetailEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        scanDetailEl.textContent = text;
      }
      if (response.ok) {
        scanHarButtonEl.disabled = false;
        scanHarButtonEl.dataset.scanId = scanId;
        setScanHarStatus("Loading network summary...");
        await Promise.all([loadScanScreenshot(scanId), loadScanNetworkSummary(scanId)]);
      }
    }

    async function loadScanScreenshot(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return;
      const response = await fetch("/scans/screenshot?scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      if (!response.ok) return;
      const blob = await response.blob();
      clearScanScreenshot();
      scanScreenshotUrl = URL.createObjectURL(blob);
      scanScreenshotEl.src = scanScreenshotUrl;
      scanScreenshotWrapEl.hidden = false;
    }

    async function loadScanNetworkSummary(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return;
      scanNetworkSummaryEl.textContent = "";
      const response = await fetch("/scans/network-summary?scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setScanHarStatus("Network summary failed.", true);
        scanNetworkSummaryEl.textContent = text;
        scanNetworkCardEl.hidden = true;
        return;
      }
      setScanHarStatus("Loaded network summary. HAR available for selected scan.");
      const body = parseJsonOrText(text);
      renderNetworkCard(body.summary);
      scanNetworkSummaryEl.textContent = JSON.stringify(body, null, 2);
    }

    function renderNetworkCard(summary) {
      scanNetworkCardEl.textContent = "";
      if (!summary) {
        scanNetworkCardEl.hidden = true;
        return;
      }
      const topHost = Object.entries(summary.byHost || {})[0] || ["none", 0];
      const slowest = (summary.slowestRequests || [])[0] || {};
      const cards = [
        ["Requests", String(summary.totalRequests || 0)],
        ["Top host", topHost[0] + " (" + topHost[1] + ")"],
        ["Slowest", (slowest.host || "none") + " " + Math.round(slowest.timeMs || 0) + "ms"]
      ];
      for (const card of cards) {
        const el = document.createElement("div");
        el.className = "metric";
        el.innerHTML = "<b></b><span></span>";
        el.querySelector("b").textContent = card[0];
        el.querySelector("span").textContent = card[1];
        scanNetworkCardEl.append(el);
      }
      scanNetworkCardEl.hidden = false;
    }

    async function loadScanHar(scanId) {
      const token = document.querySelector("#token").value;
      if (!token || !scanId) return setScanHarStatus("Missing bearer token or scan.", true);
      setScanHarStatus("Loading HAR...");
      scanHarEl.textContent = "";
      const response = await fetch("/scans/har?scanId=" + encodeURIComponent(scanId), {
        headers: { Authorization: "Bearer " + token }
      });
      const text = await response.text();
      if (!response.ok) {
        setScanHarStatus("HAR load failed.", true);
        scanHarEl.textContent = text;
        return;
      }
      setScanHarStatus("Loaded HAR.");
      try {
        scanHarEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        scanHarEl.textContent = text;
      }
    }

    function clearScanScreenshot() {
      if (scanScreenshotUrl) URL.revokeObjectURL(scanScreenshotUrl);
      scanScreenshotUrl = null;
      scanScreenshotEl.removeAttribute("src");
      scanScreenshotWrapEl.hidden = true;
    }

    function clearScanHar() {
      scanHarButtonEl.disabled = true;
      delete scanHarButtonEl.dataset.scanId;
      scanHarEl.textContent = "";
      scanNetworkCardEl.hidden = true;
      scanNetworkSummaryEl.textContent = "";
      setScanHarStatus("");
    }

    function setStatus(message, error = false) {
      statusEl.textContent = message;
      statusEl.className = error ? "status error" : "status";
    }

    function setScanStatus(message, error = false) {
      scanStatusEl.textContent = message;
      scanStatusEl.className = error ? "status error" : "status";
    }

    function setScanNowStatus(message, error = false) {
      scanNowStatusEl.textContent = message;
      scanNowStatusEl.className = error ? "status error" : "status";
    }

    function setScanHarStatus(message, error = false) {
      scanHarStatusEl.textContent = message;
      scanHarStatusEl.className = error ? "status error" : "status";
    }

    function setSummaryStatus(message, error = false) {
      summaryStatusEl.textContent = message;
      summaryStatusEl.className = error ? "status error" : "status";
    }

    function setDiagnosticsStatus(message, error = false) {
      diagnosticsStatusEl.textContent = message;
      diagnosticsStatusEl.className = error ? "status error" : "status";
    }

    function setAlertsStatus(message, error = false) {
      alertsStatusEl.textContent = message;
      alertsStatusEl.className = error ? "status error" : "status";
    }
  </script>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src blob:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof UpstreamHttpError) return error.retryable;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function isEndpointKey(key: string): key is EndpointKey {
  return Object.prototype.hasOwnProperty.call(ENDPOINTS, key);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scanErrorResponse(error: unknown): Record<string, unknown> {
  if (error instanceof UrlScannerApiError) {
    return {
      status: "failed",
      subsystem: "cloudflare-url-scanner",
      stage: error.stage,
      method: error.method,
      path: error.path,
      httpStatus: error.status,
      code: error.code,
      message: error.apiMessage,
      retryable: error.retryable,
    };
  }

  return {
    status: "failed",
    subsystem: "cloudflare-url-scanner",
    message: errorMessage(error),
  };
}

async function materializeSecretBindings(env: Env): Promise<Env> {
  const resolved = { ...env } as Record<string, unknown>;
  for (const key of [
    "FANTASY402_USERNAME",
    "FANTASY402_PASSWORD",
    "FANTASY402_AGENT_ID",
    "FANTASY402_SESSION_COOKIE",
    "FANTASY402_CF_CLEARANCE",
    "FANTASY402_CF_BM",
    "FANTASY402_AUTHORIZATION",
    "FANTASY402_USER_AGENT",
    "FANTASY402_REFERER",
    "FANTASY402_BROWSER_HEADERS_JSON",
    "CLOUDFLARE_API_TOKEN",
  ] as const) {
    const value = resolved[key];
    if (isSecretsStoreBinding(value)) {
      try {
        resolved[key] = await value.get();
      } catch (error) {
        console.error("[Config] Secrets Store binding resolution failed", {
          binding: key,
          message: errorMessage(error),
        });
        throw new Error(`Secrets Store binding ${key} failed to resolve: ${errorMessage(error)}`);
      }
    }
  }
  const materialized = resolved as unknown as Env;
  return applyAuthCacheOverlay(materialized);
}

async function applyAuthCacheOverlay(env: Env): Promise<Env> {
  if (!env.AUTH_CACHE) return env;
  const cached = await env.AUTH_CACHE.get<AuthCacheRecord>(AUTH_CACHE_KEY, "json");
  if (!cached || cached.expiresAt <= Date.now()) return env;
  const overlaid = { ...env };
  if (cached.authorization) overlaid.FANTASY402_AUTHORIZATION = cached.authorization;
  if (cached.sessionCookie) overlaid.FANTASY402_SESSION_COOKIE = cached.sessionCookie;
  if (cached.cfClearance) overlaid.FANTASY402_CF_CLEARANCE = cached.cfClearance;
  if (cached.cfBm) overlaid.FANTASY402_CF_BM = cached.cfBm;
  if (cached.browserHeadersJson) overlaid.FANTASY402_BROWSER_HEADERS_JSON = cached.browserHeadersJson;
  if (cached.userAgent) overlaid.FANTASY402_USER_AGENT = cached.userAgent;
  if (cached.referer) overlaid.FANTASY402_REFERER = cached.referer;
  if (cached.customerId) overlaid.FANTASY402_CUSTOMER_ID = cached.customerId;
  return overlaid;
}

function isSecretsStoreBinding(value: unknown): value is SecretsStoreBinding {
  return typeof value === "object" && value !== null && typeof (value as SecretsStoreBinding).get === "function";
}

function scannerSecretResolutionError(error: unknown, env: Env): Record<string, unknown> {
  return {
    status: "degraded",
    subsystem: "cloudflare-url-scanner",
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    tokenShape: {
      configured: Boolean(env.CLOUDFLARE_API_TOKEN),
      length: 0,
      trimmedLength: 0,
      asciiOnly: true,
      hasWhitespace: false,
      hasLeadingOrTrailingWhitespace: false,
      looksLikeFormattedOutput: false,
    },
    checks: [],
    failure: {
      stage: "secret-store",
      code: null,
      message: errorMessage(error),
    },
  };
}

function safeError(error: unknown, context: Record<string, string>): Record<string, string> {
  return {
    ...context,
    message: errorMessage(error),
  };
}
