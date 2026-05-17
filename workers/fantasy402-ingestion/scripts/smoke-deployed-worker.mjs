import fs from "node:fs";

const origin = new URL(process.env.WORKER_ORIGIN ?? "https://fantasy402-ingestion.utahj4754.workers.dev");
const token = process.env.INGESTION_TRIGGER_TOKEN || process.env.ARCHIVE_AUTH_TOKEN || readTokenFile();
const results = [];

await check("health", "/health?smoke=1", { status: 200, includes: '"status":"ok"' });
await check("viewer", "/archive/viewer", { status: 200, includes: "Fantasy402 Archive Viewer" });
await check("diagnostics unauthenticated", "/diagnostics", { status: 401, includes: "Unauthorized" });
await check("archive unauthenticated", "/archive?prefix=fantasy402/&limit=1", { status: 401, includes: "Unauthorized" });

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
  await check("archive authenticated", "/archive?prefix=fantasy402/&limit=5", {
    status: 200,
    includes: '"objects"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
  });
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
      headers: expectation.headers ?? {},
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    const findings = [];
    if (response.status !== expectation.status) {
      findings.push(`expected HTTP ${expectation.status}, got ${response.status}`);
    }
    if (expectation.includes && !body.includes(expectation.includes)) {
      findings.push(`response did not include ${JSON.stringify(expectation.includes)}`);
    }
    if (expectation.validateJson) {
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
