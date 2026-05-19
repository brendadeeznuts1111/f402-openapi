import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

for (const file of ["manifest.json", "openapi.worker.json", "public-routes.json", "error-codes.json"]) {
  fs.copyFileSync(path.join(root, file), path.join(dist, path.basename(file)));
}

console.log(JSON.stringify({ status: "ok", dist, files: fs.readdirSync(dist).sort() }, null, 2));
