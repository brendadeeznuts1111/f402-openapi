interface Env {
  SESSION_KV: KVNamespace;
  ANALYTICS_DB: D1Database;
  RAW_ARCHIVE: R2Bucket;
  ENVIRONMENT: string;
  FANTASY402_BASE_URL: string;
  FANTASY402_INGESTION_ENDPOINTS: string;
  FANTASY402_USERNAME: string;
  FANTASY402_PASSWORD: string;
  FANTASY402_AGENT_ID: string;
  FANTASY402_CUSTOMER_ID?: string;
  INGESTION_TRIGGER_TOKEN: string;
  ALERT_WEBHOOK_URL?: string;
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
  expiresAt: number;
}

interface EndpointConfig {
  key: EndpointKey;
  path: string;
  requiresCustomerId?: boolean;
  buildBody: (env: Env, now: Date) => Record<string, string | number>;
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

const SESSION_KEY = "fantasy402:session";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 4;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ENDPOINT_ATTEMPTS = 3;
const R2_ARCHIVE_PREFIX = "fantasy402";
const R2_ARCHIVE_STORAGE_CLASS = "InfrequentAccess";

class UpstreamHttpError extends Error {
  readonly retryable: boolean;

  constructor(endpoint: EndpointConfig, status: number) {
    super(`Fantasy402 API error HTTP ${status} on ${endpoint.key}`);
    this.retryable = status === 429 || status >= 500;
  }
}

class EndpointAttemptError extends Error {
  readonly attempts: number;

  constructor(error: unknown, attempts: number) {
    super(errorMessage(error));
    this.attempts = attempts;
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
    buildBody: (env, now) => withDateRange(env, now, { agentID: env.FANTASY402_AGENT_ID, operation: "getPending" }),
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

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runIngestion(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ status: "ok", environment: env.ENVIRONMENT }, 200);
    }

    if (url.pathname === "/trigger" && request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return json({ status: "failed", message: "Unauthorized" }, 401);
      }

      const result = await runIngestion(env);
      return json(result, result.status === "success" ? 202 : 500);
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

    return json({ status: "failed", message: "Not Found" }, 404);
  },
};

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
      await sendFailureAlert(env, `Fantasy402 ingestion run ${runId} had ${endpointsFailed} endpoint failure(s).`);
    }

    return { runId, status, endpointsSucceeded, endpointsFailed };
  } catch (error) {
    await finishRun(env, runId, "failed", endpointsSucceeded, endpointsFailed, errorMessage(error));
    await sendFailureAlert(env, `Fantasy402 ingestion run ${runId} failed: ${errorMessage(error)}`);
    throw error;
  }
}

async function getOrRefreshSession(env: Env): Promise<string> {
  const cached = await env.SESSION_KV.get<SessionRecord>(SESSION_KEY, "json");
  if (cached && cached.expiresAt > Date.now() + 60_000 && cached.cookie.length > 0) {
    return cached.cookie;
  }

  const form = new URLSearchParams();
  form.set("username", env.FANTASY402_USERNAME);
  form.set("password", env.FANTASY402_PASSWORD);

  const response = await fetchWithTimeout(`${baseUrl(env)}/cloud/api/Auth/login`, {
    method: "POST",
    body: form,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Fantasy402-Ingestion-Worker/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Fantasy402 login failed with HTTP ${response.status}`);
  }

  const cookie = extractSessionCookie(response.headers);
  const session: SessionRecord = {
    cookie,
    expiresAt: Date.now() + DEFAULT_SESSION_TTL_SECONDS * 1000,
  };

  await env.SESSION_KV.put(SESSION_KEY, JSON.stringify(session), {
    expirationTtl: DEFAULT_SESSION_TTL_SECONDS,
  });

  return cookie;
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
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(endpoint.buildBody(env, now))) {
    form.set(key, String(value));
  }

  const response = await fetchWithTimeout(`${baseUrl(env)}${endpoint.path}`, {
    method: "POST",
    body: form,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: sessionCookie,
      "User-Agent": "Fantasy402-Ingestion-Worker/1.0",
    },
  });

  if (!response.ok) {
    throw new UpstreamHttpError(endpoint, response.status);
  }

  return response;
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
  });
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
  });
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

async function sendFailureAlert(env: Env, message: string): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) {
    console.error("ingestion alert", message);
    return;
  }

  await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
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

function extractSessionCookie(headers: Headers): string {
  const setCookie = headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.trim().split(";")[0] ?? "")
    .find((cookie) => cookie.length > 0);

  if (!sessionCookie) {
    throw new Error("Fantasy402 login response did not include a session cookie");
  }

  return sessionCookie;
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
  const prefix = normalizeArchivePrefix(url.searchParams.get("prefix") ?? R2_ARCHIVE_PREFIX);
  const limit = clampInteger(Number(url.searchParams.get("limit") ?? "50"), 1, 1000);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const listed = await env.RAW_ARCHIVE.list(cursor ? { prefix, limit, cursor } : { prefix, limit });

  return json(
    {
      objects: listed.objects.map((object) => ({
        key: object.key,
        etag: object.etag,
        size: object.size,
        uploaded: object.uploaded.toISOString(),
        storageClass: object.storageClass,
        httpMetadata: object.httpMetadata ?? {},
        customMetadata: object.customMetadata ?? {},
      })),
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    },
    200,
  );
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

function archiveKey(endpointSegment: string, date: string, id: string): string {
  return `${R2_ARCHIVE_PREFIX}/${endpointSegment}/${date}/${id}.json`;
}

function normalizeArchivePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+/, "");
  if (trimmed === R2_ARCHIVE_PREFIX || trimmed.startsWith(`${R2_ARCHIVE_PREFIX}/`)) return trimmed;
  return R2_ARCHIVE_PREFIX;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isAuthorized(request: Request, env: Env): boolean {
  return request.headers.get("Authorization") === `Bearer ${env.INGESTION_TRIGGER_TOKEN}`;
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

function safeError(error: unknown, context: Record<string, string>): Record<string, string> {
  return {
    ...context,
    message: errorMessage(error),
  };
}
