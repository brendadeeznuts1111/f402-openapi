#!/usr/bin/env bun
/** POST a refresh-auth JSON payload (file or stdin) via local proxy or direct Worker. */
import fs from "node:fs";
import { localProxyBaseUrl } from "./proxy-client-utils.mjs";
import { readTokenFile } from "./browser-auth-utils.mjs";
import { isLocalIngestProxyUrl, workerAuthorizationHeaders } from "./proxy-client-utils.mjs";

const workerOrigin = (process.env.WORKER_ORIGIN ?? localProxyBaseUrl()).replace(/\/$/, "");
const token = process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN ?? readTokenFile();
const file = process.argv[2];
const raw = file ? fs.readFileSync(file, "utf8") : await Bun.stdin.text();
const body = JSON.parse(raw);

const headers = {
  "Content-Type": "application/json",
  ...workerAuthorizationHeaders(token, workerOrigin),
};
const res = await fetch(`${workerOrigin}/refresh-auth`, { method: "POST", headers, body: JSON.stringify(body) });
const text = await res.text();
console.log(res.status, text);
if (!res.ok) process.exit(1);

if (!isLocalIngestProxyUrl(workerOrigin)) {
  const out = process.env.FANTASY402_BROWSER_AUTH_FILE ?? "fantasy402/browser-auth.json";
  fs.mkdirSync("fantasy402", { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  console.error(`Wrote ${out}`);
}
