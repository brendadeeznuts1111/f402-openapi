import type { Env } from "./index";
import { summarizeHar, type HarNetworkSummary } from "./har-summary";

const URL_SCANNER_BASE = "https://api.cloudflare.com/client/v4";
const SCANNER_STORAGE_CLASS = "InfrequentAccess";
const SCANNER_PREFIX = "fantasy402";

interface ScanTask {
  uuid: string;
  url: string;
  time: string;
  success?: boolean;
  failureReason?: string;
}

export interface ScanResult {
  uuid?: string;
  task: ScanTask;
  networkSummary?: HarNetworkSummary;
  verdicts?: {
    overall?: {
      malicious?: boolean;
      categories?: string[];
      tags?: string[];
    };
  };
  page?: {
    tlsValidDays?: number;
    tlsIssuer?: string;
    title?: string;
  };
  meta?: {
    processors?: {
      agentReadiness?: { level?: number };
    };
  };
}

interface PendingScanResponse {
  message?: string;
  task?: {
    status?: string;
  };
  errors?: Array<{
    title?: string;
    detail?: string;
    status?: number;
  }>;
}

interface SubmitOptions {
  agentReadiness?: boolean;
  screenshots?: string[];
}

interface ArchiveKeys {
  scanR2Key: string;
  screenshotR2Key: string | null;
  harR2Key: string | null;
  harSummary: HarNetworkSummary | null;
}

interface CloudflareApiErrorDetail {
  code?: number;
  message?: string;
}

interface CloudflareApiMessage {
  code?: number;
  message?: string;
}

interface CloudflareDiagnosticStage {
  stage: string;
  method: string;
  path: string;
  httpStatus: number | null;
  success: boolean;
  errors: CloudflareApiMessage[];
  messages: CloudflareApiMessage[];
}

export interface UrlScannerDiagnostic {
  status: "ready" | "degraded";
  subsystem: "cloudflare-url-scanner";
  accountId: string;
  tokenShape: {
    configured: boolean;
    length: number;
    trimmedLength: number;
    asciiOnly: boolean;
    hasWhitespace: boolean;
    hasLeadingOrTrailingWhitespace: boolean;
    looksLikeFormattedOutput: boolean;
  };
  checks: CloudflareDiagnosticStage[];
  failure: {
    stage: string;
    code: number | null;
    message: string;
  } | null;
}

export class UrlScannerApiError extends Error {
  readonly stage: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly code: number | null;
  readonly apiMessage: string;
  readonly retryable: boolean;

  constructor(stage: string, method: string, path: string, status: number, errors: CloudflareApiErrorDetail[], body: string) {
    const first = errors[0];
    const apiMessage = first?.message || body.slice(0, 500) || "unknown Cloudflare API error";
    super(`URL Scanner ${stage} failed with HTTP ${status}: ${apiMessage}`);
    this.stage = stage;
    this.method = method;
    this.path = path;
    this.status = status;
    this.code = typeof first?.code === "number" ? first.code : null;
    this.apiMessage = apiMessage;
    this.retryable = status === 429 || status >= 500;
  }
}

export async function submitAndWait(url: string, env: Env, options: SubmitOptions = {}): Promise<ScanResult> {
  console.log("[URL Scanner] submitAndWait started", { url, screenshots: options.screenshots ?? ["desktop", "mobile"] });
  const scanId = await submitScan(url, env, options);
  console.log("[URL Scanner] scan submitted", { url, scanId });
  const result = await pollScanResult(scanId, env);
  console.log("[URL Scanner] scan result ready", {
    scanId,
    url: result.task.url,
    malicious: Boolean(result.verdicts?.overall?.malicious),
    tlsValidDays: result.page?.tlsValidDays ?? null,
  });
  const archiveKeys = await archiveScanArtifacts(result, env, options.screenshots ?? ["desktop", "mobile"]);
  console.log("[URL Scanner] scan artifacts archived", { scanId, ...archiveKeys });
  await storeVerdict(result, env, archiveKeys);
  console.log("[URL Scanner] verdict stored", { scanId, url: result.task.url });
  if (archiveKeys.harSummary) {
    result.networkSummary = archiveKeys.harSummary;
    await storeNetworkSummary(scanId, archiveKeys.harR2Key, archiveKeys.harSummary, env);
    console.log("[URL Scanner] network summary stored", { scanId, totalRequests: archiveKeys.harSummary.totalRequests });
  }
  return result;
}

export async function diagnoseUrlScanner(env: Env): Promise<UrlScannerDiagnostic> {
  const token = env.CLOUDFLARE_API_TOKEN ?? "";
  const tokenShape = cloudflareTokenShape(token);
  const checks: CloudflareDiagnosticStage[] = [];
  console.log("[URL Scanner] diagnostics started", {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    tokenConfigured: tokenShape.configured,
    tokenLength: tokenShape.length,
    tokenTrimmedLength: tokenShape.trimmedLength,
    tokenAsciiOnly: tokenShape.asciiOnly,
    tokenHasWhitespace: tokenShape.hasWhitespace,
    tokenLooksLikeFormattedOutput: tokenShape.looksLikeFormattedOutput,
  });

  if (!tokenShape.configured) {
    return {
      status: "degraded",
      subsystem: "cloudflare-url-scanner",
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      tokenShape,
      checks,
      failure: {
        stage: "configuration",
        code: null,
        message: "CLOUDFLARE_API_TOKEN is not configured",
      },
    };
  }

  if (tokenShape.looksLikeFormattedOutput || tokenShape.hasLeadingOrTrailingWhitespace) {
    return {
      status: "degraded",
      subsystem: "cloudflare-url-scanner",
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      tokenShape,
      checks,
      failure: {
        stage: "token-shape",
        code: null,
        message: tokenShape.looksLikeFormattedOutput
          ? "CLOUDFLARE_API_TOKEN looks like formatted CLI/table output, not a raw API token"
          : "CLOUDFLARE_API_TOKEN has leading or trailing whitespace",
      },
    };
  }

  const tokenVerify = await cloudflareDiagnosticFetch(
    "token-verify",
    "GET",
    `/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/tokens/verify`,
    env,
  );
  checks.push(tokenVerify);
  if (!tokenVerify.success) {
    return cloudflareDiagnosticResult(env, tokenShape, checks);
  }

  checks.push(await cloudflareDiagnosticFetch("url-scanner-access", "GET", scannerUrl(env, "/urlscanner/v2/search?size=1&q=apikey:me"), env));
  return cloudflareDiagnosticResult(env, tokenShape, checks);
}

async function submitScan(url: string, env: Env, options: SubmitOptions): Promise<string> {
  const body: Record<string, unknown> = {
    url,
    visibility: "unlisted",
    screenshotsResolutions: options.screenshots ?? ["desktop", "mobile"],
  };
  if (options.agentReadiness !== undefined) {
    body.agentReadiness = options.agentReadiness;
  }

  const path = "/urlscanner/v2/scan";
  console.log("[URL Scanner] submitting scan", { path, url, accountId: env.CLOUDFLARE_ACCOUNT_ID });
  const response = await fetch(scannerUrl(env, path), {
    method: "POST",
    headers: scannerHeaders(env, true),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await scannerApiError("submission", "POST", path, response);
  }

  const payload = await response.json<unknown>();
  const scanId = scanIdFromSubmission(payload);
  if (!scanId) {
    console.error("[URL Scanner] submission response missing scan uuid", { shape: describeJsonShape(payload) });
    throw new Error("URL Scanner submission response did not include a scan uuid");
  }

  return scanId;
}

async function pollScanResult(scanId: string, env: Env, maxAttempts = 30): Promise<ScanResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const path = `/urlscanner/v2/result/${encodeURIComponent(scanId)}`;
    console.log("[URL Scanner] polling scan result", { scanId, attempt, maxAttempts, path });
    const response = await fetch(scannerUrl(env, path), {
      headers: scannerHeaders(env),
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 404 && isPendingScanResponse(body)) {
        console.log("[URL Scanner] scan still pending", { scanId, attempt, maxAttempts });
        await sleep(2000);
        continue;
      }
      throw scannerApiErrorFromBody("poll", "GET", path, response.status, body);
    }

    const payload = await response.json<unknown>();
    const result = scanResultFromPayload(payload);
    if (result?.task?.success === true) {
      console.log("[URL Scanner] poll completed", { scanId, attempt });
      return result;
    }
    if (result?.task?.success === false) {
      throw new Error(`URL Scanner scan failed: ${result.task.failureReason ?? "unknown failure"}`);
    }

    await sleep(2000);
  }

  throw new Error(`URL Scanner scan ${scanId} timed out after ${maxAttempts} attempts`);
}

function scanIdFromSubmission(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.uuid === "string") return payload.uuid;
  if (isRecord(payload.result) && typeof payload.result.uuid === "string") return payload.result.uuid;
  if (isRecord(payload.result) && isRecord(payload.result.task) && typeof payload.result.task.uuid === "string") {
    return payload.result.task.uuid;
  }
  return null;
}

function scanResultFromPayload(payload: unknown): ScanResult | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.task)) return payload as unknown as ScanResult;
  if (isRecord(payload.result) && isRecord(payload.result.task)) return payload.result as unknown as ScanResult;
  return undefined;
}

function describeJsonShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => describeJsonShape(item)).slice(0, 5);
  if (!isRecord(value)) return typeof value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, isRecord(child) ? describeJsonShape(child) : typeof child]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function archiveScanArtifacts(result: ScanResult, env: Env, resolutions: string[]): Promise<ArchiveKeys> {
  const scanId = scanIdFromResult(result);
  const date = new Date(result.task.time || Date.now()).toISOString().slice(0, 10);
  const scanR2Key = `${SCANNER_PREFIX}/scans/${date}/${scanId}.json`;
  const serialized = JSON.stringify(result, null, 2);

  console.log("[URL Scanner] archiving scan result", { scanId, key: scanR2Key, size: serialized.length });
  await env.RAW_ARCHIVE.put(scanR2Key, serialized, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store, max-age=0",
    },
    customMetadata: {
      source: "cloudflare-url-scanner",
      archiveType: "scan-result",
      scanId,
      url: result.task.url,
      malicious: String(result.verdicts?.overall?.malicious ?? false),
      tlsValidDays: String(result.page?.tlsValidDays ?? ""),
      size: String(serialized.length),
    },
    storageClass: SCANNER_STORAGE_CLASS,
  });

  let screenshotR2Key: string | null = null;
  for (const resolution of resolutions) {
    const key = await archiveScreenshot(scanId, resolution, env);
    screenshotR2Key ??= key;
  }

  const harArchive = await archiveHar(scanId, env);
  return { scanR2Key, screenshotR2Key, harR2Key: harArchive.key, harSummary: harArchive.summary };
}

async function archiveScreenshot(scanId: string, resolution: string, env: Env): Promise<string | null> {
  const path = `/urlscanner/v2/screenshots/${encodeURIComponent(scanId)}.png?resolution=${encodeURIComponent(resolution)}`;
  const response = await fetch(scannerUrl(env, path), {
    headers: scannerHeaders(env),
  });
  if (!response.ok) {
    console.warn("[URL Scanner] screenshot unavailable", { scanId, resolution, status: response.status, path });
    return null;
  }

  const bytes = await response.arrayBuffer();
  const key = `${SCANNER_PREFIX}/screenshots/${scanId}_${resolution}.png`;
  console.log("[URL Scanner] archiving screenshot", { scanId, resolution, key, size: bytes.byteLength });
  await env.RAW_ARCHIVE.put(key, bytes, {
    httpMetadata: {
      contentType: "image/png",
      cacheControl: "no-store, max-age=0",
    },
    customMetadata: {
      source: "cloudflare-url-scanner",
      archiveType: "scan-screenshot",
      scanId,
      resolution,
      size: String(bytes.byteLength),
    },
    storageClass: SCANNER_STORAGE_CLASS,
  });
  return key;
}

async function archiveHar(scanId: string, env: Env): Promise<{ key: string | null; summary: HarNetworkSummary | null }> {
  const path = `/urlscanner/v2/har/${encodeURIComponent(scanId)}`;
  const response = await fetch(scannerUrl(env, path), {
    headers: scannerHeaders(env),
  });
  if (!response.ok) {
    console.warn("[URL Scanner] HAR unavailable", { scanId, status: response.status, path });
    return { key: null, summary: null };
  }

  const body = await response.text();
  const key = `${SCANNER_PREFIX}/hars/${scanId}.har`;
  let summary: HarNetworkSummary | null = null;
  try {
    summary = summarizeHar(JSON.parse(body));
  } catch (error) {
    console.warn("[URL Scanner] HAR summary unavailable", { scanId, key, message: errorMessage(error) });
  }
  console.log("[URL Scanner] archiving HAR", { scanId, key, size: body.length });
  await env.RAW_ARCHIVE.put(key, body, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store, max-age=0",
    },
    customMetadata: {
      source: "cloudflare-url-scanner",
      archiveType: "scan-har",
      scanId,
      size: String(body.length),
    },
    storageClass: SCANNER_STORAGE_CLASS,
  });
  return { key, summary };
}

async function storeVerdict(result: ScanResult, env: Env, archiveKeys: ArchiveKeys): Promise<void> {
  const scanId = scanIdFromResult(result);
  console.log("[URL Scanner] storing verdict", {
    scanId,
    url: result.task.url,
    malicious: Boolean(result.verdicts?.overall?.malicious),
    tlsValidDays: result.page?.tlsValidDays ?? null,
  });
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO scans_verdicts
       (scan_id, timestamp, url, malicious, tls_valid_days, agent_readiness_level,
        scan_r2_key, screenshot_r2_key, har_r2_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scan_id) DO UPDATE SET
       timestamp = excluded.timestamp,
       url = excluded.url,
       malicious = excluded.malicious,
       tls_valid_days = excluded.tls_valid_days,
       agent_readiness_level = excluded.agent_readiness_level,
       scan_r2_key = excluded.scan_r2_key,
       screenshot_r2_key = excluded.screenshot_r2_key,
       har_r2_key = excluded.har_r2_key`,
  )
    .bind(
      scanId,
      result.task.time,
      result.task.url,
      result.verdicts?.overall?.malicious ? 1 : 0,
      result.page?.tlsValidDays ?? null,
      result.meta?.processors?.agentReadiness?.level ?? null,
      archiveKeys.scanR2Key,
      archiveKeys.screenshotR2Key,
      archiveKeys.harR2Key,
    )
    .run();
}

async function storeNetworkSummary(scanId: string, harR2Key: string | null, summary: HarNetworkSummary, env: Env): Promise<void> {
  await env.ANALYTICS_DB.prepare(
    `INSERT INTO scan_network_summary
       (scan_id, updated_at, total_requests, status_counts_json, method_counts_json,
        host_counts_json, mime_counts_json, failed_count, failed_requests_json,
        slowest_requests_json, largest_responses_json, har_r2_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scan_id) DO UPDATE SET
       updated_at = excluded.updated_at,
       total_requests = excluded.total_requests,
       status_counts_json = excluded.status_counts_json,
       method_counts_json = excluded.method_counts_json,
       host_counts_json = excluded.host_counts_json,
       mime_counts_json = excluded.mime_counts_json,
       failed_count = excluded.failed_count,
       failed_requests_json = excluded.failed_requests_json,
       slowest_requests_json = excluded.slowest_requests_json,
       largest_responses_json = excluded.largest_responses_json,
       har_r2_key = excluded.har_r2_key`,
  )
    .bind(
      scanId,
      new Date().toISOString(),
      summary.totalRequests,
      JSON.stringify(summary.byStatus),
      JSON.stringify(summary.byMethod),
      JSON.stringify(summary.byHost),
      JSON.stringify(summary.byMimeType),
      summary.failedRequests.length,
      JSON.stringify(summary.failedRequests),
      JSON.stringify(summary.slowestRequests),
      JSON.stringify(summary.largestResponses),
      harR2Key,
    )
    .run();
}

async function scannerApiError(stage: string, method: string, path: string, response: Response): Promise<UrlScannerApiError> {
  const body = await response.text();
  return scannerApiErrorFromBody(stage, method, path, response.status, body);
}

function scannerApiErrorFromBody(stage: string, method: string, path: string, status: number, body: string): UrlScannerApiError {
  let errors: CloudflareApiErrorDetail[] = [];
  try {
    const parsed = JSON.parse(body) as { errors?: CloudflareApiErrorDetail[] };
    errors = parsed.errors ?? [];
  } catch {
    errors = [];
  }
  const error = new UrlScannerApiError(stage, method, path, status, errors, body);
  console.error("[URL Scanner] Cloudflare API error", {
    stage: error.stage,
    method: error.method,
    path: error.path,
    status: error.status,
    code: error.code,
    message: error.apiMessage,
    retryable: error.retryable,
  });
  return error;
}

function isPendingScanResponse(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as PendingScanResponse;
    const status = parsed.task?.status?.toLowerCase();
    return parsed.message === "Scan is not finished yet" || status === "queued" || status === "running" || status === "processing";
  } catch {
    return false;
  }
}

async function cloudflareDiagnosticFetch(stage: string, method: string, path: string, env: Env): Promise<CloudflareDiagnosticStage> {
  try {
    const url = path.startsWith("https://") ? path : `${URL_SCANNER_BASE}${path}`;
    const response = await fetch(url, {
      method,
      headers: scannerHeaders(env),
    });
    const body = await response.text();
    const parsed = parseCloudflareEnvelope(body);
    const result = {
      stage,
      method,
      path,
      httpStatus: response.status,
      success: response.ok && parsed.success !== false,
      errors: parsed.errors,
      messages: parsed.messages,
    };
    console.log("[URL Scanner] diagnostics check completed", {
      stage,
      method,
      path,
      status: result.httpStatus,
      success: result.success,
      firstErrorCode: result.errors[0]?.code ?? null,
      firstErrorMessage: result.errors[0]?.message ?? null,
    });
    return result;
  } catch (error) {
    const result = {
      stage,
      method,
      path,
      httpStatus: null,
      success: false,
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
      messages: [],
    };
    console.error("[URL Scanner] diagnostics check failed before HTTP response", result);
    return result;
  }
}

function cloudflareDiagnosticResult(
  env: Env,
  tokenShape: UrlScannerDiagnostic["tokenShape"],
  checks: CloudflareDiagnosticStage[],
): UrlScannerDiagnostic {
  const failed = checks.find((check) => !check.success);
  return {
    status: failed ? "degraded" : "ready",
    subsystem: "cloudflare-url-scanner",
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    tokenShape,
    checks,
    failure: failed
      ? {
          stage: failed.stage,
          code: typeof failed.errors[0]?.code === "number" ? failed.errors[0].code : null,
          message: failed.errors[0]?.message ?? `Cloudflare ${failed.stage} check failed`,
        }
      : null,
  };
}

function cloudflareTokenShape(token: string): UrlScannerDiagnostic["tokenShape"] {
  return {
    configured: token.trim().length > 0,
    length: token.length,
    trimmedLength: token.trim().length,
    asciiOnly: /^[\x20-\x7E]*$/.test(token),
    hasWhitespace: /\s/.test(token),
    hasLeadingOrTrailingWhitespace: token.length !== token.trim().length,
    looksLikeFormattedOutput: /[│┌┐└┘─]|Secret name|Value encrypted|Services|Workers/i.test(token),
  };
}

function parseCloudflareEnvelope(body: string): { success?: boolean; errors: CloudflareApiMessage[]; messages: CloudflareApiMessage[] } {
  try {
    const parsed = JSON.parse(body) as { success?: boolean; errors?: CloudflareApiMessage[]; messages?: CloudflareApiMessage[] };
    const envelope: { success?: boolean; errors: CloudflareApiMessage[]; messages: CloudflareApiMessage[] } = {
      errors: parsed.errors ?? [],
      messages: parsed.messages ?? [],
    };
    if (typeof parsed.success === "boolean") {
      envelope.success = parsed.success;
    }
    return envelope;
  } catch {
    return {
      errors: [{ message: body.slice(0, 500) || "non-JSON Cloudflare response" }],
      messages: [],
    };
  }
}

function scannerUrl(env: Env, path: string): string {
  return `${URL_SCANNER_BASE}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`;
}

function scannerHeaders(env: Env, jsonBody = false): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
  };
  if (jsonBody) headers["Content-Type"] = "application/json";
  return headers;
}

function scanIdFromResult(result: ScanResult): string {
  const scanId = result.task.uuid || result.uuid;
  if (!scanId) throw new Error("URL Scanner result did not include a scan uuid");
  return scanId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
