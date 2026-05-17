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

for (const finding of validateOperationRequestParams(spec)) {
  findings.push(finding);
}

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
  const contentTypes = Object.keys(operation.requestBody?.content ?? {});
  if (endpoint.contentType && !contentTypes.includes(endpoint.contentType)) {
    findings.push(`${endpoint.key} manifest contentType ${endpoint.contentType} is not present in secured spec (${contentTypes.join(", ") || "none"})`);
  }
  if (!endpoint.contentType && contentTypes.length > 0) {
    findings.push(`${endpoint.key} manifest is missing contentType (${contentTypes.join(", ")})`);
  }
  const requestSchema = firstRequestSchema(operation);
  const requiredFields = new Set(Array.isArray(requestSchema?.required) ? requestSchema.required : []);
  if (requiredFields.has("customerID") && endpoint.requiresCustomerId !== true) {
    findings.push(`${endpoint.key} secured spec requires customerID but manifest does not mark requiresCustomerId`);
  }
  if (endpoint.contentType === "application/json" && !source.includes(`contentType: "json"`)) {
    findings.push(`${endpoint.key} uses JSON request bodies but src/index.ts has no JSON endpoint encoder`);
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

findings.push(...credentialFieldFindings(spec));

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

function credentialFieldFindings(openapi) {
  const schemaFindings = [];
  walkSchema(openapi.components?.schemas ?? {}, ["components", "schemas"], schemaFindings);
  return schemaFindings;
}

function walkSchema(value, pathParts, schemaFindings) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (key.startsWith("x-")) {
      continue;
    }
    if (/password|passwd|pwd|secret|token/i.test(key) && isUnreviewedCredentialField(child)) {
      schemaFindings.push(`${childPath.join(".")} is credential-shaped and lacks explicit security review metadata`);
    }
    walkSchema(child, childPath, schemaFindings);
  }
}

function isUnreviewedCredentialField(value) {
  if (!value || typeof value !== "object") return true;
  if (value["x-security-review-required"] === true) return false;
  if (value["x-sensitive"] === true && value["x-privacy-classification"]) return false;
  return true;
}

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

function firstRequestSchema(operation) {
  const content = operation.requestBody?.content ?? {};
  const first = Object.values(content)[0];
  const schema = first?.schema;
  if (!schema) return null;
  return resolveSchema(schema);
}

function validateOperationRequestParams(openapi) {
  const operationFindings = [];
  for (const [apiPath, pathItem] of Object.entries(openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!["post", "put", "patch", "delete"].includes(method)) continue;
      if (!operation.requestBody) {
        operationFindings.push(`${method.toUpperCase()} ${apiPath} is missing requestBody`);
        continue;
      }
      const requestSchema = firstRequestSchema(operation);
      if (!requestSchema) {
        operationFindings.push(`${method.toUpperCase()} ${apiPath} is missing request schema`);
        continue;
      }
      const required = Array.isArray(requestSchema.required) ? requestSchema.required : [];
      if (required.length === 0) {
        operationFindings.push(`${method.toUpperCase()} ${apiPath} request schema has no required params`);
      }
    }
  }
  return operationFindings;
}

function resolveSchema(schema, seen = new Set()) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    if (seen.has(name)) return null;
    seen.add(name);
    return resolveSchema(spec.components?.schemas?.[name], seen);
  }
  if (Array.isArray(schema.allOf)) {
    const merged = { type: "object", properties: {}, required: [] };
    for (const part of schema.allOf) {
      const resolved = resolveSchema(part, seen);
      Object.assign(merged.properties, resolved?.properties ?? {});
      for (const field of resolved?.required ?? []) {
        if (!merged.required.includes(field)) merged.required.push(field);
      }
    }
    return merged;
  }
  return schema;
}
