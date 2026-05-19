import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = readJson("manifest.json");
const routes = readJson("public-routes.json");
const openapi = readJson("openapi.worker.json");
const errors = readJson("error-codes.json");
const findings = [];

for (const entrypoint of Object.values(manifest.entrypoints ?? {})) {
  if (!fs.existsSync(path.join(root, entrypoint))) findings.push(`missing entrypoint ${entrypoint}`);
}

for (const schema of manifest.schemas ?? []) {
  if (!openapi.components?.schemas?.[schema]) findings.push(`manifest schema ${schema} missing from OpenAPI`);
}

for (const route of routes.routes ?? []) {
  if (!openapi.paths?.[route.path]) findings.push(`route ${route.method} ${route.path} missing from OpenAPI`);
  if (route.responseSchema && route.responseSchema !== "text/html" && !openapi.components?.schemas?.[route.responseSchema]) {
    findings.push(`route ${route.path} references missing response schema ${route.responseSchema}`);
  }
  if (route.requestSchema && !openapi.components?.schemas?.[route.requestSchema]) {
    findings.push(`route ${route.path} references missing request schema ${route.requestSchema}`);
  }
}

for (const [code, definition] of Object.entries(errors)) {
  if (!definition.httpStatus || !definition.description || !definition.frontendHandling) {
    findings.push(`error code ${code} is incomplete`);
  }
}

for (const file of [manifest.contracts?.workerOpenApi, manifest.contracts?.upstreamEndpoints, manifest.public?.llm, manifest.public?.llms, "error-codes.json", "public-routes.json"]) {
  if (file && !fs.existsSync(path.join(root, file))) findings.push(`manifest file reference missing: ${file}`);
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "ok", manifest: "manifest.json", routes: routes.routes.length, errorCodes: Object.keys(errors).length }, null, 2));

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}
