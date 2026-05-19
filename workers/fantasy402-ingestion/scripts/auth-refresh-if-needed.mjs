#!/usr/bin/env bun
/**
 * Conditional headless refresh for systemd timer — skips Puppeteer when JWT is healthy.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAuthStackPreflight } from "./auth-stack-preflight.mjs";
import { shouldRefreshAuth, loadLocalJwtSummary } from "./automation-policy.mjs";
import { localProxyBaseUrl } from "./proxy-client-utils.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerOrigin = process.env.WORKER_ORIGIN ?? localProxyBaseUrl();
const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? path.join(workerRoot, "fantasy402/browser-auth.json");
const force = process.argv.includes("--force");

async function main() {
  const preflight = await runAuthStackPreflight({ workerOrigin, refresh: false });
  const local = preflight.local ?? loadLocalJwtSummary(authFile);
  const decision = shouldRefreshAuth({ preflight, local, force });

  if (!decision.run) {
    console.log(JSON.stringify({ status: "skipped", reason: decision.reason, preflight: { ok: preflight.ok } }, null, 2));
    process.exit(0);
  }

  console.error(`auth-refresh-if-needed: ${decision.reason} → auth:refresh-full`);
  const refresh = spawnSync("npm", ["run", "auth:refresh-full"], {
    cwd: workerRoot,
    stdio: "inherit",
    env: { ...process.env, WORKER_ORIGIN: workerOrigin },
  });
  process.exit(refresh.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
