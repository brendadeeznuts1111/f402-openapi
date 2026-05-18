import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";

class MemoryR2Bucket {
  async list() {
    return { objects: [], truncated: false };
  }
  async get() {
    return null;
  }
  async put() {
    return { key: "k", etag: "e", size: 1, uploaded: new Date(), storageClass: "InfrequentAccess" };
  }
}

class MemoryD1Database {
  private rules: Record<string, unknown>[] = [];
  private log: Record<string, unknown>[] = [];
  private nextId = 1;

  prepare(sql = "") {
    const lower = sql.toLowerCase().trim();
    const isSelect = lower.startsWith("select");
    const isInsert = lower.startsWith("insert");
    const isDelete = lower.startsWith("delete");
    const isUpdate = lower.startsWith("update");

    return {
      bind: (...bindings: unknown[]) => ({
        all: async () => {
          if (sql.includes("FROM alert_rules")) {
            return { results: this.rules.slice(0, Number(bindings[0] ?? this.rules.length)) };
          }
          if (sql.includes("FROM alert_log")) {
            const limit = typeof bindings[bindings.length - 1] === "number" ? bindings[bindings.length - 1] as number : 50;
            return { results: this.log.slice(0, limit) };
          }
          return { results: [] };
        },
        first: async () => {
          if (sql.includes("COUNT(*)")) {
            return { cnt: 0 };
          }
          if (sql.includes("MAX(amount_wagered)")) {
            return { val: 0 };
          }
          if (sql.includes("SUM(amount_wagered)")) {
            return { val: 0 };
          }
          if (sql.includes("SUM(net_amount)")) {
            return { val: 0 };
          }
          if (sql.includes("COUNT(*)")) {
            return { val: 0 };
          }
          if (sql.includes("SUM(CASE")) {
            return { val: 0 };
          }
          return { val: 0 };
        },
        run: async () => {
          if (isInsert && sql.includes("INTO alert_rules")) {
            const record: Record<string, unknown> = {};
            const fields = ["id", "agent_id", "metric", "operator", "threshold", "severity", "enabled", "created_at", "updated_at"];
            bindings.forEach((b: unknown, i: number) => {
              if (i < fields.length) record[fields[i]!] = b;
            });
            this.rules.push(record);
            return { success: true, meta: { changes: 1 } };
          }
          if (isInsert && sql.includes("INTO alert_log")) {
            const record: Record<string, unknown> = {};
            const fields = ["id", "rule_id", "agent_id", "metric", "actual_value", "threshold", "operator", "severity", "message", "created_at"];
            bindings.forEach((b: unknown, i: number) => {
              if (i < fields.length) record[fields[i]!] = b;
            });
            this.log.push(record);
            return { success: true, meta: { changes: 1 } };
          }
          if (isDelete) {
            const id = bindings[0] as string;
            const idx = this.rules.findIndex((r) => r.id === id);
            if (idx >= 0) {
              this.rules.splice(idx, 1);
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (isUpdate) {
            const id = bindings[bindings.length - 1] as string;
            const rule = this.rules.find((r) => r.id === id);
            if (rule) {
              let bi = 0;
              if (sql.includes("enabled = ?")) {
                rule.enabled = bindings[bi++];
              }
              if (sql.includes("severity = ?")) {
                rule.severity = bindings[bi++];
              }
              if (sql.includes("threshold = ?")) {
                rule.threshold = bindings[bi++];
              }
              if (sql.includes("updated_at = ?")) {
                rule.updated_at = bindings[bi];
              }
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
      }),
    };
  }
}

function env(db: MemoryD1Database, overrides: Record<string, unknown> = {}) {
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
    FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance,getAgentBilling",
    SESSION_KV: {} as any,
    AUTH_CACHE: {} as any,
    RAW_ARCHIVE: new MemoryR2Bucket() as any,
    ANALYTICS_DB: db as any,
    ...overrides,
  } as any;
}

function authorized(method: string, path: string, body?: unknown): Request {
  return new Request(`https://worker.test${path}`, {
    method,
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null,
  } as RequestInit);
}

test("alert-rules POST requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/alert-rules", { method: "POST" }), env(new MemoryD1Database()));
  assert.equal(response.status, 401);
});

test("alert-rules POST creates a rule", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    authorized("POST", "/alert-rules", { metric: "wager_amount", operator: "gt", threshold: 50000, severity: "warning" }),
    env(db),
  );
  assert.equal(response.status, 201);
  const body = await response.json() as any;
  assert.equal(body.status, "created");
  assert.match(body.rule.id, /^[0-9a-f-]+$/);
  assert.equal(body.rule.metric, "wager_amount");
  assert.equal(body.rule.operator, "gt");
  assert.equal(body.rule.threshold, 50000);
  assert.equal(body.rule.severity, "warning");
  assert.equal(body.rule.enabled, 1);
});

test("alert-rules POST validates required fields", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    authorized("POST", "/alert-rules", { metric: "invalid" }),
    env(db),
  );
  assert.equal(response.status, 400);
  const body = await response.json() as any;
  assert.equal(body.status, "failed");
});

test("alert-rules POST validates threshold", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    authorized("POST", "/alert-rules", { metric: "wager_amount", operator: "gt", threshold: -1 }),
    env(db),
  );
  assert.equal(response.status, 400);
});

test("alert-rules GET requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/alert-rules"), env(new MemoryD1Database()));
  assert.equal(response.status, 401);
});

test("alert-rules GET returns rules", async () => {
  const db = new MemoryD1Database();
  await worker.fetch(
    authorized("POST", "/alert-rules", { metric: "total_volume", operator: "gt", threshold: 10000000 }),
    env(db),
  );
  const response = await worker.fetch(
    authorized("GET", "/alert-rules?limit=10"),
    env(db),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.total, 1);
  assert.equal(body.rules.length, 1);
  assert.equal(body.rules[0].metric, "total_volume");
});

test("alert-rules DELETE requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/alert-rules?id=abc", { method: "DELETE" }), env(new MemoryD1Database()));
  assert.equal(response.status, 401);
});

test("alert-rules DELETE removes a rule", async () => {
  const db = new MemoryD1Database();
  const create = await worker.fetch(
    authorized("POST", "/alert-rules", { metric: "agent_loss", operator: "gt", threshold: 10000 }),
    env(db),
  );
  const created = await create.json() as any;
  const ruleId = created.rule.id;

  const response = await worker.fetch(
    authorized("DELETE", `/alert-rules?id=${ruleId}`),
    env(db),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.status, "deleted");
});

test("alert-rules DELETE returns 404 for missing rule", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    authorized("DELETE", "/alert-rules?id=00000000-0000-4000-8000-000000000000"),
    env(db),
  );
  assert.equal(response.status, 404);
});

test("alert-rules PATCH toggles enabled", async () => {
  const db = new MemoryD1Database();
  const create = await worker.fetch(
    authorized("POST", "/alert-rules", { metric: "agent_wager_count", operator: "gt", threshold: 100 }),
    env(db),
  );
  const created = await create.json() as any;

  const response = await worker.fetch(
    authorized("PATCH", `/alert-rules?id=${created.rule.id}`, { enabled: false }),
    env(db),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.status, "updated");
});

test("alert-log GET requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/alert-log"), env(new MemoryD1Database()));
  assert.equal(response.status, 401);
});

test("alert-log GET returns entries", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    authorized("GET", "/alert-log?limit=10"),
    env(db),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.total, 0);
  assert.equal(body.entries.length, 0);
});

test("alert-rules POST creates rule with agent_id", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    authorized("POST", "/alert-rules", {
      agent_id: "BILLY666",
      metric: "agent_volume",
      operator: "gt",
      threshold: 500000,
      severity: "critical",
    }),
    env(db),
  );
  assert.equal(response.status, 201);
  const body = await response.json() as any;
  assert.equal(body.rule.agent_id, "BILLY666");
  assert.equal(body.rule.severity, "critical");
});

test("alert-rules POST with wildcard agent_id", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    authorized("POST", "/alert-rules", { metric: "total_volume", operator: "gt", threshold: 10000000 }),
    env(db),
  );
  assert.equal(response.status, 201);
  const body = await response.json() as any;
  assert.equal(body.rule.agent_id, "*");
});
