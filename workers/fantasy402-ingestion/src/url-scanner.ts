import type { Env } from "./index";

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

interface SubmitOptions {
  agentReadiness?: boolean;
  screenshots?: string[];
}

interface ArchiveKeys {
  scanR2Key: string;
  screenshotR2Key: string | null;
  harR2Key: string | null;
}

export async function submitAndWait(url: string, env: Env, options: SubmitOptions = {}): Promise<ScanResult> {
  const scanId = await submitScan(url, env, options);
  const result = await pollScanResult(scanId, env);
  const archiveKeys = await archiveScanArtifacts(result, env, options.screenshots ?? ["desktop", "mobile"]);
  await storeVerdict(result, env, archiveKeys);
  return result;
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

  const response = await fetch(scannerUrl(env, "/urlscanner/v2/scan"), {
    method: "POST",
    headers: scannerHeaders(env, true),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`URL Scanner submission failed with HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json<{ result?: { uuid?: string } }>();
  if (!payload.result?.uuid) {
    throw new Error("URL Scanner submission response did not include a scan uuid");
  }

  return payload.result.uuid;
}

async function pollScanResult(scanId: string, env: Env, maxAttempts = 30): Promise<ScanResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(scannerUrl(env, `/urlscanner/v2/result/${encodeURIComponent(scanId)}`), {
      headers: scannerHeaders(env),
    });

    if (!response.ok) {
      throw new Error(`URL Scanner poll failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json<{ result?: ScanResult }>();
    const result = payload.result;
    if (result?.task?.success === true) return result;
    if (result?.task?.success === false) {
      throw new Error(`URL Scanner scan failed: ${result.task.failureReason ?? "unknown failure"}`);
    }

    await sleep(2000);
  }

  throw new Error(`URL Scanner scan ${scanId} timed out after ${maxAttempts} attempts`);
}

async function archiveScanArtifacts(result: ScanResult, env: Env, resolutions: string[]): Promise<ArchiveKeys> {
  const scanId = scanIdFromResult(result);
  const date = new Date(result.task.time || Date.now()).toISOString().slice(0, 10);
  const scanR2Key = `${SCANNER_PREFIX}/scans/${date}/${scanId}.json`;
  const serialized = JSON.stringify(result, null, 2);

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

  const harR2Key = await archiveHar(scanId, env);
  return { scanR2Key, screenshotR2Key, harR2Key };
}

async function archiveScreenshot(scanId: string, resolution: string, env: Env): Promise<string | null> {
  const response = await fetch(scannerUrl(env, `/urlscanner/v2/screenshots/${encodeURIComponent(scanId)}.png?resolution=${encodeURIComponent(resolution)}`), {
    headers: scannerHeaders(env),
  });
  if (!response.ok) return null;

  const bytes = await response.arrayBuffer();
  const key = `${SCANNER_PREFIX}/screenshots/${scanId}_${resolution}.png`;
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

async function archiveHar(scanId: string, env: Env): Promise<string | null> {
  const response = await fetch(scannerUrl(env, `/urlscanner/v2/har/${encodeURIComponent(scanId)}`), {
    headers: scannerHeaders(env),
  });
  if (!response.ok) return null;

  const body = await response.text();
  const key = `${SCANNER_PREFIX}/hars/${scanId}.har`;
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
  return key;
}

async function storeVerdict(result: ScanResult, env: Env, archiveKeys: ArchiveKeys): Promise<void> {
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
      scanIdFromResult(result),
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
