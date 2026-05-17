import fs from "node:fs";

const configPath = new URL("../wrangler.toml", import.meta.url);
const config = fs.readFileSync(configPath, "utf8");
const findings = [];

for (const token of ["<YOUR_KV_ID>", "<YOUR_KV_PREVIEW_ID>", "<YOUR_D1_ID>"]) {
  if (config.includes(token)) findings.push(`replace placeholder ${token} in wrangler.toml`);
}

if (!/binding\s*=\s*"SESSION_KV"/.test(config)) findings.push("missing SESSION_KV binding");
if (!/binding\s*=\s*"ANALYTICS_DB"/.test(config)) findings.push("missing ANALYTICS_DB binding");
if (!/binding\s*=\s*"RAW_ARCHIVE"/.test(config)) findings.push("missing RAW_ARCHIVE binding");
if (!/crons\s*=\s*\["\*\/15 \* \* \* \*"\]/.test(config)) findings.push("missing 15-minute cron trigger");

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "ok", config: "wrangler.toml" }, null, 2));
