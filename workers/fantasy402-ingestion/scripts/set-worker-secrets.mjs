import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const required = [
  "FANTASY402_USERNAME",
  "FANTASY402_PASSWORD",
  "FANTASY402_AGENT_ID",
  "INGESTION_TRIGGER_TOKEN",
];
const optional = ["FANTASY402_CUSTOMER_ID", "ALERT_WEBHOOK_URL"];
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(JSON.stringify({ status: "failed", missing }, null, 2));
  process.exit(1);
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error(JSON.stringify({ status: "failed", missing: ["CLOUDFLARE_API_TOKEN"] }, null, 2));
  process.exit(1);
}

const payload = {};
for (const key of [...required, ...optional]) {
  if (process.env[key]) payload[key] = process.env[key];
}

if (!apply) {
  console.log(
    JSON.stringify(
      {
        status: "dry-run",
        apply: false,
        secrets: Object.keys(payload),
        note: "Re-run with --apply to upload these names with wrangler secret bulk.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fantasy402-secrets-"));
const tempFile = path.join(tempDir, "secrets.json");

try {
  fs.writeFileSync(tempFile, JSON.stringify(payload));
  const output = execFileSync("npx", ["wrangler@4.59.2", "secret", "bulk", tempFile], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(output);
  console.log(JSON.stringify({ status: "ok", uploaded: Object.keys(payload) }, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
