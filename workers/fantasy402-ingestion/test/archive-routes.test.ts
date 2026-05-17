import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";

interface StoredObject {
  key: string;
  body: string;
  etag: string;
  size: number;
  uploaded: Date;
  storageClass: string;
  httpMetadata: Record<string, string>;
  customMetadata: Record<string, string>;
}

class MemoryR2Object {
  readonly key: string;
  readonly etag: string;
  readonly size: number;
  readonly uploaded: Date;
  readonly storageClass: string;
  readonly httpMetadata: Record<string, string>;
  readonly customMetadata: Record<string, string>;

  constructor(private readonly stored: StoredObject) {
    this.key = stored.key;
    this.etag = stored.etag;
    this.size = stored.size;
    this.uploaded = stored.uploaded;
    this.storageClass = stored.storageClass;
    this.httpMetadata = stored.httpMetadata;
    this.customMetadata = stored.customMetadata;
  }

  get body(): ReadableStream<Uint8Array> {
    return new Response(this.stored.body).body!;
  }

  writeHttpMetadata(headers: Headers): void {
    if (this.httpMetadata.contentType) headers.set("Content-Type", this.httpMetadata.contentType);
    if (this.httpMetadata.cacheControl) headers.set("Cache-Control", this.httpMetadata.cacheControl);
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<string, StoredObject>();

  seed(key: string, body: string, metadata: Partial<StoredObject> = {}): void {
    this.objects.set(key, {
      key,
      body,
      etag: metadata.etag ?? "test-etag",
      size: metadata.size ?? body.length,
      uploaded: metadata.uploaded ?? new Date("2026-05-17T00:00:00.000Z"),
      storageClass: metadata.storageClass ?? "InfrequentAccess",
      httpMetadata: metadata.httpMetadata ?? {
        contentType: "application/json; charset=utf-8",
        cacheControl: "no-store, max-age=0",
      },
      customMetadata: metadata.customMetadata ?? {
        source: "fantasy402",
        endpoint: "getAgentPerformance",
        archiveType: "success",
      },
    });
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? "";
    const limit = options.limit ?? 1000;
    const start = options.cursor ? Number(options.cursor) : 0;
    const all = [...this.objects.values()]
      .filter((object) => object.key.startsWith(prefix))
      .sort((a, b) => a.key.localeCompare(b.key));
    const page = all.slice(start, start + limit);
    const next = start + page.length;
    return {
      objects: page.map((object) => new MemoryR2Object(object)),
      truncated: next < all.length,
      cursor: next < all.length ? String(next) : undefined,
    };
  }

  async get(key: string) {
    const object = this.objects.get(key);
    return object ? new MemoryR2Object(object) : null;
  }
}

function env(bucket: MemoryR2Bucket) {
  return {
    ENVIRONMENT: "test",
    INGESTION_TRIGGER_TOKEN: "test-token",
    RAW_ARCHIVE: bucket,
  } as any;
}

function authorized(path: string): Request {
  return new Request(`https://worker.test${path}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

test("archive list requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/archive"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "failed", message: "Unauthorized" });
});

test("archive list returns R2 object metadata", async () => {
  const bucket = new MemoryR2Bucket();
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}", {
    etag: "etag-a",
    customMetadata: {
      source: "fantasy402",
      endpoint: "getAgentPerformance",
      archiveType: "success",
      size: "11",
    },
  });

  const response = await worker.fetch(authorized("/archive?prefix=fantasy402/getAgentPerformance&limit=10"), env(bucket));
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
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}");
  bucket.seed("other/private.json", "{\"leak\":true}");

  const response = await worker.fetch(authorized("/archive?prefix=other&limit=10"), env(bucket));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.objects.length, 1);
  assert.equal(body.objects[0].key, "fantasy402/getAgentPerformance/2026-05-17/archive-a.json");
});

test("archive object returns JSON body and archive headers", async () => {
  const bucket = new MemoryR2Bucket();
  const key = "fantasy402/getAgentPerformance/2026-05-17/archive-a.json";
  bucket.seed(key, "{\"ok\":true}", { etag: "etag-a" });

  const response = await worker.fetch(authorized(`/archive/object?key=${encodeURIComponent(key)}`), env(bucket));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("ETag"), "etag-a");
  assert.equal(response.headers.get("X-Archive-Key"), key);
  assert.equal(response.headers.get("X-Archive-Storage-Class"), "InfrequentAccess");
  assert.deepEqual(await response.json(), { ok: true });
});

test("archive object rejects non-archive keys", async () => {
  const response = await worker.fetch(authorized("/archive/object?key=other/private.json"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "Invalid key prefix" });
});
