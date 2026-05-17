import fs from "node:fs";
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const wranglerToml = new URL("../wrangler.toml", import.meta.url);
const config = fs.readFileSync(wranglerToml, "utf8");
const plan = [];

if (args.has("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const settings = {
  accountId: "7a470541a704caaf91e71efccc78fd36",
  kvBinding: "SESSION_KV",
  kvTitle: "SESSION_KV",
  authCacheKvBinding: "AUTH_CACHE",
  authCacheKvTitle: "AUTH_CACHE",
  d1Name: "fantasy402-analytics",
  r2Bucket: "fantasy402-raw",
  r2PreviewBucket: "fantasy402-raw-preview",
};

const existing = {
  accountId: readTomlValue(config, /account_id\s*=\s*"([^"]+)"/),
  kvId: readTomlValue(config, /binding\s*=\s*"SESSION_KV"[\s\S]*?id\s*=\s*"([^"]+)"/),
  kvPreviewId: readTomlValue(config, /binding\s*=\s*"SESSION_KV"[\s\S]*?preview_id\s*=\s*"([^"]+)"/),
  authCacheKvId: readTomlValue(config, /binding\s*=\s*"AUTH_CACHE"[\s\S]*?id\s*=\s*"([^"]+)"/),
  authCacheKvPreviewId: readTomlValue(config, /binding\s*=\s*"AUTH_CACHE"[\s\S]*?preview_id\s*=\s*"([^"]+)"/),
  d1Id: readTomlValue(config, /database_name\s*=\s*"fantasy402-analytics"[\s\S]*?database_id\s*=\s*"([^"]+)"/),
};

if (existing.accountId && existing.accountId !== settings.accountId) {
  throw new Error(`wrangler.toml account_id ${existing.accountId} does not match expected account ${settings.accountId}`);
}

plan.push({
  resource: "KV namespace",
  command: `wrangler kv namespace create ${settings.kvTitle}`,
  skipped: !isPlaceholder(existing.kvId),
});
plan.push({
  resource: "KV preview namespace",
  command: `wrangler kv namespace create ${settings.kvTitle} --preview`,
  skipped: !isPlaceholder(existing.kvPreviewId),
});
plan.push({
  resource: "Auth cache KV namespace",
  command: `wrangler kv namespace create ${settings.authCacheKvTitle}`,
  skipped: !isPlaceholder(existing.authCacheKvId),
});
plan.push({
  resource: "Auth cache KV preview namespace",
  command: `wrangler kv namespace create ${settings.authCacheKvTitle} --preview`,
  skipped: !isPlaceholder(existing.authCacheKvPreviewId),
});
plan.push({
  resource: "D1 database",
  command: `wrangler d1 create ${settings.d1Name}`,
  skipped: !isPlaceholder(existing.d1Id),
});
plan.push({
  resource: "R2 bucket",
  command: `wrangler r2 bucket create ${settings.r2Bucket}`,
  skipped: false,
});
plan.push({
  resource: "R2 preview bucket",
  command: `wrangler r2 bucket create ${settings.r2PreviewBucket}`,
  skipped: false,
});

if (!apply) {
  console.log(JSON.stringify({ status: "dry-run", apply: false, plan, note: "Re-run with --apply to create resources and patch wrangler.toml." }, null, 2));
  process.exit(0);
}

const replacements = {};

if (isPlaceholder(existing.kvId)) {
  replacements["<YOUR_KV_ID>"] = parseKvId(run("wrangler", ["kv", "namespace", "create", settings.kvTitle]));
}

if (isPlaceholder(existing.kvPreviewId)) {
  replacements["<YOUR_KV_PREVIEW_ID>"] = parseKvId(run("wrangler", ["kv", "namespace", "create", settings.kvTitle, "--preview"]));
}

if (isPlaceholder(existing.authCacheKvId)) {
  replacements["<YOUR_AUTH_CACHE_KV_ID>"] = parseKvId(run("wrangler", ["kv", "namespace", "create", settings.authCacheKvTitle]));
}

if (isPlaceholder(existing.authCacheKvPreviewId)) {
  replacements["<YOUR_AUTH_CACHE_KV_PREVIEW_ID>"] = parseKvId(
    run("wrangler", ["kv", "namespace", "create", settings.authCacheKvTitle, "--preview"]),
  );
}

if (isPlaceholder(existing.d1Id)) {
  replacements["<YOUR_D1_ID>"] = parseD1Id(run("wrangler", ["d1", "create", settings.d1Name]));
}

createR2Bucket(settings.r2Bucket);
createR2Bucket(settings.r2PreviewBucket);

let nextConfig = config;
for (const [placeholder, value] of Object.entries(replacements)) {
  if (!value) throw new Error(`No value parsed for ${placeholder}`);
  nextConfig = nextConfig.replaceAll(placeholder, value);
}

if (nextConfig !== config) {
  fs.writeFileSync(wranglerToml, nextConfig);
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      updatedWranglerToml: nextConfig !== config,
      replacements: Object.keys(replacements),
      nextCommands: [
        "npm run validate:deploy-config",
        "npm run migrate:remote",
        "wrangler secret put FANTASY402_USERNAME",
        "wrangler secret put FANTASY402_PASSWORD",
        "wrangler secret put FANTASY402_AGENT_ID",
        "wrangler secret put INGESTION_TRIGGER_TOKEN",
        "wrangler secret put CLOUDFLARE_API_TOKEN",
        "npm run deploy",
      ],
    },
    null,
    2,
  ),
);

function createR2Bucket(bucket) {
  try {
    run("wrangler", ["r2", "bucket", "create", bucket]);
  } catch (error) {
    const output = String(error.stdout ?? "") + String(error.stderr ?? "") + String(error.message ?? "");
    if (/already exists|already owned|bucket.*exists/i.test(output)) {
      console.warn(`R2 bucket ${bucket} already exists; continuing.`);
      return;
    }
    throw error;
  }
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readTomlValue(contents, pattern) {
  return contents.match(pattern)?.[1] ?? "";
}

function isPlaceholder(value) {
  return !value || /^<YOUR_.+>$/.test(value);
}

function parseKvId(output) {
  return parseFirst(output, [
    /id\s*=\s*"([^"]+)"/,
    /"id"\s*:\s*"([^"]+)"/,
    /([a-f0-9]{32})/i,
  ]);
}

function parseD1Id(output) {
  return parseFirst(output, [
    /database_id\s*=\s*"([^"]+)"/,
    /"uuid"\s*:\s*"([^"]+)"/,
    /"database_id"\s*:\s*"([^"]+)"/,
    /([a-f0-9-]{36})/i,
  ]);
}

function parseFirst(output, patterns) {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  throw new Error(`Could not parse resource id from wrangler output:\n${output}`);
}

function runSelfTest() {
  const kvOutput = `Add the following to your configuration file:
kv_namespaces = [
  { binding = "SESSION_KV", id = "0123456789abcdef0123456789abcdef" },
  { binding = "AUTH_CACHE", id = "fedcba9876543210fedcba9876543210" }
]`;
  const d1Output = `[[d1_databases]]
binding = "DB"
database_name = "fantasy402-analytics"
database_id = "11111111-2222-4333-8444-555555555555"`;

  const kvId = parseKvId(kvOutput);
  const d1Id = parseD1Id(d1Output);
  if (kvId !== "0123456789abcdef0123456789abcdef") throw new Error(`KV parser failed: ${kvId}`);
  if (d1Id !== "11111111-2222-4333-8444-555555555555") throw new Error(`D1 parser failed: ${d1Id}`);

  console.log(JSON.stringify({ status: "ok", selfTest: "bootstrap-cloudflare-resources" }, null, 2));
}
