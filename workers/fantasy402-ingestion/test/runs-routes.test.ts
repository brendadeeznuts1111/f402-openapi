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
  constructor(
    private readonly runsRows: Record<string, unknown>[] = [],
    private readonly snapshotsRows: Record<string, unknown>[] = [],
    private readonly failuresRows: Record<string, unknown>[] = [],
  ) {}

  prepare(sql = "") {
    return {
      bind: (...bindings: unknown[]) => ({
        all: async () => ({
          results: sql.includes("FROM ingestion_runs")
            ? this.runsRows.slice(0, Number(bindings[0] ?? this.runsRows.length))
            : sql.includes("FROM api_snapshots")
              ? this.snapshotsRows.filter((row) => row.run_id === bindings[0] || bindings[0] === undefined)
              : sql.includes("FROM endpoint_failures")
                ? this.failuresRows.filter((row) => row.run_id === bindings[0] || bindings[0] === undefined)
                : [],
        }),
        run: async () => ({ success: true }),
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

function authorized(path: string): Request {
  return new Request(`https://worker.test${path}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

test("runs list requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/runs"), env(new MemoryD1Database()));
  assert.equal(response.status, 401);
});

test("runs list returns ingestion run rows", async () => {
  const runId = "00000000-0000-4000-8000-000000000000";
  const db = new MemoryD1Database([
    {
      id: runId,
      started_at: "2026-05-17T00:00:00.000Z",
      finished_at: "2026-05-17T00:01:00.000Z",
      status: "success",
      endpoints_requested: "getAgentPerformance,getAgentBilling",
      endpoints_succeeded: 2,
      endpoints_failed: 0,
      error_message: null,
    },
  ]);
  const response = await worker.fetch(authorized("/runs?limit=5"), env(db));
  assert.equal(response.status, 200);
  const body = await response.json() as { limit: number; runs: Array<{ id: string }> };
  assert.equal(body.limit, 5);
  assert.equal(body.runs.length, 1);
  assert.equal(body.runs.at(0)?.id, runId);
});

test("run endpoints requires runId", async () => {
  const response = await worker.fetch(authorized("/runs/endpoints"), env(new MemoryD1Database()));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "runId is required" });
});

test("run endpoints rejects invalid runId", async () => {
  const response = await worker.fetch(authorized("/runs/endpoints?runId=not-a-run"), env(new MemoryD1Database()));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "runId must be a valid UUID" });
});

test("run endpoints returns snapshots and failures", async () => {
  const runId = "00000000-0000-4000-8000-000000000000";
  const db = new MemoryD1Database(
    [],
    [
      {
        id: "snap-1",
        run_id: runId,
        endpoint_key: "getAgentPerformance",
        path: "/cloud/api/Manager/getAgentPerformance",
        captured_at: "2026-05-17T00:00:00.000Z",
        http_status: 200,
        attempts: 1,
        r2_key: "fantasy402/getAgentPerformance/2026-05-17/snap-1.json",
        trace_id: "trace-1",
        duration_ms: 123,
      },
    ],
    [
      {
        id: "fail-1",
        run_id: runId,
        endpoint_key: "getAgentBilling",
        path: "/cloud/api/Manager/getAgentBilling",
        failed_at: "2026-05-17T00:00:10.000Z",
        attempts: 3,
        error_message: "boom",
        r2_key: "fantasy402/getAgentBilling/failures/2026-05-17/fail-1.json",
        trace_id: "trace-2",
        duration_ms: 456,
      },
    ],
  );
  const response = await worker.fetch(authorized(`/runs/endpoints?runId=${runId}`), env(db));
  assert.equal(response.status, 200);
  const body = await response.json() as { runId: string; snapshots: unknown[]; failures: unknown[] };
  assert.equal(body.runId, runId);
  assert.equal(body.snapshots.length, 1);
  assert.equal(body.failures.length, 1);
});
