import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";

function env(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "test",
    WORKER_NAME: "fantasy402-ingestion",
    CLOUDFLARE_ACCOUNT_ID: "7a470541a704caaf91e71efccc78fd36",
    CLOUDFLARE_ZONE_ID: "a3b7ba4bb62cb1b177b04b8675250674",
    FANTASY402_USERNAME: "user",
    FANTASY402_PASSWORD: "pass",
    FANTASY402_AGENT_ID: "agent",
    FANTASY402_BASE_URL: "https://fantasy402.test",
    CLOUDFLARE_API_TOKEN: "cf-token",
    FANTASY402_INGESTION_ENDPOINTS: "getBetTicker",
    SESSION_KV: {} as any,
    AUTH_CACHE: {} as any,
    RAW_ARCHIVE: {} as any,
    ANALYTICS_DB: { prepare: () => ({ run: async () => ({ success: true }) }) } as any,
    ...overrides,
  } as any;
}

test("GET / returns HTML landing page for browser Accept headers", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/", {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    }),
    env(),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /text\/html/);
  const body = await response.text();
  assert.match(body, /Monitoring dashboard/);
  assert.match(body, /fantasy402-dashboard-5q6\.pages\.dev/);
  assert.match(body, /\/health/);
  assert.match(body, /\/archive\/viewer/);
});

test("GET / returns JSON service discovery for API clients", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/", {
      headers: { Accept: "application/json" },
    }),
    env({ FANTASY402_DASHBOARD_URL: "https://custom-dashboard.example" }),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    service: string;
    links: { dashboard: string; health: string };
  };
  assert.equal(body.service, "fantasy402-ingestion");
  assert.equal(body.links.dashboard, "https://custom-dashboard.example");
  assert.equal(body.links.health, "/health");
});

test("GET / prefers HTML when Accept lists JSON with lower q", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/", {
      headers: { Accept: "application/json;q=0.8, text/html;q=0.9" },
    }),
    env(),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /text\/html/);
});
