import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const importArgs = args.length > 0 ? args : ["fantasy402/browser-request.curl"];

run("node", ["scripts/import-browser-curl.mjs", ...importArgs], "import browser cURL");
run("node", ["scripts/check-browser-auth.mjs"], "check browser auth");
run("node", ["scripts/local-browser-ingest.mjs"], "run local browser ingestion");

function run(command, args, label) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(JSON.stringify({ status: "failed", step: label, message: result.error.message }, null, 2));
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(JSON.stringify({ status: "failed", step: label, exitCode: result.status }, null, 2));
    process.exit(result.status ?? 1);
  }
}
