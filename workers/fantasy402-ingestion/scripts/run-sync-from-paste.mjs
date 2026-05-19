import {
  parseBrowserCurl,
  validateBrowserAuthPayload,
  refreshPayload,
  readTokenFile,
} from "./browser-auth-utils.mjs";
import { callWorkerJson, requireOperatorTokenUnlessProxy } from "./proxy-client-utils.mjs";

const fetchText = process.argv[2];
if (!fetchText) {
  console.error("Usage: run-sync-from-paste.mjs '<fetch snippet>'");
  process.exit(1);
}

const imported = parseBrowserCurl(fetchText);
validateBrowserAuthPayload(imported, "paste");

const origin = process.env.WORKER_ORIGIN ?? "https://fantasy402-ingestion.utahj4754.workers.dev";
const token = process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN ?? readTokenFile();
requireOperatorTokenUnlessProxy(token, origin);

const payload = { ...refreshPayload(imported), refresh: true, trigger: true };

const sync = await callWorkerJson(globalThis.fetch, origin, token, "/ingest/sync", {
  method: "POST",
  body: payload,
  expectedStatuses: [200, 202, 500],
});
const body = sync.body;

console.log("HTTP", sync.httpStatus);
console.log(JSON.stringify({
  auth: {
    mode: body.auth?.mode,
    accepted: body.auth?.accepted,
    expiresAt: body.auth?.expiresAt,
  },
  ingestion: body.ingestion,
  plan: body.plan
    ? {
        batching: body.plan.batching,
        cursor: body.plan.cursor,
        batchSize: body.plan.batchSize,
        catalogSize: body.plan.catalogSize,
        keys: body.plan.keys?.slice(0, 5),
      }
    : null,
  stage: body.stage,
  message: body.message,
}, null, 2));

if (body.ingestion?.runId) {
  const run = await callWorkerJson(
    globalThis.fetch,
    origin,
    token,
    `/runs/endpoints?runId=${encodeURIComponent(body.ingestion.runId)}`,
    { method: "GET" },
  );
  const runBody = run.body;
  console.log("\nRUN ENDPOINTS:");
  console.log("snapshots:", runBody.snapshots?.length ?? 0);
  console.log("failures:", runBody.failures?.length ?? 0);
  if (runBody.snapshots?.length) {
    console.log("OK:", runBody.snapshots.map((s) => s.endpoint_key).join(", "));
  }
  if (runBody.failures?.length) {
    console.log("FAILED:", runBody.failures.map((f) => `${f.endpoint_key} (${f.http_status})`).join(", "));
  }
}

const diag = await fetch(`${origin}/diagnostics`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
});
const diagBody = await diag.json();
console.log("\nDIAGNOSTICS:", diagBody.status, "| ingestion readiness:", diagBody.upstreamAuthShape?.ingestionReadiness?.status);
