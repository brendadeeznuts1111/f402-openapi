import assert from "node:assert/strict";
import test from "node:test";
import { submitAndWait } from "../src/url-scanner";
import type { Env } from "../src/index";

class MemoryR2Bucket {
  readonly writes: { key: string; value: unknown; options: unknown }[] = [];

  async put(key: string, value: unknown, options: unknown) {
    this.writes.push({ key, value, options });
    return {
      key,
      etag: "etag",
      size: typeof value === "string" ? value.length : 0,
      uploaded: new Date("2026-05-17T00:00:00.000Z"),
      storageClass: "InfrequentAccess",
    };
  }
}

class MemoryD1Database {
  bindings: unknown[] = [];

  prepare() {
    return {
      bind: (...bindings: unknown[]) => {
        this.bindings = bindings;
        return { run: async () => ({ success: true }) };
      },
    };
  }
}

test("submitAndWait archives scanner artifacts and stores verdict", async () => {
  const originalFetch = globalThis.fetch;
  const bucket = new MemoryR2Bucket();
  const db = new MemoryD1Database();
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_API_TOKEN: "scanner-token",
    RAW_ARCHIVE: bucket,
    ANALYTICS_DB: db,
  } as unknown as Env;

  const scanResult = {
    result: {
      task: {
        uuid: "scan-123",
        url: "https://fantasy402.com",
        time: "2026-05-17T00:00:00.000Z",
        success: true,
      },
      verdicts: { overall: { malicious: false } },
      page: { tlsValidDays: 42 },
      meta: { processors: { agentReadiness: { level: 1 } } },
    },
  };

  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/urlscanner/v2/scan")) {
      return Response.json({ result: { uuid: "scan-123" } });
    }
    if (url.endsWith("/urlscanner/v2/result/scan-123")) {
      return Response.json(scanResult);
    }
    if (url.includes("/urlscanner/v2/screenshots/scan-123.png")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    }
    if (url.endsWith("/urlscanner/v2/har/scan-123")) {
      return Response.json({ log: { entries: [] } });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const result = await submitAndWait("https://fantasy402.com", env, {
      agentReadiness: true,
      screenshots: ["desktop", "mobile"],
    });

    assert.equal(result.task.uuid, "scan-123");
    assert.equal(bucket.writes.length, 4);
    assert.deepEqual(
      bucket.writes.map((write) => write.key),
      [
        "fantasy402/scans/2026-05-17/scan-123.json",
        "fantasy402/screenshots/scan-123_desktop.png",
        "fantasy402/screenshots/scan-123_mobile.png",
        "fantasy402/hars/scan-123.har",
      ],
    );
    assert.equal(db.bindings[0], "scan-123");
    assert.equal(db.bindings[3], 0);
    assert.equal(db.bindings[4], 42);
    assert.equal(db.bindings[5], 1);
    assert.ok(calls.every((url) => url.includes("/accounts/account-id/urlscanner/v2/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
