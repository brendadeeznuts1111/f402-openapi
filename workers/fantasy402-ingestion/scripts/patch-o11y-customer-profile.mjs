import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(workerRoot, "upstream-endpoints.json"), "utf8"));
const specPath = path.resolve(workerRoot, manifest.spec);
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));

const templatePath = "/cloud/api/Manager/getConfigWebReportsCustomerAdmin";
const template = spec.paths?.[templatePath]?.post;
if (!template) {
  console.error(`template missing: ${templatePath}`);
  process.exit(1);
}

const newPaths = [
  "getInfoPlayer",
  "getCryptoInfo",
  "getMail",
  "getTeaserProfile",
].map((name) => ({
  path: `/cloud/api/Manager/${name}`,
  operationId: `post_cloud_api_Manager_${name}`,
}));

let added = 0;
for (const entry of newPaths) {
  if (spec.paths[entry.path]?.post) continue;
  const operation = structuredClone(template);
  operation.summary = `POST ${entry.path}`;
  operation.operationId = entry.operationId;
  spec.paths[entry.path] = { post: operation };
  added += 1;
}

fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
console.log(JSON.stringify({ spec: specPath, added, total: newPaths.length }, null, 2));
