import fs from "node:fs";

const configPath = new URL("../wrangler.toml", import.meta.url);
const config = fs.readFileSync(configPath, "utf8");
const activeConfig = config
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const findings = [];
const warnings = [];

for (const token of ["<YOUR_KV_ID>", "<YOUR_KV_PREVIEW_ID>", "<YOUR_D1_ID>"]) {
  if (config.includes(token)) findings.push(`replace placeholder ${token} in wrangler.toml`);
}

if (!/account_id\s*=\s*"7a470541a704caaf91e71efccc78fd36"/.test(activeConfig)) {
  findings.push("missing expected Cloudflare account_id 7a470541a704caaf91e71efccc78fd36");
}

if (!/binding\s*=\s*"SESSION_KV"/.test(activeConfig)) findings.push("missing SESSION_KV binding");
if (!/binding\s*=\s*"AUTH_CACHE"/.test(activeConfig)) findings.push("missing AUTH_CACHE binding");
if (!/binding\s*=\s*"ANALYTICS_DB"/.test(activeConfig)) findings.push("missing ANALYTICS_DB binding");
if (!/binding\s*=\s*"RAW_ARCHIVE"/.test(activeConfig)) findings.push("missing RAW_ARCHIVE binding");
if (!/crons\s*=\s*\[[^\]]*"\*\/15 \* \* \* \*"/.test(activeConfig)) warnings.push("15-minute cron trigger is not active");
if (!/crons\s*=\s*\[[^\]]*"0 \*\/6 \* \* \*"/.test(activeConfig)) warnings.push("six-hour URL Scanner cron trigger is not active");
if (!/CLOUDFLARE_ACCOUNT_ID\s*=\s*"7a470541a704caaf91e71efccc78fd36"/.test(activeConfig)) {
  findings.push("missing CLOUDFLARE_ACCOUNT_ID Worker var");
}
if (!/CLOUDFLARE_ZONE_ID\s*=\s*"a3b7ba4bb62cb1b177b04b8675250674"/.test(activeConfig)) {
  findings.push("missing CLOUDFLARE_ZONE_ID Worker var");
}
if (!/WORKER_NAME\s*=\s*"fantasy402-ingestion"/.test(activeConfig)) {
  findings.push("missing WORKER_NAME Worker var");
}

for (const binding of [
  "CLOUDFLARE_API_TOKEN",
  "FANTASY402_AGENT_ID",
  "FANTASY402_PASSWORD",
  "FANTASY402_USERNAME",
  "FANTASY402_SESSION_COOKIE",
  "FANTASY402_CF_CLEARANCE",
  "FANTASY402_CF_BM",
  "FANTASY402_BROWSER_HEADERS_JSON",
]) {
  if (!new RegExp(`binding\\s*=\\s*"${binding}"`).test(activeConfig)) {
    findings.push(`missing Secrets Store binding ${binding}`);
  }
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "ok", config: "wrangler.toml", warnings }, null, 2));
