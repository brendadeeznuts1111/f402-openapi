import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";
import { createComponentHarness, MemoryD1Database, MemoryR2Bucket } from "./harness";

test("archive list requires bearer auth", async () => {
  const harness = createComponentHarness();
  const response = await worker.fetch(harness.request("/archive"), harness.env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: "AUTH_001", message: "Unauthorized" } });
});

test("archive viewer serves operator UI without exposing data", async () => {
  const harness = createComponentHarness();
  const response = await worker.fetch(harness.request("/archive/viewer"), harness.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy") ?? "", /connect-src 'self'/);
  const html = await response.text();
  assert.match(html, /Fantasy402 Archive Viewer/);
  assert.match(html, /Bearer token/);
  assert.match(html, /Load Scans/);
  assert.doesNotMatch(html, /test-token/);
});

test("archive list returns R2 object metadata", async () => {
  const bucket = new MemoryR2Bucket();
  const harness = createComponentHarness({ bucket });
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}", {
    etag: "etag-a",
    customMetadata: {
      source: "fantasy402",
      endpoint: "getAgentPerformance",
      archiveType: "success",
      size: "11",
    },
  });

  const response = await worker.fetch(harness.authorized("/archive?prefix=fantasy402/getAgentPerformance&limit=10"), harness.env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.objects.length, 1);
  assert.equal(body.objects[0].key, "fantasy402/getAgentPerformance/2026-05-17/archive-a.json");
  assert.equal(body.objects[0].etag, "etag-a");
  assert.equal(body.objects[0].storageClass, "InfrequentAccess");
  assert.equal(body.objects[0].httpMetadata.cacheControl, "no-store, max-age=0");
  assert.equal(body.objects[0].customMetadata.archiveType, "success");
  assert.equal(body.truncated, false);
  assert.equal(body.cursor, null);
});

test("archive list clamps external prefixes to the fantasy402 root", async () => {
  const bucket = new MemoryR2Bucket();
  const harness = createComponentHarness({ bucket });
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}");
  bucket.seed("other/private.json", "{\"leak\":true}");

  const response = await worker.fetch(harness.authorized("/archive?prefix=other&limit=10"), harness.env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.objects.length, 1);
  assert.equal(body.objects[0].key, "fantasy402/getAgentPerformance/2026-05-17/archive-a.json");
});

test("archive object returns JSON body and archive headers", async () => {
  const bucket = new MemoryR2Bucket();
  const harness = createComponentHarness({ bucket });
  const key = "fantasy402/getAgentPerformance/2026-05-17/archive-a.json";
  bucket.seed(key, "{\"ok\":true}", { etag: "etag-a" });

  const response = await worker.fetch(harness.authorized(`/archive/object?key=${encodeURIComponent(key)}`), harness.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("ETag"), "etag-a");
  assert.equal(response.headers.get("X-Archive-Key"), key);
  assert.equal(response.headers.get("X-Archive-Storage-Class"), "InfrequentAccess");
  assert.deepEqual(await response.json(), { ok: true });
});

test("archive object rejects non-archive keys", async () => {
  const harness = createComponentHarness();
  const response = await worker.fetch(harness.authorized("/archive/object?key=other/private.json"), harness.env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: { code: "VALIDATION_001", message: "Invalid key prefix" } });
});

test("archive viewer route does not bypass archive API auth", async () => {
  const bucket = new MemoryR2Bucket();
  const harness = createComponentHarness({ bucket });
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}");

  await worker.fetch(harness.request("/archive/viewer"), harness.env);
  const response = await worker.fetch(harness.request("/archive?prefix=fantasy402/"), harness.env);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: "AUTH_001", message: "Unauthorized" } });
});

test("scan verdict list requires bearer auth", async () => {
  const harness = createComponentHarness();
  const response = await worker.fetch(harness.request("/scans"), harness.env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: { code: "AUTH_001", message: "Unauthorized" } });
});

test("scan verdict list returns D1 rows", async () => {
  const rows = [
    {
      scan_id: "scan-123",
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: "fantasy402/scans/2026-05-17/scan-123.json",
      screenshot_r2_key: "fantasy402/screenshots/scan-123_desktop.png",
      har_r2_key: "fantasy402/hars/scan-123.har",
    },
  ];
  const harness = createComponentHarness({
    db: new MemoryD1Database([{ match: /FROM scans_verdicts/, rows }]),
  });
  const response = await worker.fetch(harness.authorized("/scans?limit=5"), harness.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: rows });
});

test("manual scan trigger requires bearer auth", async () => {
  const harness = createComponentHarness();
  const response = await worker.fetch(
    harness.request("/scans/trigger", { method: "POST" }),
    harness.env,
  );
  assert.equal(response.status, 401);
});

test("manual scan trigger rejects invalid URLs before external calls", async () => {
  const harness = createComponentHarness();
  const response = await worker.fetch(
    harness.authorized("/scans/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "not-a-url" }),
    }),
    harness.env,
  );
  assert.equal(response.status, 400);
  const body = await response.json() as { success: false; error: { code: string; message: string } };
  assert.equal(body.success, false);
  assert.equal(body.error.code, "VALIDATION_001");
  assert.equal(body.error.message, "Invalid URL");
});
