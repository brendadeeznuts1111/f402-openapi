import fs from "node:fs";

const specPath = new URL("../openapi.worker.json", import.meta.url);
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const findings = [];

if (spec.openapi !== "3.1.0") findings.push("openapi must be 3.1.0");
if (!spec.paths?.["/health"]?.get) findings.push("missing GET /health operation");
if (!spec.paths?.["/trigger"]?.post) findings.push("missing POST /trigger operation");
if (!spec.paths?.["/archive"]?.get) findings.push("missing GET /archive operation");
if (!spec.paths?.["/archive/object"]?.get) findings.push("missing GET /archive/object operation");
if (!spec.paths?.["/scans"]?.get) findings.push("missing GET /scans operation");
if (!spec.paths?.["/scans/trigger"]?.post) findings.push("missing POST /scans/trigger operation");
if (!spec.paths?.["/refresh-auth"]?.post) findings.push("missing POST /refresh-auth operation");
if (!spec.paths?.["/ingest/local"]?.post) findings.push("missing POST /ingest/local operation");
if (!spec.components?.securitySchemes?.triggerToken) findings.push("missing triggerToken security scheme");

const triggerSecurity = spec.paths?.["/trigger"]?.post?.security ?? [];
if (!JSON.stringify(triggerSecurity).includes("triggerToken")) {
  findings.push("POST /trigger must require triggerToken security");
}

for (const [method, operation] of [
  ["GET /archive", spec.paths?.["/archive"]?.get],
  ["GET /archive/object", spec.paths?.["/archive/object"]?.get],
  ["GET /scans", spec.paths?.["/scans"]?.get],
  ["POST /scans/trigger", spec.paths?.["/scans/trigger"]?.post],
  ["POST /refresh-auth", spec.paths?.["/refresh-auth"]?.post],
  ["POST /ingest/local", spec.paths?.["/ingest/local"]?.post],
]) {
  if (!JSON.stringify(operation?.security ?? []).includes("triggerToken")) {
    findings.push(`${method} must require triggerToken security`);
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

const sessionCookie = spec.components?.schemas?.RefreshAuthRequest?.properties?.sessionCookie;
if (!/non-Cloudflare application\/session Cookie/.test(sessionCookie?.description ?? "")) {
  findings.push("RefreshAuthRequest.sessionCookie must document non-Cloudflare app-session requirement");
}
if (!/403\/1106/.test(sessionCookie?.description ?? "")) {
  findings.push("RefreshAuthRequest.sessionCookie must document the upstream 403/1106 blocker");
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
