#!/usr/bin/env bun
/**
 * One-shot: Puppeteer login (headed by default) → POST /refresh-auth via local proxy.
 * Use when manager.html is logged out but credentials are valid.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  WORKER_ORIGIN: process.env.WORKER_ORIGIN ?? "http://127.0.0.1:8791",
  PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS ?? "false",
  MAX_RETRIES: process.env.MAX_RETRIES ?? "2",
};

const result = spawnSync("npm", ["run", "auth:refresh-full"], {
  cwd: workerRoot,
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
