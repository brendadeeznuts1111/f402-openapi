import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";
import { UPSTREAM_MANIFEST } from "../src/upstream-manifest";

class MemoryR2Bucket {
  async list() {
    return { objects: [], truncated: false };
  }
  async get() {
    return null;
  }
}

class MemoryD1Database {
  prepare() {
    return {
      bind: () => ({
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
    };
  }
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "test",
    WORKER_NAME: "fantasy402-ingestion",
    CLOUDFLARE_ACCOUNT_ID: "7a470541a704caaf91e71efccc78fd36",
    CLOUDFLARE_ZONE_ID: "a3b7ba4bb62cb1b177b04b8675250674",
    INGESTION_TRIGGER_TOKEN: "test-token",
    FANTASY402_USERNAME: "user",
    FANTASY402_PASSWORD: "pass",
    FANTASY402_AGENT_ID: "agent",
    FANTASY402_BASE_URL: "https://fantasy402.test",
    CLOUDFLARE_API_TOKEN: "cf-token",
    FANTASY402_INGESTION_ENDPOINTS: "getBetTicker,getAgentPerformance",
    SESSION_KV: {} as any,
    AUTH_CACHE: {} as any,
    RAW_ARCHIVE: new MemoryR2Bucket() as any,
    ANALYTICS_DB: new MemoryD1Database() as any,
    ...overrides,
  } as any;
}

function authorized(path: string): Request {
  return new Request(`https://worker.test${path}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

test("upstream-endpoints requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/upstream-endpoints"), env());
  assert.equal(response.status, 401);
});

test("upstream-endpoints returns full manifest with configured flags", async () => {
  const response = await worker.fetch(authorized("/upstream-endpoints"), env());
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    count: number;
    configuredCount: number;
    implementedCount: number;
    spec: string;
    routes: Array<{
      key: string;
      configured: boolean;
      implemented: boolean;
      contentType: string;
      operationId: string;
    }>;
  };

  assert.equal(body.count, UPSTREAM_MANIFEST.endpoints.length);
  assert.equal(body.routes.length, UPSTREAM_MANIFEST.endpoints.length);
  assert.equal(body.configuredCount, 2);
  assert.equal(body.implementedCount, UPSTREAM_MANIFEST.endpoints.length);

  const betTicker = body.routes.find((route) => route.key === "getBetTicker");
  assert.ok(betTicker);
  assert.equal(betTicker.configured, true);
  assert.equal(betTicker.implemented, true);
  assert.equal(betTicker.contentType, "application/x-www-form-urlencoded");

  const manifestEntry = UPSTREAM_MANIFEST.endpoints.find((entry) => entry.key === "getBetTicker");
  assert.ok(manifestEntry);
  assert.equal(betTicker.operationId, manifestEntry.operationId);
  assert.equal(body.spec, UPSTREAM_MANIFEST.spec);
});
