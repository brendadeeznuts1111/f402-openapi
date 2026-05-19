import assert from "node:assert/strict";
import test from "node:test";
import {
  loadLatestEndpointArchive,
  mapGradedWagersToPerfRows,
} from "../src/snapshot-fallback";

class MemoryR2Bucket {
  private objects = new Map<string, string>();

  put(key: string, value: string) {
    this.objects.set(key, value);
  }

  async get(key: string) {
    const body = this.objects.get(key);
    if (!body) return null;
    return {
      text: async () => body,
    };
  }
}

class MemoryD1Database {
  constructor(private rows: Array<{ id: string; endpoint_key: string; r2_key: string; captured_at: string; http_status: number }>) {}

  prepare(sql: string) {
    return {
      bind: (...bindings: unknown[]) => ({
        first: async () => {
          if (!sql.includes("api_snapshots")) return null;
          const key = bindings[0];
          const match = this.rows
            .filter((r) => r.endpoint_key === key && r.http_status >= 200 && r.http_status < 300)
            .sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0];
          return match ?? null;
        },
      }),
    };
  }
}

test("loadLatestEndpointArchive reads newest snapshot JSON from R2", async () => {
  const r2 = new MemoryR2Bucket();
  const key = "fantasy402/getPending/2026-05-19/snap-1.json";
  r2.put(key, JSON.stringify({ Pending: [{ Login: "A1", WagerStatus: "O" }] }));
  const env = {
    ANALYTICS_DB: new MemoryD1Database([
      {
        id: "snap-1",
        endpoint_key: "getPending",
        r2_key: key,
        captured_at: "2026-05-19T12:00:00.000Z",
        http_status: 200,
      },
    ]),
    RAW_ARCHIVE: r2,
  };
  const hit = await loadLatestEndpointArchive(env, "getPending");
  assert.ok(hit);
  assert.equal(hit.snapshotId, "snap-1");
  assert.deepEqual((hit.data as { Pending: unknown[] }).Pending.length, 1);
});

test("mapGradedWagersToPerfRows maps D1 graded columns", () => {
  const rows = mapGradedWagersToPerfRows([
    {
      login: "GX195",
      customer_id: "GX195",
      agent_id: "BILLY666",
      wager_type: "S",
      amount_wagered: 10000,
      net_amount: 5000,
      result: "W",
      short_desc: "NFL side",
    },
  ]);
  assert.equal(rows[0].login, "GX195");
  assert.equal(rows[0].risk, 10000);
  assert.equal(rows[0].won_lost, 5000);
});
