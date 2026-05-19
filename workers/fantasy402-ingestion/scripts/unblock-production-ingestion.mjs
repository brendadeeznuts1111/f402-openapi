import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  authShape,
  isPlaceholderToken,
  parseBrowserCurl,
  readBrowserCurlInput,
  readTokenFile,
  refreshPayload,
  validateBrowserAuthPayload,
} from "./browser-auth-utils.mjs";
import { callWorkerJson, requireOperatorTokenUnlessProxy } from "./proxy-client-utils.mjs";

const defaultOrigin = "https://fantasy402-ingestion.utahj4754.workers.dev";

export async function runUnblockProductionIngestion(options = {}) {
  const inputPath = options.inputPath ?? process.env.FANTASY402_BROWSER_CURL_FILE ?? "fantasy402/browser-request.curl";
  const outputPath = options.outputPath ?? process.env.FANTASY402_BROWSER_AUTH_FILE ?? "fantasy402/browser-auth.json";
  const workerOrigin = options.workerOrigin ?? process.env.WORKER_ORIGIN ?? defaultOrigin;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const operatorToken = options.operatorToken ?? process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN ?? readTokenFile();

  requireOperatorTokenUnlessProxy(operatorToken, workerOrigin);
  if (operatorToken && isPlaceholderToken(operatorToken)) {
    throw new Error("INGESTION_TRIGGER_TOKEN/ARCHIVE_AUTH_TOKEN looks like a placeholder. Use the real operator bearer token or omit the env var so .archive-auth-token can be used.");
  }

  const curl = options.curlText ?? readBrowserCurlInput(inputPath);
  const imported = parseBrowserCurl(curl);
  validateBrowserAuthPayload(imported, inputPath);

  if (options.writeAuthFile !== false) {
    fs.mkdirSync(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true, mode: 0o700 });
    fs.writeFileSync(outputPath, `${JSON.stringify(imported, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(outputPath, 0o600);
  }

  const refresh = await callWorkerJson(fetchImpl, workerOrigin, operatorToken, "/refresh-auth", {
    method: "POST",
    body: refreshPayload(imported),
    expectedStatuses: [200],
  });

  const diagnostics = await callWorkerJson(fetchImpl, workerOrigin, operatorToken, "/diagnostics", {
    method: "GET",
    expectedStatuses: [200],
  });
  assertDiagnosticsReady(diagnostics.body);

  const trigger = await callWorkerJson(fetchImpl, workerOrigin, operatorToken, "/trigger", {
    method: "POST",
    expectedStatuses: [202, 500],
  });

  const runId = typeof trigger.body?.runId === "string" ? trigger.body.runId : "";
  const runEndpoints = runId
    ? await callWorkerJson(fetchImpl, workerOrigin, operatorToken, `/runs/endpoints?runId=${encodeURIComponent(runId)}`, {
        method: "GET",
        expectedStatuses: [200],
      })
    : { httpStatus: null, body: { runId: "", snapshots: [], failures: [] } };

  const summary = {
    status: trigger.httpStatus === 202 && trigger.body?.status === "success" ? "ok" : "trigger-failed",
    workerOrigin: String(workerOrigin).replace(/\/$/, ""),
    importedAuth: {
      input: inputPath,
      output: options.writeAuthFile === false ? null : outputPath,
      sourcePath: imported.sourcePath ?? null,
      sourceOperation: imported.sourceOperation ?? null,
      sourceContentType: imported.sourceContentType ?? null,
      ...authShape(imported),
    },
    authRefresh: {
      accepted: Array.isArray(refresh.body?.accepted) ? refresh.body.accepted : [],
      expiresAt: refresh.body?.expiresAt ?? null,
      ttlSeconds: refresh.body?.ttlSeconds ?? null,
    },
    diagnostics: {
      status: diagnostics.body?.status ?? null,
      ingestionReadiness: diagnostics.body?.upstreamAuthShape?.ingestionReadiness ?? null,
    },
    trigger: sanitizeTrigger(trigger),
    runEndpoints: sanitizeRunEndpoints(runEndpoints.body),
  };

  return summary;
}

export function assertDiagnosticsReady(body) {
  const status = body?.status;
  const readiness = body?.upstreamAuthShape?.ingestionReadiness;
  if (status !== "ready" || readiness?.status !== "ready") {
    const blocker = readiness?.blocker ?? "unknown upstream auth blocker";
    throw new Error(`Worker diagnostics are not ingestion-ready: status=${JSON.stringify(status)}, upstream=${JSON.stringify(readiness?.status)}, blocker=${blocker}`);
  }
}

function sanitizeTrigger(result) {
  const body = result.body && typeof result.body === "object" ? result.body : {};
  return {
    httpStatus: result.httpStatus,
    runId: body.runId ?? null,
    status: body.status ?? null,
    endpointsSucceeded: body.endpointsSucceeded ?? null,
    endpointsFailed: body.endpointsFailed ?? null,
    message: body.message ?? null,
  };
}

function sanitizeRunEndpoints(body) {
  return {
    runId: body?.runId ?? null,
    snapshots: Array.isArray(body?.snapshots) ? body.snapshots.map(sanitizeSnapshot) : [],
    failures: Array.isArray(body?.failures) ? body.failures.map(sanitizeFailure) : [],
  };
}

function sanitizeSnapshot(row) {
  return {
    id: row.id ?? null,
    endpoint_key: row.endpoint_key ?? null,
    path: row.path ?? null,
    captured_at: row.captured_at ?? null,
    http_status: row.http_status ?? null,
    item_count: row.item_count ?? null,
    attempts: row.attempts ?? null,
    r2_key: row.r2_key ?? null,
    trace_id: row.trace_id ?? null,
    duration_ms: row.duration_ms ?? null,
  };
}

function sanitizeFailure(row) {
  return {
    id: row.id ?? null,
    endpoint_key: row.endpoint_key ?? null,
    path: row.path ?? null,
    failed_at: row.failed_at ?? null,
    attempts: row.attempts ?? null,
    error_message: row.error_message ?? null,
    r2_key: row.r2_key ?? null,
    trace_id: row.trace_id ?? null,
    duration_ms: row.duration_ms ?? null,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = await runUnblockProductionIngestion({ inputPath: process.argv[2] ?? undefined });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.status !== "ok") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", message: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}
