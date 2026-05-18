#!/usr/bin/env node
// refresh-cookies.js
// Launches a Puppeteer browser, navigates to fantasy402.com,
// waits for the Cloudflare challenge to resolve, extracts cf_clearance
// and __cf_bm cookies, and POSTs them to the Worker's /update-cookies endpoint.

const WORKER_URL = process.env.REFRESH_COOKIES_WORKER_URL;
const INGESTION_TRIGGER_TOKEN = process.env.INGESTION_TRIGGER_TOKEN;
const TARGET_URL = process.env.TARGET_URL || "https://fantasy402.com";
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "1", 10);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  requiredEnv("REFRESH_COOKIES_WORKER_URL");
  requiredEnv("INGESTION_TRIGGER_TOKEN");

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Set a realistic viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });

    console.log(`Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait for Cloudflare challenge to resolve (if any)
    let challengeResolved = false;
    try {
      await page.waitForFunction(
        () => !document.querySelector(".cf-browser-verification"),
        { timeout: 30000 }
      );
      challengeResolved = true;
      console.log("Cloudflare challenge resolved.");
    } catch {
      console.log("No Cloudflare challenge detected or timed out; proceeding...");
    }

    // If challenge wasn't resolved and we have retries left, try once more
    if (!challengeResolved && MAX_RETRIES > 0) {
      console.log("Retrying navigation once...");
      await sleep(2000);
      await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 });
      try {
        await page.waitForFunction(
          () => !document.querySelector(".cf-browser-verification"),
          { timeout: 30000 }
        );
        challengeResolved = true;
        console.log("Cloudflare challenge resolved on retry.");
      } catch {
        console.log("Challenge still not resolved on retry; proceeding...");
      }
    }

    // Extract cookies
    const cookies = await page.cookies();
    const cfClearance = cookies.find((c) => c.name === "cf_clearance");
    const cfBm = cookies.find((c) => c.name === "__cf_bm");

    if (!cfClearance || !cfBm) {
      console.error(
        "Missing required cookies. Found:",
        cookies.map((c) => c.name)
      );
      process.exit(1);
    }

    console.log(`Got cf_clearance: ${cfClearance.value.substring(0, 30)}...`);
    console.log(`Got __cf_bm: ${cfBm.value.substring(0, 30)}...`);

    // Push to Worker
    const updateUrl = `${WORKER_URL.replace(/\/$/, "")}/update-cookies`;
    const response = await fetch(updateUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INGESTION_TRIGGER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cf_clearance: cfClearance.value,
        __cf_bm: cfBm.value,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Failed to update cookies: ${response.status} ${text}`);
      process.exit(1);
    }

    const result = await response.json();
    console.log("Cookies updated successfully:", result);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
