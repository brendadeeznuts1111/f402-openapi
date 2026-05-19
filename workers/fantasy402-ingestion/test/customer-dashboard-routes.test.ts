import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";

function profileDb(overrides: {
  player?: Record<string, unknown> | null;
  facets?: Record<string, { captured_at: string; raw_snapshot_id: string; payload_json: string }>;
  account?: Record<string, unknown> | null;
  webLogStats?: { last_captured: string | null; cnt: number };
  recentWebLogs?: Record<string, unknown>[];
  search?: Record<string, unknown>[];
} = {}) {
  const facetRows = Object.entries(overrides.facets ?? {}).map(([facet, row]) => ({
    facet,
    raw_snapshot_id: row.raw_snapshot_id,
    captured_at: row.captured_at,
    payload_json: row.payload_json,
  }));

  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async all() {
              if (sql.includes("FROM customer_profile_facets")) {
                return { results: facetRows };
              }
              if (sql.includes("FROM web_logs WHERE login") && sql.includes("ORDER BY")) {
                return { results: overrides.recentWebLogs ?? [] };
              }
              if (sql.includes("FROM player_agents WHERE") && sql.includes("LIKE")) {
                return { results: overrides.search ?? [] };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("FROM player_agents WHERE customer_id")) {
                return overrides.player ?? null;
              }
              if (sql.includes("FROM customer_accounts")) {
                return overrides.account ?? null;
              }
              if (sql.includes("MAX(captured_at)") && sql.includes("web_logs")) {
                return overrides.webLogStats ?? { last_captured: null, cnt: 0 };
              }
              return null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
}

function env(overrides: Record<string, unknown> = {}) {
  return {
    ENVIRONMENT: "test",
    WORKER_NAME: "fantasy402-ingestion",
    CLOUDFLARE_ACCOUNT_ID: "7a470541a704caaf91e71efccc78fd36",
    CLOUDFLARE_ZONE_ID: "a3b7ba4bb62cb1b177b04b8675250674",
    FANTASY402_USERNAME: "user",
    FANTASY402_PASSWORD: "pass",
    FANTASY402_AGENT_ID: "BILLY666",
    FANTASY402_BASE_URL: "https://fantasy402.test",
    CLOUDFLARE_API_TOKEN: "cf-token",
    FANTASY402_INGESTION_ENDPOINTS: "getBetTicker",
    FANTASY402_WORKER_TRIGGER_MODE: "skip",
    INGESTION_TRIGGER_TOKEN: "test-token",
    SESSION_KV: {
      get: async () => null,
      put: async () => {},
    },
    AUTH_CACHE: {
      get: async () => null,
      put: async () => {},
    },
    RAW_ARCHIVE: {} as any,
    ANALYTICS_DB: profileDb() as any,
    ...overrides,
  } as any;
}

const auth = { Authorization: "Bearer test-token" };

test("GET /customer-profile requires customer_id", async () => {
  const res = await worker.fetch(new Request("https://worker.test/customer-profile", { headers: auth }), env());
  assert.equal(res.status, 400);
});

test("GET /customer-profile live=0 returns sources catalog", async () => {
  const db = profileDb({
    player: {
      customer_id: "GX195",
      login: "GX195",
      name_first: "Test",
      agent_id: "BILLY666",
      captured_at: "2026-05-01T00:00:00.000Z",
    },
    facets: {
      getInfoPlayer: {
        raw_snapshot_id: "snap-1",
        captured_at: "2026-05-02T00:00:00.000Z",
        payload_json: JSON.stringify({ INFO: { data: { Login: "GX195" } } }),
      },
    },
    webLogStats: { last_captured: "2026-05-18T00:00:00.000Z", cnt: 2 },
    recentWebLogs: [
      { operation: "login", ip_address: "1.2.3.4", access_date_time: "2026-05-18T12:00:00.000Z" },
    ],
  });
  const res = await worker.fetch(
    new Request("https://worker.test/customer-profile?customer_id=GX195&live=0", { headers: auth }),
    env({ ANALYTICS_DB: db }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    customerId: string;
    sources: { blocks: Array<{ id: string; activeSource: string }> };
    webLogs: { count24h: number };
    recentWebLogs: unknown[];
  };
  assert.equal(body.customerId, "GX195");
  assert.ok(body.sources?.blocks?.length);
  const info = body.sources.blocks.find((b) => b.id === "getInfoPlayer");
  assert.equal(info?.activeSource, "seeded");
  assert.equal(body.webLogs?.count24h, 2);
  assert.equal(body.recentWebLogs?.length, 1);
});

test("GET /search-customers returns matches", async () => {
  const db = profileDb({
    search: [{ customer_id: "GX195", login: "GX195", name_first: "T", agent_id: "A", captured_at: "2026-05-01" }],
  });
  const res = await worker.fetch(
    new Request("https://worker.test/search-customers?q=GX", { headers: auth }),
    env({ ANALYTICS_DB: db }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number; records: unknown[] };
  assert.equal(body.total, 1);
});

test("GET /agent-performance-live requires agent_id when env unset", async () => {
  const res = await worker.fetch(
    new Request("https://worker.test/agent-performance-live?type=CP", { headers: auth }),
    env({ FANTASY402_AGENT_ID: "" }),
  );
  assert.equal(res.status, 400);
});

test("POST /customer-profile/seed requires customer_id", async () => {
  const res = await worker.fetch(
    new Request("https://worker.test/customer-profile/seed", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env(),
  );
  assert.equal(res.status, 400);
});

test("GET /agent-performance-live without auth returns 401", async () => {
  const res = await worker.fetch(
    new Request("https://worker.test/agent-performance-live?type=CP"),
    env(),
  );
  assert.equal(res.status, 401);
});
