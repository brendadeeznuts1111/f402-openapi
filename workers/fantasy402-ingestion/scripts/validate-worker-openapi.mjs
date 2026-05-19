import fs from "node:fs";

const specPath = new URL("../openapi.worker.json", import.meta.url);
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const findings = [];

const expectedOperations = [
  ["GET", "/alerts"],
  ["POST", "/alerts/policy-test"],
  ["GET", "/alerts/summary"],
  ["POST", "/alerts/test"],
  ["GET", "/archive"],
  ["GET", "/archive/object"],
  ["GET", "/archive/viewer"],
  ["GET", "/diagnostics"],
  ["GET", "/endpoints"],
  ["GET", "/endpoint-status"],
  ["GET", "/health"],
  ["GET", "/auth/health"],
  ["POST", "/ingest/local"],
  ["POST", "/refresh-auth"],
  ["GET", "/runs"],
  ["GET", "/runs/endpoints"],
  ["GET", "/scanner/diagnostics"],
  ["POST", "/update-cookies"],
  ["GET", "/upstream-cookies-status"],
  ["GET", "/scans"],
  ["GET", "/scans/detail"],
  ["GET", "/scans/export"],
  ["GET", "/scans/har"],
  ["GET", "/scans/network-diff"],
  ["GET", "/scans/network-summary"],
  ["GET", "/scans/screenshot"],
  ["GET", "/scans/summary"],
  ["POST", "/scans/trigger"],
  ["POST", "/trigger"],
  ["POST", "/trigger-scan"],
];
const publicOperations = new Set(["GET /archive/viewer", "GET /health", "GET /auth/health"]);
const expectedOperationKeys = new Set(expectedOperations.map(([method, path]) => `${method} ${path}`));

if (spec.openapi !== "3.1.0") findings.push("openapi must be 3.1.0");
if (!spec.components?.securitySchemes?.triggerToken) findings.push("missing triggerToken security scheme");

for (const [method, path] of expectedOperations) {
  const key = `${method} ${path}`;
  const operation = spec.paths?.[path]?.[method.toLowerCase()];
  if (!operation) {
    findings.push(`missing ${key} operation`);
    continue;
  }
  const security = operation.security ?? [];
  if (publicOperations.has(key)) {
    if (JSON.stringify(security).includes("triggerToken")) findings.push(`${key} must remain public`);
  } else if (!JSON.stringify(security).includes("triggerToken")) {
    findings.push(`${key} must require triggerToken security`);
  }
}

for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    if (pathItem?.[method] && !expectedOperationKeys.has(`${method.toUpperCase()} ${path}`)) {
      findings.push(`unexpected OpenAPI operation ${method.toUpperCase()} ${path}`);
    }
  }
}

const serialized = JSON.stringify(spec);
if (/password|ASP\.NET_SessionId|backdoor69|billy666/i.test(serialized)) {
  findings.push("worker OpenAPI spec contains forbidden credential-like text");
}

const upstreamAuthShape = spec.components?.schemas?.DiagnosticsResponse?.properties?.upstreamAuthShape;
if (!upstreamAuthShape?.properties?.ingestionReadiness) {
  findings.push("DiagnosticsResponse.upstreamAuthShape must include ingestionReadiness");
} else {
  const readiness = upstreamAuthShape.properties.ingestionReadiness;
  if (!readiness.required?.includes("status")) findings.push("ingestionReadiness must require status");
  if (!readiness.required?.includes("blocker")) findings.push("ingestionReadiness must require blocker");
  const statusEnum = readiness.properties?.status?.enum ?? [];
  if (!statusEnum.includes("ready") || !statusEnum.includes("blocked")) {
    findings.push("ingestionReadiness.status must enumerate ready and blocked");
  }
}
const browserHeaders = upstreamAuthShape?.properties?.browserHeaders;
if (!browserHeaders) {
  findings.push("DiagnosticsResponse.upstreamAuthShape must include sanitized browserHeaders presence diagnostics");
} else {
  for (const required of ["present", "missing", "count", "complete"]) {
    if (!browserHeaders.required?.includes(required)) findings.push(`browserHeaders must require ${required}`);
  }
}

const sessionCookie = spec.components?.schemas?.RefreshAuthRequest?.properties?.sessionCookie;
const refreshAuthAnyOf = spec.components?.schemas?.RefreshAuthRequest?.anyOf ?? [];
if (
  !refreshAuthAnyOf.some((branch) =>
    ["authorization", "cfClearance", "cfBm"].every((name) => branch.required?.includes(name)),
  )
) {
  findings.push("RefreshAuthRequest.anyOf must allow bearer plus cfClearance and cfBm without sessionCookie");
}
if (!/optional non-Cloudflare application\/session Cookie/.test(sessionCookie?.description ?? "")) {
  findings.push("RefreshAuthRequest.sessionCookie must document optional non-Cloudflare app-session behavior");
}
if (!/bearer plus Cloudflare cookies/.test(sessionCookie?.description ?? "")) {
  findings.push("RefreshAuthRequest.sessionCookie must document bearer plus Cloudflare cookie readiness");
}

for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
  if (schema.type === "object" && schema.additionalProperties !== false) {
    findings.push(`schema ${name} must set additionalProperties: false`);
  }
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "ok", spec: "openapi.worker.json" }, null, 2));
