import fs from "node:fs";

const origin = new URL(process.env.WORKER_ORIGIN ?? "https://fantasy402-ingestion.utahj4754.workers.dev");
const token = process.env.INGESTION_TRIGGER_TOKEN || process.env.ARCHIVE_AUTH_TOKEN || readTokenFile();
const results = [];

await check("health", "/health?smoke=1", { status: 200, includes: '"worker":"ok"' });
await check("viewer", "/archive/viewer", { status: 200, includes: "Fantasy402 Archive Viewer" });

for (const route of [
  ["GET", "/alerts?limit=1"],
  ["POST", "/alerts/policy-test"],
  ["GET", "/alerts/summary?days=1"],
  ["POST", "/alerts/test"],
  ["GET", "/archive?prefix=fantasy402/&limit=1"],
  ["GET", "/archive/object"],
  ["GET", "/diagnostics"],
  ["POST", "/ingest/local"],
  ["POST", "/refresh-auth"],
  ["GET", "/runs?limit=1"],
  ["GET", "/runs/endpoints?runId=00000000-0000-4000-8000-000000000000"],
  ["GET", "/scanner/diagnostics"],
  ["GET", "/scans?limit=1"],
  ["GET", "/scans/detail"],
  ["GET", "/scans/export"],
  ["GET", "/scans/har"],
  ["GET", "/scans/network-diff"],
  ["GET", "/scans/network-summary"],
  ["GET", "/scans/screenshot"],
  ["GET", "/scans/summary?days=1"],
  ["POST", "/scans/trigger"],
  ["POST", "/trigger"],
  ["POST", "/trigger-scan"],
]) {
  await check(`${route[0]} ${route[1]} unauthenticated`, route[1], {
    method: route[0],
    status: 401,
    includes: "Unauthorized",
  });
}

if (token) {
  await check("diagnostics authenticated", "/diagnostics", {
    status: 200,
    includes: '"bindings"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (body.status !== "ready") findings.push(`expected diagnostics status ready, got ${JSON.stringify(body.status)}`);
      if (body.auth?.configured !== true) findings.push("operator auth is not configured");
      if (Array.isArray(body.requiredSecrets?.missing) && body.requiredSecrets.missing.length > 0) {
        findings.push(`missing required secrets: ${body.requiredSecrets.missing.join(", ")}`);
      }
      if (body.upstreamAuthShape?.ingestionReadiness?.status !== "ready") {
        findings.push(`upstream auth is not ingestion-ready: ${body.upstreamAuthShape?.ingestionReadiness?.blocker ?? "unknown blocker"}`);
      }
      for (const [binding, present] of Object.entries(body.bindings ?? {})) {
        if (present !== true) findings.push(`missing binding ${binding}`);
      }
      return findings;
    },
  });
  await check("alerts authenticated", "/alerts?limit=1", {
    status: 200,
    includes: '"events"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (!Array.isArray(body.events)) findings.push("expected events to be an array");
      if (!body.filters || typeof body.filters !== "object") findings.push("expected filters object");
      return findings;
    },
  });
  await check("alerts summary authenticated", "/alerts/summary?days=1", {
    status: 200,
    includes: '"total"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (typeof body.total !== "number") findings.push("expected total to be a number");
      if (!body.bySeverity || typeof body.bySeverity !== "object") findings.push("expected bySeverity object");
      if (!body.byType || typeof body.byType !== "object") findings.push("expected byType object");
      return findings;
    },
  });
  await check("archive authenticated", "/archive?prefix=fantasy402/&limit=5", {
    status: 200,
    includes: '"objects"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
  });
  await check("archive object validation authenticated", "/archive/object", {
    status: 400,
    includes: "Missing key",
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
  });
  const strictRuns = process.env.STRICT_RUNS_CHECK === "1" || process.env.STRICT_RUNS_CHECK === "true";
  await check("runs authenticated", "/runs?limit=1", {
    status: strictRuns ? 200 : [200, 404],
    includes: '"runs"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (!Array.isArray(body.runs)) findings.push("expected runs to be an array");
      if (typeof body.limit !== "number") findings.push("expected limit to be a number");
      return findings;
    },
  });
  await check("run endpoints authenticated", "/runs/endpoints?runId=00000000-0000-4000-8000-000000000000", {
    status: strictRuns ? 200 : [200, 404],
    includes: '"snapshots"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (!Array.isArray(body.snapshots)) findings.push("expected snapshots to be an array");
      if (!Array.isArray(body.failures)) findings.push("expected failures to be an array");
      return findings;
    },
  });
  await check("scans authenticated", "/scans?limit=1", {
    status: 200,
    includes: '"results"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (!Array.isArray(body.results)) findings.push("expected results to be an array");
      if (!body.filters || typeof body.filters !== "object") findings.push("expected filters object");
      return findings;
    },
  });
  await check("scans summary authenticated", "/scans/summary?days=1", {
    status: 200,
    includes: '"totals"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (!body.window || typeof body.window !== "object") findings.push("expected window object");
      if (!body.totals || typeof body.totals !== "object") findings.push("expected totals object");
      if (typeof body.status !== "string") findings.push("expected status string");
      return findings;
    },
  });
  for (const [name, path, expectedMessage] of [
    ["scan detail validation authenticated", "/scans/detail", "Missing scanId"],
    ["scan export validation authenticated", "/scans/export", "Missing scanId"],
    ["scan har validation authenticated", "/scans/har", "Missing scanId"],
    ["scan network diff validation authenticated", "/scans/network-diff", "Missing baseScanId or compareScanId"],
    ["scan network summary validation authenticated", "/scans/network-summary", "Missing scanId"],
    ["scan screenshot validation authenticated", "/scans/screenshot", "Missing scanId"],
  ]) {
    await check(name, path, {
      status: 400,
      includes: expectedMessage,
      headers: { Authorization: `Bearer ${token}` },
      forbidden: [token],
    });
  }
  await check("scanner diagnostics authenticated", "/scanner/diagnostics", {
    status: 200,
    includes: '"cloudflare-url-scanner"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
    validateJson: (body) => {
      const findings = [];
      if (body.status !== "ready") findings.push(`expected scanner status ready, got ${JSON.stringify(body.status)}`);
      if (body.tokenShape?.configured !== true) findings.push("scanner token is not configured");
      for (const check of body.checks ?? []) {
        if (check.success !== true) findings.push(`scanner check failed: ${check.stage}`);
      }
      return findings;
    },
  });
}

const failed = results.filter((result) => result.status !== "ok");
const summary = {
  status: failed.length === 0 ? "ok" : "failed",
  origin: origin.origin,
  authenticatedChecks: Boolean(token),
  results,
};

console.log(JSON.stringify(summary, null, 2));
if (failed.length > 0) process.exit(1);

async function check(name, path, expectation) {
  const url = new URL(path, origin);
  try {
    const response = await fetch(url, {
      method: expectation.method ?? "GET",
      headers: expectation.headers ?? {},
      body: expectation.body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    const findings = [];
    const expectedStatuses = Array.isArray(expectation.status) ? expectation.status : [expectation.status];
    if (!expectedStatuses.includes(response.status)) {
      findings.push(`expected HTTP ${expectedStatuses.join(" or ")}, got ${response.status}`);
    }
    const matchedExpected = expectedStatuses.includes(response.status);
    const shouldValidateBody = matchedExpected && response.status !== 404;
    if (expectation.includes && shouldValidateBody && !body.includes(expectation.includes)) {
      findings.push(`response did not include ${JSON.stringify(expectation.includes)}`);
    }
    if (expectation.validateJson && shouldValidateBody) {
      try {
        findings.push(...expectation.validateJson(JSON.parse(body)));
      } catch (error) {
        findings.push(`response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const value of expectation.forbidden ?? []) {
      if (value && body.includes(value)) findings.push("response leaked supplied bearer token");
    }
    results.push({
      name,
      status: findings.length === 0 ? "ok" : "failed",
      httpStatus: response.status,
      findings,
    });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      findings: [error instanceof Error ? error.message : String(error)],
    });
  }
}

function readTokenFile() {
  try {
    const token = fs.readFileSync(".archive-auth-token", "utf8").trim();
    if (!token || looksLikePlaceholder(token)) return "";
    return token;
  } catch {
    return "";
  }
}

function looksLikePlaceholder(value) {
  return value === "..." || /^<.+>$/.test(value) || /redacted|placeholder|changeme/i.test(value);
}
