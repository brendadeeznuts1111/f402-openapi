#!/usr/bin/env bun
/**
 * Dev helper: start local ingest proxy + print commands for refresh + batch ingest.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localProxyBaseUrl } from "./proxy-client-utils.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.LOCAL_INGEST_PROXY_PORT ?? 8791;
const proxyUrl = localProxyBaseUrl();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForProxy(maxMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${proxyUrl}/`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  return false;
}

const bun = process.env.BUN_BIN ?? "bun";
const proxyProc = spawn(bun, ["scripts/local-ingest-proxy.ts"], {
  cwd: workerRoot,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});

proxyProc.stdout?.on("data", (chunk) => process.stderr.write(chunk));
proxyProc.stderr?.on("data", (chunk) => process.stderr.write(chunk));

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  proxyProc.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const ready = await waitForProxy();
if (!ready) {
  console.error("Local ingest proxy did not start on", proxyUrl);
  await shutdown(1);
}

console.log(`
Fantasy402 dev ingest stack
=========================
Proxy:  ${proxyUrl}  (pid ${proxyProc.pid})
Upstream: ${process.env.FANTASY402_WORKER_UPSTREAM ?? "(default workers.dev)"}

In another terminal:
  cd ${workerRoot}
  export WORKER_ORIGIN=${proxyUrl}
  npm run auth:stack-status
  npm run auth:refresh-full      # needs FANTASY402_USERNAME/PASSWORD
  npm run auth:preflight
  npm run ingest:local-batch

Press Ctrl+C here to stop the proxy.
`);

await new Promise((resolve) => proxyProc.on("exit", resolve));
