import assert from "node:assert/strict";
import test from "node:test";
import { submitAndWait, UrlScannerApiError } from "../src/url-scanner";
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
  runs: unknown[][] = [];

  prepare() {
    return {
      bind: (...bindings: unknown[]) => {
        this.bindings = bindings;
        return {
          run: async () => {
            this.runs.push(bindings);
            return { success: true };
          },
        };
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
    assert.equal(db.runs.length, 2);
    const verdictRun = db.runs[0]!;
    const summaryRun = db.runs[1]!;
    assert.equal(verdictRun[0], "scan-123");
    assert.equal(verdictRun[3], 0);
    assert.equal(verdictRun[4], 42);
    assert.equal(verdictRun[5], 1);
    assert.equal(summaryRun[0], "scan-123");
    assert.equal(summaryRun[2], 0);
    assert.deepEqual(JSON.parse(String(summaryRun[3])), {});
    assert.ok(calls.every((url) => url.includes("/accounts/account-id/urlscanner/v2/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitAndWait accepts direct Cloudflare scanner response shapes", async () => {
  const originalFetch = globalThis.fetch;
  const bucket = new MemoryR2Bucket();
  const db = new MemoryD1Database();
  const testEnv = {
    RAW_ARCHIVE: bucket,
    ANALYTICS_DB: db,
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_API_TOKEN: "scanner-token",
  } as any;

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/urlscanner/v2/scan")) {
      return Response.json({ uuid: "scan-direct", url: "https://fantasy402.com", message: "Submission successful" });
    }
    if (url.endsWith("/urlscanner/v2/result/scan-direct")) {
      return Response.json({
        task: { uuid: "scan-direct", url: "https://fantasy402.com", time: "2026-05-17T00:00:00.000Z", success: true },
        verdicts: { overall: { malicious: false } },
        page: { tlsValidDays: 42 },
      });
    }
    if (url.includes("/urlscanner/v2/screenshots/scan-direct.png")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    }
    if (url.endsWith("/urlscanner/v2/har/scan-direct")) {
      return Response.json({ log: { entries: [] } });
    }
    return Response.json({ success: false }, { status: 404 });
  };

  try {
    const result = await submitAndWait("https://fantasy402.com", testEnv);
    assert.equal(result.task.uuid, "scan-direct");
    assert.equal(bucket.writes.at(0)?.key, "fantasy402/scans/2026-05-17/scan-direct.json");
    assert.equal(db.runs[0]![0], "scan-direct");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitAndWait keeps polling while Cloudflare reports queued scans as 404", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const bucket = new MemoryR2Bucket();
  const db = new MemoryD1Database();
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_API_TOKEN: "scanner-token",
    RAW_ARCHIVE: bucket,
    ANALYTICS_DB: db,
  } as unknown as Env;
  let pollCount = 0;

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => {
    callback();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/urlscanner/v2/scan")) {
      return Response.json({ uuid: "scan-queued", url: "https://fantasy402.com", message: "Submission successful" });
    }
    if (url.endsWith("/urlscanner/v2/result/scan-queued")) {
      pollCount += 1;
      if (pollCount === 1) {
        return Response.json(
          {
            message: "Scan is not finished yet",
            status: 404,
            errors: [{ title: "Scan is not finished yet", detail: "queued", status: 404 }],
            task: { uuid: "scan-queued", url: "https://fantasy402.com", time: "2026-05-17T00:00:00.000Z", status: "queued" },
          },
          { status: 404 },
        );
      }
      return Response.json({
        task: { uuid: "scan-queued", url: "https://fantasy402.com", time: "2026-05-17T00:00:00.000Z", success: true },
        verdicts: { overall: { malicious: false } },
        page: { tlsValidDays: 42 },
      });
    }
    if (url.includes("/urlscanner/v2/screenshots/scan-queued.png")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    }
    if (url.endsWith("/urlscanner/v2/har/scan-queued")) {
      return Response.json({ log: { entries: [] } });
    }
    return Response.json({ success: false }, { status: 404 });
  };

  try {
    const result = await submitAndWait("https://fantasy402.com", env);
    assert.equal(result.task.uuid, "scan-queued");
    assert.equal(pollCount, 2);
    assert.equal(db.runs[0]![0], "scan-queued");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("submitAndWait classifies Cloudflare URL Scanner API errors", async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_API_TOKEN: "scanner-token",
  } as unknown as Env;

  globalThis.fetch = async () =>
    Response.json(
      {
        success: false,
        errors: [{ code: 9106, message: "Authentication failed (status: 400)" }],
        messages: [],
        result: null,
      },
      { status: 400 },
    );

  try {
    await assert.rejects(
      () => submitAndWait("https://fantasy402.com", env, { screenshots: [] }),
      (error) => {
        assert.ok(error instanceof UrlScannerApiError);
        assert.equal(error.stage, "submission");
        assert.equal(error.method, "POST");
        assert.equal(error.path, "/urlscanner/v2/scan");
        assert.equal(error.status, 400);
        assert.equal(error.code, 9106);
        assert.equal(error.apiMessage, "Authentication failed (status: 400)");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
