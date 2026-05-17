import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(workerRoot, "upstream-endpoints.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const specPath = path.resolve(workerRoot, manifest.spec);
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const wrangler = fs.readFileSync(path.join(workerRoot, "wrangler.toml"), "utf8");
const source = fs.readFileSync(path.join(workerRoot, "src/index.ts"), "utf8");
const findings = [];

const configuredKeys = parseConfiguredEndpointKeys(wrangler);
const manifestKeys = new Set(manifest.endpoints.map((endpoint) => endpoint.key));
const sourceKeys = parseSourceEndpointKeys(source);

for (const key of configuredKeys) {
  if (!manifestKeys.has(key)) findings.push(`wrangler default endpoint ${key} is not in upstream-endpoints.json`);
}

for (const key of sourceKeys) {
  if (!manifestKeys.has(key)) findings.push(`source endpoint ${key} is not in upstream-endpoints.json`);
}

for (const key of manifestKeys) {
  if (!sourceKeys.has(key)) findings.push(`manifest endpoint ${key} is not implemented in src/index.ts`);
}

for (const endpoint of manifest.endpoints) {
  const operation = spec.paths?.[endpoint.path]?.[endpoint.method];
  if (!operation) {
    findings.push(`${endpoint.key} missing ${endpoint.method.toUpperCase()} ${endpoint.path} in secured examples spec`);
    continue;
  }

  if (operation.operationId !== endpoint.operationId) {
    findings.push(`${endpoint.key} operationId drifted: expected ${endpoint.operationId}, found ${operation.operationId ?? "missing"}`);
  }
  if (operation.deprecated === true) {
    findings.push(`${endpoint.key} points at a deprecated upstream operation`);
  }
  if (!operation.security || operation.security.length === 0) {
    findings.push(`${endpoint.key} is missing upstream security requirements`);
  }
  if (!Array.isArray(operation["x-required-roles"]) || operation["x-required-roles"].length === 0) {
    findings.push(`${endpoint.key} is missing x-required-roles`);
  }
  if (!operation["x-rate-limit"]?.limit || !operation["x-rate-limit"]?.window) {
    findings.push(`${endpoint.key} is missing x-rate-limit metadata`);
  }
  if (/^(update|save|delete|remove|change|create|add)(?!edInfo$)/i.test(endpoint.key)) {
    findings.push(`${endpoint.key} is mutation-shaped and must not be ingested by this read-only Worker`);
  }
  if (!source.includes(`key: "${endpoint.key}"`) || !source.includes(`path: "${endpoint.path}"`)) {
    findings.push(`${endpoint.key} manifest entry is not mirrored in src/index.ts`);
  }
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", spec: path.relative(workerRoot, specPath), findings }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      spec: path.relative(workerRoot, specPath),
      endpointsChecked: manifest.endpoints.length,
      defaultEndpointsChecked: configuredKeys.length,
    },
    null,
    2,
  ),
);

function parseConfiguredEndpointKeys(config) {
  const match = config.match(/FANTASY402_INGESTION_ENDPOINTS\s*=\s*"([^"]+)"/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseSourceEndpointKeys(contents) {
  return new Set(
    [...contents.matchAll(/key:\s*"([^"]+)"/g)]
      .map((match) => match[1])
      .filter(Boolean),
  );
}
