#!/usr/bin/env tsx
/**
 * Headless login → sessionStorage harvest → POST /refresh-auth + local browser-auth.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { waitForCloudflare, loginFantasy402 } from "./login.js";
import { harvestInPage, buildRefreshPayload, buildBrowserAuthJson } from "./harvest.js";
import { renewTokenInPageIfNeeded } from "./renew-in-page.js";

const DEFAULT_WORKER = "https://fantasy402-ingestion.utahj4754.workers.dev";

function isLocalProxy(origin: string): boolean {
  try {
    const url = new URL(origin);
    const proxyPort = Number(process.env.LOCAL_INGEST_PROXY_PORT || 8791);
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return loopback && port === proxyPort;
  } catch {
    return false;
  }
}

function resolveRefreshTarget(): { url: string; useProxy: boolean } {
  const upstream = process.env.FANTASY402_WORKER_UPSTREAM?.trim() || process.env.INGEST_PROXY_UPSTREAM?.trim();
  const workerOrigin = (process.env.WORKER_ORIGIN || process.env.REFRESH_COOKIES_WORKER_URL || DEFAULT_WORKER).replace(/\/$/, "");
  if (upstream) return { url: upstream.replace(/\/$/, ""), useProxy: false };
  if (isLocalProxy(workerOrigin)) return { url: workerOrigin, useProxy: true };
  return { url: workerOrigin, useProxy: false };
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(scriptDir, "../..");

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  console.error(`Missing required environment variable (one of): ${names.join(", ")}`);
  process.exit(1);
}

function readOperatorToken(): string {
  const fromEnv = process.env.INGESTION_TRIGGER_TOKEN || process.env.ARCHIVE_AUTH_TOKEN;
  if (fromEnv?.trim()) return fromEnv.trim();
  const tokenPath = process.env.ARCHIVE_AUTH_TOKEN_FILE || path.join(workerRoot, ".archive-auth-token");
  try {
    return fs.readFileSync(tokenPath, "utf8").trim();
  } catch {
    console.error("Missing INGESTION_TRIGGER_TOKEN or .archive-auth-token");
    process.exit(1);
  }
}

function jwtExpIso(authorization: string): string | null {
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { exp?: number };
    return payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function writeFailureState(stateFile: string, message: string, workerOrigin: string) {
  const state = {
    lastSuccessAt: null,
    lastFailureAt: new Date().toISOString(),
    lastError: message.slice(0, 500),
    jwtExp: null,
    workerStatus: "failed",
    workerOrigin,
  };
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const { url: refreshBase, useProxy } = resolveRefreshTarget();
  const username = requiredEnv("FANTASY402_USERNAME", "FANTASY402_CUSTOMER_ID");
  const password = requiredEnv("FANTASY402_PASSWORD");
  const operatorToken = useProxy ? "" : readOperatorToken();
  if (!useProxy && !operatorToken) {
    console.error("Missing INGESTION_TRIGGER_TOKEN (not required when posting via local ingest proxy)");
    process.exit(1);
  }
  const maxRetries = Number.parseInt(process.env.MAX_RETRIES || "1", 10);

  const authDir = path.join(workerRoot, "fantasy402");
  const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE || path.join(authDir, "browser-auth.json");
  const stateFile = process.env.FANTASY402_AUTH_STATE_FILE || path.join(authDir, ".auth-refresh-state.json");

  fs.mkdirSync(authDir, { recursive: true });

  const headless = process.env.PUPPETEER_HEADLESS !== "false" && process.env.PUPPETEER_HEADLESS !== "0";
  const userDataDir =
    process.env.PUPPETEER_USER_DATA_DIR || path.join(workerRoot, "fantasy402", ".puppeteer-profile");
  fs.mkdirSync(userDataDir, { recursive: true });
  const browser = await puppeteer.launch({
    headless,
    userDataDir,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  if (!headless) console.error("Puppeteer: headed mode (set PUPPETEER_HEADLESS=false)");

  let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    await waitForCloudflare(page, maxRetries);
    await loginFantasy402(page, username, password);
    await renewTokenInPageIfNeeded(page);

    const harvested = await page.evaluate(harvestInPage);
    const browserCookies = await page.cookies("https://fantasy402.com");
    for (const cookie of browserCookies) {
      if (cookie.name === "cf_clearance" && !harvested.cfClearance) {
        harvested.cfClearance = `cf_clearance=${cookie.value}`;
      }
      if (cookie.name === "__cf_bm" && !harvested.cfBm) {
        harvested.cfBm = `__cf_bm=${cookie.value}`;
      }
    }

    const refreshBody = buildRefreshPayload(harvested);
    const browserAuth = buildBrowserAuthJson(refreshBody);

    const refreshUrl = `${refreshBase}/refresh-auth`;
    console.log(`POST ${refreshUrl}…${useProxy ? " (via local proxy)" : ""}`);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (!useProxy) headers.Authorization = `Bearer ${operatorToken}`;
    const response = await fetch(refreshUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(refreshBody),
    });

    const resultText = await response.text();
    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(resultText) as Record<string, unknown>;
    } catch {
      result = { raw: resultText.slice(0, 500) };
    }

    if (!response.ok) {
      console.error(`refresh-auth failed: ${response.status}`, result);
      writeFailureState(stateFile, `refresh-auth HTTP ${response.status}`, refreshBase);
      process.exit(1);
    }

    console.log("refresh-auth OK:", result.status ?? "ok");

    fs.writeFileSync(authFile, `${JSON.stringify(browserAuth, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${authFile}`);
    const { validateBrowserAuthPayload } = await import("../browser-auth-utils.mjs");
    validateBrowserAuthPayload(browserAuth, authFile);
    console.log("browser-auth.json validated for local ingest");

    const jwtExp = jwtExpIso(refreshBody.authorization);
    const state = {
      lastSuccessAt: new Date().toISOString(),
      jwtExp,
      workerStatus: String(result.status ?? "ok"),
      workerOrigin: refreshBase,
    };
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${stateFile}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (page) {
      try {
        const shot = path.join(authDir, ".auth-refresh-failure.png");
        await page.screenshot({ path: shot, fullPage: true });
        console.error(`Screenshot: ${shot}`);
      } catch {
        /* ignore screenshot errors */
      }
    }
    writeFailureState(stateFile, message, refreshBase);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
