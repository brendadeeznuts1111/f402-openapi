import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";

function mockDb(results: {
  player?: Record<string, unknown> | null;
  webLogs?: Record<string, unknown>[];
  wagers?: Record<string, unknown>[];
  summary?: Record<string, unknown> | null;
  search?: Record<string, unknown>[];
}) {
  return {
    prepare(sql: string) {
      const stmt = {
        bind(..._args: unknown[]) {
          return {
            async all() {
              if (sql.includes("FROM player_agents WHERE login LIKE")) {
                return { results: results.search ?? [] };
              }
              if (sql.includes("FROM web_logs")) {
                return { results: results.webLogs ?? [] };
              }
              if (sql.includes("FROM bet_ticker_wagers")) {
                return { results: results.wagers ?? [] };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("FROM player_agents WHERE login = ?") && !sql.includes("LIKE")) {
                return results.player ?? null;
              }
              if (sql.includes("total_wagers")) {
                return results.summary ?? { total_wagers: 0, total_volume: 0, total_logins: 0, unique_ips: 0 };
              }
              return null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
      return stmt;
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
    FANTASY402_AGENT_ID: "agent",
    FANTASY402_BASE_URL: "https://fantasy402.test",
    CLOUDFLARE_API_TOKEN: "cf-token",
    FANTASY402_INGESTION_ENDPOINTS: "getBetTicker",
    INGESTION_TRIGGER_TOKEN: "test-token",
    SESSION_KV: {} as any,
    AUTH_CACHE: {} as any,
    RAW_ARCHIVE: {} as any,
    ANALYTICS_DB: mockDb({}) as any,
    ...overrides,
  } as any;
}

test("GET /customer-activity requires login", async () => {
  const res = await worker.fetch(
    new Request("https://worker.test/customer-activity", {
      headers: { Authorization: "Bearer test-token" },
    }),
    env(),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { message: string };
  assert.match(body.message, /login is required/i);
});

test("GET /customer-activity returns merged timeline payload", async () => {
  const db = mockDb({
    player: { customer_id: "c1", login: "PLAYER1", name_first: "Test", agent_id: "A1", captured_at: "2026-05-19T00:00:00.000Z" },
    webLogs: [{ id: "w1", login: "PLAYER1", operation: "login", data: null, ip_address: "1.2.3.4", access_date_time: "2026-05-19T12:00:00.000Z", captured_at: "2026-05-19T12:00:00.000Z" }],
    wagers: [{ id: "b1", wager_number: 1, wager_type: "S", amount_wagered: 100, to_win_amount: 90, short_desc: "Team A", captured_at: "2026-05-19T11:00:00.000Z" }],
    summary: { total_wagers: 1, total_volume: 100, total_logins: 1, unique_ips: 1 },
  });
  const res = await worker.fetch(
    new Request("https://worker.test/customer-activity?login=PLAYER1&hours=24", {
      headers: { Authorization: "Bearer test-token" },
    }),
    env({ ANALYTICS_DB: db }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    customer: { login: string };
    webLogs: unknown[];
    wagers: unknown[];
    summary: { total_wagers: number };
    period: { hours: number };
  };
  assert.equal(body.customer.login, "PLAYER1");
  assert.equal(body.webLogs.length, 1);
  assert.equal(body.wagers.length, 1);
  assert.equal(body.summary.total_wagers, 1);
  assert.equal(body.period.hours, 24);
});

test("POST /customer-activity-search requires q", async () => {
  const res = await worker.fetch(
    new Request("https://worker.test/customer-activity-search", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env(),
  );
  assert.equal(res.status, 400);
});

test("POST /customer-activity-search returns player matches", async () => {
  const db = mockDb({
    search: [{ customer_id: "c2", login: "BOB99", name_first: "Bob", agent_id: "A2", captured_at: "2026-05-19T00:00:00.000Z" }],
  });
  const res = await worker.fetch(
    new Request("https://worker.test/customer-activity-search", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ q: "bob", limit: 5 }),
    }),
    env({ ANALYTICS_DB: db }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number; records: Array<{ login: string }> };
  assert.equal(body.total, 1);
  assert.equal(body.records[0]?.login, "BOB99");
});
