const origin = new URL(process.env.WORKER_ORIGIN ?? "https://fantasy402-ingestion.utahj4754.workers.dev");
const token = process.env.INGESTION_TRIGGER_TOKEN || process.env.ARCHIVE_AUTH_TOKEN || "";
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
  });
  await check("archive authenticated", "/archive?prefix=fantasy402/&limit=5", {
    status: 200,
    includes: '"objects"',
    headers: { Authorization: `Bearer ${token}` },
    forbidden: [token],
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
