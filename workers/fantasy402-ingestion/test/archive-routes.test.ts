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

  async text(): Promise<string> {
    return this.stored.body;
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

  async put(key: string, value: string | ArrayBuffer, options: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string>; storageClass?: string } = {}) {
    const body = typeof value === "string" ? value : String.fromCharCode(...new Uint8Array(value));
    const metadata: Partial<StoredObject> = {
      etag: "put-etag",
      storageClass: options.storageClass ?? "InfrequentAccess",
    };
    if (options.httpMetadata) metadata.httpMetadata = options.httpMetadata;
    if (options.customMetadata) metadata.customMetadata = options.customMetadata;
    this.seed(key, body, metadata);
    return {
      key,
      etag: "put-etag",
      size: body.length,
      uploaded: new Date("2026-05-17T00:00:00.000Z"),
      storageClass: options.storageClass ?? "InfrequentAccess",
    };
  }
}

class MemoryKVNamespace {
  private readonly store = new Map<string, string>();

  async get(key: string) {
    const value = this.store.get(key);
    return value ? JSON.parse(value) : null;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }
}

class MemoryD1Database {
  readonly runs: unknown[][] = [];

  constructor(
    private readonly scanRows: Record<string, unknown>[] = [],
    private readonly alertRows: Record<string, unknown>[] = [],
    private readonly networkSummaryRows: Record<string, unknown>[] = [],
  ) {}

  prepare(sql = "") {
    return {
      bind: (...bindings: unknown[]) => ({
        all: async () => ({
          results: sql.includes("alert_events")
            ? sql.includes("GROUP BY")
              ? summarizeAlertRows(this.alertRows)
              : this.alertRows
            : sql.includes("scan_network_summary")
              ? this.networkSummaryRows.filter((row) => row.scan_id === undefined || row.scan_id === bindings[0])
              : this.scanRows,
        }),
        run: async () => {
          this.runs.push(bindings);
          return { success: true };
        },
      }),
    };
  }
}

function summarizeAlertRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const grouped = new Map<string, { severity: string; type: string; count: number; latest: string }>();
  for (const row of rows) {
    const severity = String(row.severity ?? "unknown");
    const type = String(row.type ?? "unknown");
    const created = String(row.created_at ?? "");
    const key = `${severity}\0${type}`;
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      if (created > current.latest) current.latest = created;
    } else {
      grouped.set(key, { severity, type, count: 1, latest: created });
    }
  }
  return [...grouped.values()];
}

function env(bucket: MemoryR2Bucket, db = new MemoryD1Database(), overrides: Record<string, unknown> = {}) {
  const sessionKv = new MemoryKVNamespace();
  const authCache = new MemoryKVNamespace();
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
    SESSION_KV: sessionKv,
    AUTH_CACHE: authCache,
    RAW_ARCHIVE: bucket,
    ANALYTICS_DB: db,
    ...overrides,
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

test("archive viewer serves operator UI without exposing data", async () => {
  const response = await worker.fetch(new Request("https://worker.test/archive/viewer"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Content-Security-Policy") ?? "", /connect-src 'self'/);
  const html = await response.text();
  assert.match(html, /Fantasy402 Archive Viewer/);
  assert.match(html, /Bearer token/);
  assert.match(html, /Endpoint/);
  assert.match(html, /Archive type/);
  assert.match(html, /Scan Now/);
  assert.match(html, /Load Scans/);
  assert.match(html, /scanScreenshot/);
  assert.match(html, /Load HAR/);
  assert.match(html, /scanNetworkSummary/);
  assert.match(html, /Load Diagnostics/);
  assert.match(html, /Test Policy/);
  assert.match(html, /alertsSummary/);
  assert.match(response.headers.get("Content-Security-Policy") ?? "", /img-src blob:/);
  assert.doesNotMatch(html, /test-token/);
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

test("archive list supports endpoint date and archive type filters", async () => {
  const bucket = new MemoryR2Bucket();
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}", {
    customMetadata: { source: "fantasy402", endpoint: "getAgentPerformance", archiveType: "success" },
  });
  bucket.seed("fantasy402/getAgentPerformance/2026-05-18/archive-b.json", "{\"ok\":true}", {
    customMetadata: { source: "fantasy402", endpoint: "getAgentPerformance", archiveType: "success" },
  });
  bucket.seed("fantasy402/getAgentPerformance/failures/2026-05-17/archive-c.json", "{\"ok\":false}", {
    customMetadata: { source: "fantasy402", endpoint: "getAgentPerformance", archiveType: "failure" },
  });
  bucket.seed("fantasy402/getAgentBilling/2026-05-17/archive-d.json", "{\"ok\":true}", {
    customMetadata: { source: "fantasy402", endpoint: "getAgentBilling", archiveType: "success" },
  });

  const response = await worker.fetch(
    authorized("/archive?endpoint=getAgentPerformance&date=2026-05-17&archiveType=success&limit=10"),
    env(bucket),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.filters, {
    prefix: "fantasy402/getAgentPerformance/2026-05-17",
    endpoint: "getAgentPerformance",
    date: "2026-05-17",
    archiveType: "success",
  });
  assert.deepEqual(body.objects.map((object: any) => object.key), [
    "fantasy402/getAgentPerformance/2026-05-17/archive-a.json",
  ]);
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

test("diagnostics requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/diagnostics"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
});

test("diagnostics reports readiness and sanitized upstream auth shape without leaking secret values", async () => {
  const response = await worker.fetch(
    authorized("/diagnostics"),
    env(new MemoryR2Bucket(), new MemoryD1Database(), {
      FANTASY402_SESSION_COOKIE: "app_session=session-from-secret",
      FANTASY402_CF_CLEARANCE: "clearance-token",
      FANTASY402_CF_BM: "bm-token",
      FANTASY402_AUTHORIZATION: "browser-token",
      FANTASY402_BROWSER_HEADERS_JSON: JSON.stringify({ "user-agent": "Observed Chrome", "sec-fetch-site": "same-origin" }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.status, "ready");
  assert.equal(body.workerName, "fantasy402-ingestion");
  assert.equal(body.cloudflare.accountId, "7a470541a704caaf91e71efccc78fd36");
  assert.equal(body.cloudflare.zoneId, "a3b7ba4bb62cb1b177b04b8675250674");
  assert.equal(body.bindings.rawArchive, true);
  assert.deepEqual(body.requiredSecrets.missing, []);
  assert.deepEqual(body.requiredSecrets.present.sort(), [
      "CLOUDFLARE_API_TOKEN",
      "FANTASY402_AGENT_ID",
      "FANTASY402_PASSWORD",
      "FANTASY402_USERNAME",
  ]);
  assert.equal(body.auth.configured, true);
  assert.equal(body.auth.preferredSecret, "INGESTION_TRIGGER_TOKEN");
  assert.equal(body.upstreamAuthShape.hasAuthorization, true);
  assert.equal(body.upstreamAuthShape.hasCookie, true);
  assert.equal(body.upstreamAuthShape.hasSessionCookie, true);
  assert.equal(body.upstreamAuthShape.hasCfClearance, true);
  assert.equal(body.upstreamAuthShape.hasCfBm, true);
  assert.deepEqual(body.upstreamAuthShape.cookieNames, ["app_session", "cf_clearance", "__cf_bm"]);
  assert.equal(body.upstreamAuthShape.browserHeaderCount, 2);
  assert.equal(JSON.stringify(body).includes("cf-token"), false);
  assert.equal(JSON.stringify(body).includes("test-token"), false);
  assert.equal(JSON.stringify(body).includes("session-from-secret"), false);
  assert.equal(JSON.stringify(body).includes("clearance-token"), false);
  assert.equal(JSON.stringify(body).includes("bm-token"), false);
  assert.equal(JSON.stringify(body).includes("browser-token"), false);
});

test("diagnostics degrades when bearer and Cloudflare cookies lack an app session", async () => {
  const response = await worker.fetch(
    authorized("/diagnostics"),
    env(new MemoryR2Bucket(), new MemoryD1Database(), {
      FANTASY402_CF_CLEARANCE: "clearance-token",
      FANTASY402_CF_BM: "bm-token",
      FANTASY402_AUTHORIZATION: "browser-token",
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.status, "degraded");
  assert.equal(body.upstreamAuthShape.hasAuthorization, true);
  assert.equal(body.upstreamAuthShape.hasSessionCookie, false);
  assert.equal(body.upstreamAuthShape.ingestionReadiness.status, "blocked");
  assert.match(body.upstreamAuthShape.ingestionReadiness.blocker, /ASP\.NET_SessionId/);
});

test("diagnostics resolves account-level Secrets Store bindings", async () => {
  const response = await worker.fetch(
    authorized("/diagnostics"),
    {
      ...env(new MemoryR2Bucket()),
      FANTASY402_USERNAME: { get: async () => "store-user" },
      FANTASY402_PASSWORD: { get: async () => "store-pass" },
      FANTASY402_AGENT_ID: { get: async () => "store-agent" },
      CLOUDFLARE_API_TOKEN: { get: async () => "store-cf-token" },
      FANTASY402_SESSION_COOKIE: { get: async () => "ASP.NET_SessionId=store-session" },
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.status, "ready");
  assert.deepEqual(body.requiredSecrets.missing, []);
  assert.equal(JSON.stringify(body).includes("store-user"), false);
  assert.equal(JSON.stringify(body).includes("store-cf-token"), false);
});

test("scanner diagnostics requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/scanner/diagnostics"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
});

test("scanner diagnostics verifies Cloudflare auth without leaking token", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/accounts/7a470541a704caaf91e71efccc78fd36/tokens/verify")) {
      return Response.json({ success: true, errors: [], messages: [] });
    }
    if (url.endsWith("/accounts/7a470541a704caaf91e71efccc78fd36/urlscanner/v2/search?size=1&q=apikey:me")) {
      return Response.json({ success: true, errors: [], messages: [] });
    }
    return Response.json({ success: false, errors: [{ code: 10000, message: "unexpected" }], messages: [] }, { status: 500 });
  }) as typeof fetch;

  try {
    const response = await worker.fetch(authorized("/scanner/diagnostics"), env(new MemoryR2Bucket()));
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.status, "ready");
    assert.equal(body.subsystem, "cloudflare-url-scanner");
    assert.equal(body.tokenShape.configured, true);
    assert.equal(body.checks.length, 2);
    assert.equal(body.checks[0].stage, "token-verify");
    assert.equal(body.checks[1].stage, "url-scanner-access");
    assert.equal(body.failure, null);
    assert.equal(JSON.stringify(body).includes("cf-token"), false);
    assert.deepEqual(calls, [
      "https://api.cloudflare.com/client/v4/accounts/7a470541a704caaf91e71efccc78fd36/tokens/verify",
      "https://api.cloudflare.com/client/v4/accounts/7a470541a704caaf91e71efccc78fd36/urlscanner/v2/search?size=1&q=apikey:me",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner diagnostics resolves account-level Secrets Store bindings", async () => {
  const originalFetch = globalThis.fetch;
  const seenAuthHeaders: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenAuthHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
    return Response.json({ success: true, errors: [], messages: [] });
  }) as typeof fetch;

  try {
    const response = await worker.fetch(
      authorized("/scanner/diagnostics"),
      {
        ...env(new MemoryR2Bucket()),
        CLOUDFLARE_API_TOKEN: { get: async () => "raw-store-token" },
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.status, "ready");
    assert.equal(body.tokenShape.length, "raw-store-token".length);
    assert.deepEqual(seenAuthHeaders, ["Bearer raw-store-token", "Bearer raw-store-token"]);
    assert.equal(JSON.stringify(body).includes("raw-store-token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner diagnostics reports Secrets Store binding resolution failures", async () => {
  const response = await worker.fetch(
    authorized("/scanner/diagnostics"),
    {
      ...env(new MemoryR2Bucket()),
      CLOUDFLARE_API_TOKEN: { get: async () => { throw new Error("secret binding unavailable"); } },
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.status, "degraded");
  assert.equal(body.failure.stage, "secret-store");
  assert.match(body.failure.message, /CLOUDFLARE_API_TOKEN/);
});

test("scanner diagnostics reports malformed formatted-token secrets before external calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ success: true, errors: [], messages: [] });
  }) as typeof fetch;

  try {
    const response = await worker.fetch(
      authorized("/scanner/diagnostics"),
      {
        ...env(new MemoryR2Bucket()),
        CLOUDFLARE_API_TOKEN: "│ Value encrypted │",
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.status, "degraded");
    assert.equal(body.tokenShape.looksLikeFormattedOutput, true);
    assert.equal(body.failure.stage, "token-shape");
    assert.match(body.failure.message, /formatted CLI\/table output/);
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(body).includes("Value encrypted"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("archive auth accepts ARCHIVE_AUTH_TOKEN as a fallback alias", async () => {
  const bucket = new MemoryR2Bucket();
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}");
  const fallbackEnv = {
    ...env(bucket),
    INGESTION_TRIGGER_TOKEN: undefined,
    ARCHIVE_AUTH_TOKEN: "archive-token",
  };

  const response = await worker.fetch(
    new Request("https://worker.test/archive?prefix=fantasy402/&limit=1", {
      headers: { Authorization: "Bearer archive-token" },
    }),
    fallbackEnv,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.objects.length, 1);
});

test("archive viewer route does not bypass archive API auth", async () => {
  const bucket = new MemoryR2Bucket();
  bucket.seed("fantasy402/getAgentPerformance/2026-05-17/archive-a.json", "{\"ok\":true}");

  await worker.fetch(new Request("https://worker.test/archive/viewer"), env(bucket));
  const response = await worker.fetch(new Request("https://worker.test/archive?prefix=fantasy402/"), env(bucket));

  assert.equal(response.status, 401);
});

test("alerts list requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/alerts"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "failed", message: "Unauthorized" });
});

test("alerts list returns normalized events", async () => {
  const alerts = [
    {
      id: "alert-1",
      created_at: "2026-05-17T00:00:00.000Z",
      severity: "critical",
      type: "url-scan-malicious",
      message: "bad scan",
      context_json: "{\"scanId\":\"scan-1\"}",
    },
  ];
  const response = await worker.fetch(
    authorized("/alerts?severity=critical&type=url-scan-malicious&limit=5"),
    env(new MemoryR2Bucket(), new MemoryD1Database([], alerts)),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    filters: { severity: "critical", type: "url-scan-malicious" },
    events: [
      {
        ...alerts[0],
        context: { scanId: "scan-1" },
      },
    ],
  });
});

test("alerts summary groups recent events by severity and type", async () => {
  const alerts = [
    {
      id: "alert-1",
      created_at: "2026-05-17T00:00:00.000Z",
      severity: "warning",
      type: "url-scan-unexpected-hosts",
      message: "unexpected",
      context_json: null,
    },
    {
      id: "alert-2",
      created_at: "2026-05-17T00:01:00.000Z",
      severity: "warning",
      type: "url-scan-unexpected-hosts",
      message: "unexpected",
      context_json: null,
    },
    {
      id: "alert-3",
      created_at: "2026-05-17T00:02:00.000Z",
      severity: "critical",
      type: "url-scan-malicious",
      message: "bad",
      context_json: null,
    },
  ];
  const response = await worker.fetch(
    authorized("/alerts/summary?days=7"),
    env(new MemoryR2Bucket(), new MemoryD1Database([], alerts)),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.days, 7);
  assert.equal(body.total, 3);
  assert.deepEqual(body.bySeverity, { warning: 2, critical: 1 });
  assert.equal(body.byType["url-scan-unexpected-hosts"], 2);
  assert.equal(body.groups.length, 2);
});

test("synthetic alert requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/alerts/test", { method: "POST" }), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "failed", message: "Unauthorized" });
});

test("synthetic alert persists bounded operator alert", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    new Request("https://worker.test/alerts/test", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ severity: "critical", message: "x".repeat(600) }),
    }),
    env(new MemoryR2Bucket(), db),
  );
  assert.equal(response.status, 201);
  const body = await response.json() as any;
  assert.equal(body.status, "created");
  assert.equal(body.event.severity, "critical");
  assert.equal(body.event.type, "synthetic-test");
  assert.equal(body.event.message.length, 500);
  assert.equal(body.event.context.synthetic, true);
  assert.equal(db.runs.length, 1);
});

test("synthetic policy alert exercises network policy alert types", async () => {
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    new Request("https://worker.test/alerts/policy-test", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    }),
    env(new MemoryR2Bucket(), db),
  );
  assert.equal(response.status, 201);
  const body = await response.json() as any;
  assert.equal(body.status, "created");
  assert.equal(body.synthetic, true);
  const alertTypes = db.runs.map((bindings) => bindings[3]);
  assert.deepEqual(alertTypes, [
    "url-scan-unexpected-hosts",
    "url-scan-new-third-party",
    "url-scan-failed-requests",
  ]);
});

test("ingestion uses JSON encoding for browser-to-api JSON endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{ url: string; contentType: string | null; body: string }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      contentType: init?.headers instanceof Headers
        ? init.headers.get("Content-Type")
        : (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ?? null,
      body: typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "",
    });
    if (url.endsWith("/cloud/api/System/authenticateCustomer")) {
      return Response.json({ tokenauth: "login-token" }, { headers: { "Set-Cookie": "app_session=test-session; Path=/; HttpOnly" } });
    }
    if (url.endsWith("/cloud/api/Manager/getPending")) {
      return Response.json({ Pending: [] });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        FANTASY402_CUSTOMER_ID: "CUST1",
        FANTASY402_INGESTION_ENDPOINTS: "getPending",
      }),
    );
    assert.equal(response.status, 202);
    const pendingRequest = seen.find((request) => request.url.endsWith("/cloud/api/Manager/getPending"));
    assert.ok(pendingRequest);
    assert.equal(pendingRequest.contentType, "application/json");
    assert.deepEqual(Object.keys(JSON.parse(pendingRequest.body)).sort(), [
      "RRO",
      "agentID",
      "agentOwner",
      "customerID",
      "date",
      "path",
      "sort",
      "typeSort",
      "wagerType",
      "week",
    ].sort());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestion includes static RRO flag on configured Fantasy402 endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{ url: string; contentType: string | null; body: string }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      contentType: init?.headers instanceof Headers
        ? init.headers.get("Content-Type")
        : (init?.headers as Record<string, string> | undefined)?.["Content-Type"] ?? null,
      body: typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "",
    });
    return Response.json({ ok: true });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        FANTASY402_SESSION_COOKIE: "app_session=test-session",
        FANTASY402_AUTHORIZATION: "browser-token",
        FANTASY402_INGESTION_ENDPOINTS: [
          "getAgentPerformance",
          "getAgentBilling",
          "getEnterTransactions",
          "getPlayers",
          "getAddedInfo",
          "getLineTypes",
          "getHeriarchy",
        ].join(","),
      }),
    );
    assert.equal(response.status, 202);

    const expectedOperations = new Set([
      "getAgentPerformance",
      "getAgentBilling",
      "getEnterTransactions",
      "getPlayers",
      "getAddedInfo",
      "getLineTypes",
      "getHeriarchy",
    ]);
    const apiRequests = seen.filter((request) => request.url.includes("/cloud/api/"));
    assert.equal(apiRequests.length, expectedOperations.size);
    for (const request of apiRequests) {
      const params = new URLSearchParams(request.body);
      assert.equal(params.get("RRO"), "1", `${request.url} should include RRO=1`);
      assert.equal(params.get("agentID"), "agent", `${request.url} should include agentID`);
      assert.equal(params.get("agentOwner"), "agent", `${request.url} should include agentOwner`);
      assert.equal(expectedOperations.has(params.get("operation") ?? ""), true, `${request.url} should include known operation`);
      expectedOperations.delete(params.get("operation") ?? "");
    }
    assert.deepEqual([...expectedOperations], []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual ingestion trigger returns JSON on upstream login failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/cloud/api/System/authenticateCustomer")) {
      return Response.json({ status: "Failed" }, { status: 403 });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
    assert.deepEqual(await response.json(), {
      status: "failed",
      message: "Fantasy402 authenticateCustomer failed with HTTP 403",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestion can use browser-observed auth headers without login", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{
    url: string;
    authorization: string | null;
    cookie: string | null;
    origin: string | null;
    requestedWith: string | null;
    userAgent: string | null;
    secFetchSite: string | null;
    secChPlatform: string | null;
  }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      authorization: headers.get("Authorization"),
      cookie: headers.get("Cookie"),
      origin: headers.get("Origin"),
      requestedWith: headers.get("X-Requested-With"),
      userAgent: headers.get("User-Agent"),
      secFetchSite: headers.get("Sec-Fetch-Site"),
      secChPlatform: headers.get("Sec-CH-UA-Platform"),
    });
    if (url.endsWith("/cloud/api/System/authenticateCustomer")) {
      return Response.json({ status: "Failed" }, { status: 500 });
    }
    if (url.endsWith("/cloud/api/Manager/getAgentPerformance")) {
      return Response.json({ performance: [] });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        FANTASY402_SESSION_COOKIE: "app_session=from-browser-session",
        FANTASY402_CF_CLEARANCE: "clearance-token",
        FANTASY402_CF_BM: "__cf_bm=bm-token",
        FANTASY402_AUTHORIZATION: "browser-token",
        FANTASY402_BROWSER_HEADERS_JSON: JSON.stringify({
          "accept-language": "en-US,en;q=0.8",
          "user-agent": "Observed Chrome",
          "sec-fetch-site": "same-origin",
          cookie: "should-not-override",
          authorization: "should-not-override",
          "content-type": "text/plain",
        }),
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 202);
    assert.equal(seen.some((request) => request.url.endsWith("/cloud/api/Auth/login")), false);
    const apiRequest = seen.find((request) => request.url.endsWith("/cloud/api/Manager/getAgentPerformance"));
    assert.equal(apiRequest?.authorization, "Bearer browser-token");
    assert.equal(apiRequest?.cookie, "app_session=from-browser-session; cf_clearance=clearance-token; __cf_bm=bm-token");
    assert.equal(apiRequest?.origin, "https://fantasy402.test");
    assert.equal(apiRequest?.requestedWith, "XMLHttpRequest");
    assert.equal(apiRequest?.userAgent, "Observed Chrome");
    assert.equal(apiRequest?.secFetchSite, "same-origin");
    assert.equal(apiRequest?.secChPlatform, '"macOS"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestion keeps configured session cookie when appending Cloudflare cookies", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/cloud/api/Manager/getAgentPerformance")) {
      seen.push(new Headers(init?.headers).get("Cookie") ?? "");
      return Response.json({ performance: [] });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        FANTASY402_SESSION_COOKIE: "app_session=session-from-secret",
        FANTASY402_CF_CLEARANCE: "clearance-token",
        FANTASY402_CF_BM: "bm-token",
        FANTASY402_AUTHORIZATION: "browser-token",
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 202);
    assert.equal(seen[0], "app_session=session-from-secret; cf_clearance=clearance-token; __cf_bm=bm-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestion uses browser bearer plus Cloudflare cookies when app session cookie is absent", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{ url: string; authorization: string | null; cookie: string | null }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      authorization: headers.get("Authorization"),
      cookie: headers.get("Cookie"),
    });
    if (String(input).endsWith("/cloud/api/System/authenticateCustomer")) {
      return Response.json({ status: "unexpected" }, { status: 500 });
    }
    if (String(input).endsWith("/cloud/api/Manager/getAgentPerformance")) {
      return Response.json({ performance: [] });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        FANTASY402_CF_CLEARANCE: "clearance-token",
        FANTASY402_CF_BM: "bm-token",
        FANTASY402_AUTHORIZATION: "browser-token",
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 202);
    assert.equal(seen.some((request) => request.url.endsWith("/cloud/api/Auth/login")), false);
    assert.equal(seen.some((request) => request.url.endsWith("/cloud/api/System/authenticateCustomer")), false);
    const apiRequest = seen.find((request) => request.url.endsWith("/cloud/api/Manager/getAgentPerformance"));
    assert.equal(apiRequest?.authorization, "Bearer browser-token");
    assert.equal(apiRequest?.cookie, "cf_clearance=clearance-token; __cf_bm=bm-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failure archive records upstream cookie shape without cookie values", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/cloud/api/Manager/getAgentPerformance")) {
      return new Response("error code: 1106", {
        status: 403,
        statusText: "Forbidden",
        headers: { "Content-Type": "text/plain; charset=UTF-8", Server: "cloudflare" },
      });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  const bucket = new MemoryR2Bucket();
  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(bucket, new MemoryD1Database(), {
        FANTASY402_SESSION_COOKIE: "app_session=session-from-secret",
        FANTASY402_CF_CLEARANCE: "clearance-token",
        FANTASY402_CF_BM: "bm-token",
        FANTASY402_AUTHORIZATION: "browser-token",
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 500);
    const listed = await bucket.list({ prefix: "fantasy402/getAgentPerformance/failures", limit: 1 });
    assert.equal(listed.objects.length, 1);
    const failureObject = listed.objects[0];
    assert.ok(failureObject);
    const archived = JSON.parse(await failureObject.text());
    assert.equal(archived.upstream.status, 403);
    assert.equal(archived.upstream.request.hasCookie, true);
    assert.equal(archived.upstream.request.hasSessionCookie, true);
    assert.equal(archived.upstream.request.hasCfClearance, true);
    assert.equal(archived.upstream.request.hasCfBm, true);
    assert.deepEqual(archived.upstream.request.cookieNames, ["app_session", "cf_clearance", "__cf_bm"]);
    assert.doesNotMatch(JSON.stringify(archived), /session-from-secret|clearance-token|bm-token|browser-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refresh-auth stores browser auth overlay in KV without echoing secrets", async () => {
  const authKv = new MemoryKVNamespace();
  const response = await worker.fetch(
    new Request("https://worker.test/refresh-auth", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization: "Bearer refreshed-token",
        sessionCookie: "app_session=refreshed-session",
        cfClearance: "clearance-token",
        cfBm: "__cf_bm=bm-token",
        browserHeaders: { "user-agent": "Refreshed Chrome" },
        expiresInSeconds: 600,
      }),
    }),
    env(new MemoryR2Bucket(), new MemoryD1Database(), { AUTH_CACHE: authKv }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; accepted: string[] };
  assert.equal(body.status, "ok");
  assert.deepEqual(body.accepted.sort(), ["authorization", "browserHeadersJson", "cfBm", "cfClearance", "sessionCookie"].sort());
  assert.doesNotMatch(JSON.stringify(body), /refreshed-token|refreshed-session|clearance-token|bm-token/);
  const stored = await authKv.get("fantasy402:auth-overlay") as Record<string, unknown>;
  assert.equal(stored.authorization, "Bearer refreshed-token");
});

test("refresh-auth rejects Cloudflare-only session cookies before poisoning AUTH_CACHE", async () => {
  const authKv = new MemoryKVNamespace();
  const response = await worker.fetch(
    new Request("https://worker.test/refresh-auth", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization: "Bearer refreshed-token",
        sessionCookie: "cf_clearance=clearance-token; __cf_bm=bm-token",
        cfClearance: "clearance-token",
        cfBm: "bm-token",
      }),
    }),
    env(new MemoryR2Bucket(), new MemoryD1Database(), { AUTH_CACHE: authKv }),
  );
  assert.equal(response.status, 400);
  const body = await response.json() as { status: string; message: string };
  assert.equal(body.status, "failed");
  assert.match(body.message, /non-Cloudflare application session cookie/);
  assert.equal(await authKv.get("fantasy402:auth-overlay"), null);
});

test("refresh-auth rejects missing session cookies before poisoning AUTH_CACHE", async () => {
  const authKv = new MemoryKVNamespace();
  const response = await worker.fetch(
    new Request("https://worker.test/refresh-auth", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization: "Bearer refreshed-token",
        cfClearance: "clearance-token",
        cfBm: "bm-token",
      }),
    }),
    env(new MemoryR2Bucket(), new MemoryD1Database(), { AUTH_CACHE: authKv }),
  );
  assert.equal(response.status, 400);
  const body = await response.json() as { status: string; message: string };
  assert.equal(body.status, "failed");
  assert.match(body.message, /sessionCookie is required/);
  assert.equal(await authKv.get("fantasy402:auth-overlay"), null);
});

test("refresh-auth extracts auth fields from full Cookie header aliases", async () => {
  const authKv = new MemoryKVNamespace();
  const response = await worker.fetch(
    new Request("https://worker.test/refresh-auth", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization: "Bearer refreshed-token",
        cookieHeader: "ASP.NET_SessionId=session-id; cf_clearance=clearance-token; __cf_bm=bm-token",
      }),
    }),
    env(new MemoryR2Bucket(), new MemoryD1Database(), { AUTH_CACHE: authKv }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; accepted: string[] };
  assert.equal(body.status, "ok");
  assert.deepEqual(body.accepted.sort(), ["authorization", "cfBm", "cfClearance", "sessionCookie"].sort());
  assert.doesNotMatch(JSON.stringify(body), /session-id|clearance-token|bm-token|refreshed-token/);
  const stored = await authKv.get("fantasy402:auth-overlay") as Record<string, unknown>;
  assert.equal(stored.sessionCookie, "ASP.NET_SessionId=session-id");
  assert.equal(stored.cfClearance, "cf_clearance=clearance-token");
  assert.equal(stored.cfBm, "__cf_bm=bm-token");
});

test("authenticateCustomer fallback caches bearer token and app session in AUTH_CACHE", async () => {
  const originalFetch = globalThis.fetch;
  const authKv = new MemoryKVNamespace();
  const seen: Array<{ url: string; body: string; authorization: string | null; cookie: string | null }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : "";
    seen.push({
      url: String(input),
      body,
      authorization: headers.get("Authorization"),
      cookie: headers.get("Cookie"),
    });
    if (String(input).endsWith("/cloud/api/System/authenticateCustomer")) {
      return Response.json(
        { accountInfo: { tokenauth: "login-token" } },
        { headers: { "Set-Cookie": "app_session=login-session; Path=/; HttpOnly" } },
      );
    }
    if (String(input).endsWith("/cloud/api/Manager/getAgentPerformance")) {
      return Response.json({ performance: [] });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        AUTH_CACHE: authKv,
        FANTASY402_USERNAME: "user1",
        FANTASY402_PASSWORD: "paSs1",
        FANTASY402_CF_CLEARANCE: "clearance-token",
        FANTASY402_CF_BM: "bm-token",
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 202);
    const loginRequest = seen.find((request) => request.url.endsWith("/cloud/api/System/authenticateCustomer"));
    assert.ok(loginRequest);
    const loginForm = new URLSearchParams(loginRequest.body);
    assert.equal(loginForm.get("customerID"), "USER1");
    assert.equal(loginForm.get("password"), "paSs1");
    assert.equal(loginForm.get("operation"), "authenticateCustomer");
    assert.equal(loginForm.get("RRO"), "1");
    const apiRequest = seen.find((request) => request.url.endsWith("/cloud/api/Manager/getAgentPerformance"));
    assert.equal(apiRequest?.authorization, "Bearer login-token");
    assert.equal(apiRequest?.cookie, "app_session=login-session; cf_clearance=clearance-token; __cf_bm=bm-token");
    const stored = await authKv.get("fantasy402:auth-overlay") as Record<string, unknown>;
    assert.equal(stored.authorization, "Bearer login-token");
    assert.equal(stored.sessionCookie, "app_session=login-session");
    assert.equal(stored.cfClearance, "cf_clearance=clearance-token");
    assert.equal(stored.cfBm, "__cf_bm=bm-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local ingestion upload stores browser-fetched endpoint responses", async () => {
  const bucket = new MemoryR2Bucket();
  const db = new MemoryD1Database();
  const response = await worker.fetch(
    new Request("https://worker.test/ingest/local", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        results: [
          {
            endpointKey: "getAgentPerformance",
            httpStatus: 200,
            capturedAt: "2026-05-17T12:00:00.000Z",
            data: { performance: [{ agentID: "agent", totalWagers: 3, totalVolume: 42, winRate: 0.5 }] },
          },
        ],
      }),
    }),
    env(bucket, db),
  );

  assert.equal(response.status, 202);
  const body = await response.json() as any;
  assert.equal(body.status, "success");
  assert.equal(body.endpointsSucceeded, 1);
  assert.equal(body.stored[0].endpointKey, "getAgentPerformance");
  assert.match(body.stored[0].r2Key, /^fantasy402\/getAgentPerformance\/2026-05-17\//);
  assert.equal(db.runs.some((bindings) => bindings[4] === "2026-05-17T12:00:00.000Z"), true);
  assert.equal(db.runs.length >= 4, true);
});

test("ingestion renews near-expired cached token before upstream calls", async () => {
  const originalFetch = globalThis.fetch;
  const authKv = new MemoryKVNamespace();
  await authKv.put(
    "fantasy402:auth-overlay",
    JSON.stringify({
      authorization: "Bearer stale-token",
      sessionCookie: "app_session=stale-session",
      cfClearance: "cf_clearance=kv-clearance",
      cfBm: "__cf_bm=kv-bm",
      browserHeadersJson: JSON.stringify({ "user-agent": "KV Chrome" }),
      updatedAt: "2026-05-17T00:00:00.000Z",
      expiresAt: Date.now() + 30_000,
    }),
  );
  const seen: Array<{ url: string; authorization: string | null; cookie: string | null }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      authorization: headers.get("Authorization"),
      cookie: headers.get("Cookie"),
    });
    if (String(input).endsWith("/cloud/api/System/renewToken")) {
      return Response.json(
        { tokenauth: "renewed-token" },
        { headers: { "Set-Cookie": "app_session=renewed-session; Path=/; HttpOnly" } },
      );
    }
    if (String(input).endsWith("/cloud/api/Manager/getAgentPerformance")) {
      return Response.json({ performance: [] });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        AUTH_CACHE: authKv,
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 202);
    const renewRequest = seen.find((request) => request.url.endsWith("/cloud/api/System/renewToken"));
    assert.equal(renewRequest?.authorization, "Bearer stale-token");
    assert.equal(renewRequest?.cookie, "app_session=stale-session; cf_clearance=kv-clearance; __cf_bm=kv-bm");
    const apiRequest = seen.find((request) => request.url.endsWith("/cloud/api/Manager/getAgentPerformance"));
    assert.equal(apiRequest?.authorization, "Bearer renewed-token");
    assert.equal(apiRequest?.cookie, "app_session=renewed-session; cf_clearance=kv-clearance; __cf_bm=kv-bm");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestion keeps near-expired cached session when renewToken fails", async () => {
  const originalFetch = globalThis.fetch;
  const authKv = new MemoryKVNamespace();
  await authKv.put(
    "fantasy402:auth-overlay",
    JSON.stringify({
      authorization: "Bearer stale-token",
      sessionCookie: "app_session=stale-session",
      cfClearance: "cf_clearance=kv-clearance",
      cfBm: "__cf_bm=kv-bm",
      updatedAt: "2026-05-17T00:00:00.000Z",
      expiresAt: Date.now() + 30_000,
    }),
  );
  const seen: Array<{ url: string; authorization: string | null; cookie: string | null }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      authorization: headers.get("Authorization"),
      cookie: headers.get("Cookie"),
    });
    if (String(input).endsWith("/cloud/api/System/renewToken")) {
      return Response.json({ status: "Failed" }, { status: 403 });
    }
    if (String(input).endsWith("/cloud/api/Manager/getAgentPerformance")) {
      return Response.json({ performance: [] });
    }
    return Response.json({ status: "failed" }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        AUTH_CACHE: authKv,
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 202);
    const apiRequest = seen.find((request) => request.url.endsWith("/cloud/api/Manager/getAgentPerformance"));
    assert.equal(apiRequest?.authorization, "Bearer stale-token");
    assert.equal(apiRequest?.cookie, "app_session=stale-session; cf_clearance=kv-clearance; __cf_bm=kv-bm");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ingestion prefers refresh-auth KV overlay over configured secrets", async () => {
  const originalFetch = globalThis.fetch;
  const authKv = new MemoryKVNamespace();
  await authKv.put(
    "fantasy402:auth-overlay",
    JSON.stringify({
      authorization: "Bearer kv-token",
      sessionCookie: "app_session=kv-session",
      cfClearance: "cf_clearance=kv-clearance",
      cfBm: "__cf_bm=kv-bm",
      browserHeadersJson: JSON.stringify({ "user-agent": "KV Chrome" }),
      updatedAt: "2026-05-17T00:00:00.000Z",
      expiresAt: Date.now() + 600_000,
    }),
  );
  const seen: Array<{ authorization: string | null; cookie: string | null; userAgent: string | null }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      authorization: headers.get("Authorization"),
      cookie: headers.get("Cookie"),
      userAgent: headers.get("User-Agent"),
    });
    return Response.json({ performance: [] });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
      env(new MemoryR2Bucket(), new MemoryD1Database(), {
        AUTH_CACHE: authKv,
        FANTASY402_SESSION_COOKIE: "app_session=secret-session",
        FANTASY402_AUTHORIZATION: "secret-token",
        FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance",
      }),
    );
    assert.equal(response.status, 202);
    assert.equal(seen[0]?.authorization, "Bearer kv-token");
    assert.equal(seen[0]?.cookie, "app_session=kv-session; cf_clearance=kv-clearance; __cf_bm=kv-bm");
    assert.equal(seen[0]?.userAgent, "KV Chrome");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scan verdict list requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/scans"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "failed", message: "Unauthorized" });
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
  const response = await worker.fetch(authorized("/scans?limit=5"), env(new MemoryR2Bucket(), new MemoryD1Database(rows)));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    filters: { malicious: null, urlContains: null, since: null, until: null },
    results: rows,
  });
});

test("scan verdict list returns normalized filters", async () => {
  const response = await worker.fetch(
    authorized("/scans?limit=5&malicious=false&urlContains=fantasy402.com&since=2026-05-17&until=2026-05-17"),
    env(new MemoryR2Bucket(), new MemoryD1Database([])),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.deepEqual(body.filters, {
    malicious: 0,
    urlContains: "fantasy402.com",
    since: "2026-05-17",
    until: "2026-05-17",
  });
});

test("scan summary returns posture counts", async () => {
  const rows = [
    {
      scan_id: "scan-a",
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: "fantasy402/scans/2026-05-17/scan-a.json",
      screenshot_r2_key: null,
      har_r2_key: null,
    },
    {
      scan_id: "scan-b",
      timestamp: "2026-05-16T00:00:00.000Z",
      url: "https://example.test",
      malicious: 1,
      tls_valid_days: 3,
      agent_readiness_level: 0,
      scan_r2_key: "fantasy402/scans/2026-05-16/scan-b.json",
      screenshot_r2_key: null,
      har_r2_key: null,
    },
  ];
  const response = await worker.fetch(authorized("/scans/summary?days=30&tlsWarningDays=7"), env(new MemoryR2Bucket(), new MemoryD1Database(rows)));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.window.days, 30);
  assert.equal(body.window.tlsWarningDays, 7);
  assert.equal(body.totals.scans, 2);
  assert.equal(body.totals.malicious, 1);
  assert.equal(body.totals.clean, 1);
  assert.equal(body.totals.tlsExpiring, 1);
  assert.equal(body.totals.minTlsValidDays, 3);
  assert.equal(body.latest.scan_id, "scan-a");
  assert.equal(body.status, "alert");
});

test("scan summary requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/scans/summary"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
});

test("scan detail requires bearer auth", async () => {
  const response = await worker.fetch(new Request("https://worker.test/scans/detail?scanId=00000000-0000-4000-8000-000000000000"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 401);
});

test("scan detail returns D1 row and optional raw archive preview", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const key = `fantasy402/scans/2026-05-17/${scanId}.json`;
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: key,
      screenshot_r2_key: `fantasy402/screenshots/${scanId}_desktop.png`,
      har_r2_key: `fantasy402/hars/${scanId}.har`,
    },
  ];
  const bucket = new MemoryR2Bucket();
  bucket.seed(key, JSON.stringify({ task: { uuid: scanId }, verdicts: { overall: { malicious: false } } }), {
    customMetadata: {
      source: "cloudflare-url-scanner",
      archiveType: "scan-result",
      scanId,
    },
  });

  const response = await worker.fetch(authorized(`/scans/detail?scanId=${scanId}&includeRaw=true`), env(bucket, new MemoryD1Database(rows)));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.verdict.scan_id, scanId);
  assert.equal(body.archive.key, key);
  assert.equal(body.archive.found, true);
  assert.equal(body.archive.raw.task.uuid, scanId);
});

test("scan detail rejects invalid scan ids", async () => {
  const response = await worker.fetch(authorized("/scans/detail?scanId=not-a-scan"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "Invalid scanId" });
});

test("scan screenshot requires bearer auth", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/scans/screenshot?scanId=00000000-0000-4000-8000-000000000000"),
    env(new MemoryR2Bucket()),
  );
  assert.equal(response.status, 401);
});

test("scan screenshot returns protected PNG evidence by scan id", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const screenshotKey = `fantasy402/screenshots/${scanId}_desktop.png`;
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: `fantasy402/scans/2026-05-17/${scanId}.json`,
      screenshot_r2_key: screenshotKey,
      har_r2_key: `fantasy402/hars/${scanId}.har`,
    },
  ];
  const bucket = new MemoryR2Bucket();
  bucket.seed(screenshotKey, "png-data", {
    etag: "png-etag",
    httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=60" },
  });

  const response = await worker.fetch(authorized(`/scans/screenshot?scanId=${scanId}`), env(bucket, new MemoryD1Database(rows)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("X-Archive-Key"), screenshotKey);
  assert.equal(response.headers.get("ETag"), "png-etag");
  assert.equal(await response.text(), "png-data");
});

test("scan screenshot rejects non-screenshot archive keys", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: `fantasy402/scans/2026-05-17/${scanId}.json`,
      screenshot_r2_key: `fantasy402/hars/${scanId}.har`,
      har_r2_key: `fantasy402/hars/${scanId}.har`,
    },
  ];

  const response = await worker.fetch(authorized(`/scans/screenshot?scanId=${scanId}`), env(new MemoryR2Bucket(), new MemoryD1Database(rows)));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "Invalid screenshot archive key" });
});

test("scan HAR requires bearer auth", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/scans/har?scanId=00000000-0000-4000-8000-000000000000"),
    env(new MemoryR2Bucket()),
  );
  assert.equal(response.status, 401);
});

test("scan HAR returns protected network evidence by scan id", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const harKey = `fantasy402/hars/${scanId}.har`;
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: `fantasy402/scans/2026-05-17/${scanId}.json`,
      screenshot_r2_key: `fantasy402/screenshots/${scanId}_desktop.png`,
      har_r2_key: harKey,
    },
  ];
  const bucket = new MemoryR2Bucket();
  bucket.seed(harKey, "{\"log\":{\"entries\":[]}}", {
    etag: "har-etag",
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=60" },
  });

  const response = await worker.fetch(authorized(`/scans/har?scanId=${scanId}`), env(bucket, new MemoryD1Database(rows)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("X-Archive-Key"), harKey);
  assert.equal(response.headers.get("ETag"), "har-etag");
  assert.deepEqual(await response.json(), { log: { entries: [] } });
});

test("scan HAR rejects non-HAR archive keys", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: `fantasy402/scans/2026-05-17/${scanId}.json`,
      screenshot_r2_key: `fantasy402/screenshots/${scanId}_desktop.png`,
      har_r2_key: `fantasy402/scans/2026-05-17/${scanId}.json`,
    },
  ];

  const response = await worker.fetch(authorized(`/scans/har?scanId=${scanId}`), env(new MemoryR2Bucket(), new MemoryD1Database(rows)));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "Invalid HAR archive key" });
});

test("scan network summary returns derived HAR counts", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const harKey = `fantasy402/hars/${scanId}.har`;
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: `fantasy402/scans/2026-05-17/${scanId}.json`,
      screenshot_r2_key: `fantasy402/screenshots/${scanId}_desktop.png`,
      har_r2_key: harKey,
    },
  ];
  const har = {
    log: {
      entries: [
        {
          time: 120,
          request: { method: "GET", url: "https://fantasy402.com/" },
          response: { status: 200, statusText: "OK", bodySize: 100, content: { mimeType: "text/html", size: 100 } },
        },
        {
          time: 40,
          request: { method: "POST", url: "https://api.example.test/fail" },
          response: { status: 500, statusText: "Server Error", bodySize: 200, content: { mimeType: "application/json", size: 200 } },
        },
      ],
    },
  };
  const bucket = new MemoryR2Bucket();
  bucket.seed(harKey, JSON.stringify(har));

  const response = await worker.fetch(authorized(`/scans/network-summary?scanId=${scanId}`), env(bucket, new MemoryD1Database(rows)));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.scanId, scanId);
  assert.equal(body.harR2Key, harKey);
  assert.equal(body.summary.totalRequests, 2);
  assert.deepEqual(body.summary.byMethod, { GET: 1, POST: 1 });
  assert.deepEqual(body.summary.byStatus, { "200": 1, "500": 1 });
  assert.equal(body.summary.byHost["fantasy402.com"], 1);
  assert.equal(body.summary.failedRequests.length, 1);
  assert.equal(body.summary.slowestRequests[0].timeMs, 120);
  assert.equal(body.summary.largestResponses[0].bodySize, 200);
});

test("scan network summary rejects malformed HAR JSON", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const harKey = `fantasy402/hars/${scanId}.har`;
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: `fantasy402/scans/2026-05-17/${scanId}.json`,
      screenshot_r2_key: `fantasy402/screenshots/${scanId}_desktop.png`,
      har_r2_key: harKey,
    },
  ];
  const bucket = new MemoryR2Bucket();
  bucket.seed(harKey, "not json");

  const response = await worker.fetch(authorized(`/scans/network-summary?scanId=${scanId}`), env(bucket, new MemoryD1Database(rows)));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { status: "failed", message: "Invalid HAR JSON" });
});

test("scan network summary prefers persisted D1 summary", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const summaryRows = [
    {
      scan_id: scanId,
      total_requests: 3,
      status_counts_json: "{\"200\":2,\"404\":1}",
      method_counts_json: "{\"GET\":3}",
      host_counts_json: "{\"fantasy402.com\":3}",
      mime_counts_json: "{\"text/html\":1,\"application/javascript\":2}",
      failed_requests_json: "[{\"method\":\"GET\",\"url\":\"https://fantasy402.com/missing\",\"host\":\"fantasy402.com\",\"status\":404,\"statusText\":\"Not Found\",\"timeMs\":12,\"bodySize\":20}]",
      slowest_requests_json: "[]",
      largest_responses_json: "[]",
      har_r2_key: `fantasy402/hars/${scanId}.har`,
    },
  ];

  const response = await worker.fetch(
    authorized(`/scans/network-summary?scanId=${scanId}`),
    env(new MemoryR2Bucket(), new MemoryD1Database([], [], summaryRows)),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.source, "d1");
  assert.equal(body.summary.totalRequests, 3);
  assert.deepEqual(body.summary.byStatus, { "200": 2, "404": 1 });
  assert.equal(body.summary.failedRequests.length, 1);
});

test("scan network diff compares persisted summaries", async () => {
  const baseScanId = "00000000-0000-4000-8000-000000000000";
  const compareScanId = "00000000-0000-4000-8000-000000000001";
  const summaryRows = [
    {
      scan_id: baseScanId,
      total_requests: 2,
      status_counts_json: "{\"200\":2}",
      method_counts_json: "{\"GET\":2}",
      host_counts_json: "{\"fantasy402.com\":2}",
      mime_counts_json: "{\"text/html\":2}",
      failed_requests_json: "[]",
      slowest_requests_json: "[]",
      largest_responses_json: "[]",
      har_r2_key: `fantasy402/hars/${baseScanId}.har`,
    },
    {
      scan_id: compareScanId,
      total_requests: 3,
      status_counts_json: "{\"200\":2,\"500\":1}",
      method_counts_json: "{\"GET\":2,\"POST\":1}",
      host_counts_json: "{\"fantasy402.com\":2,\"api.example.test\":1}",
      mime_counts_json: "{\"text/html\":2,\"application/json\":1}",
      failed_requests_json: "[{\"method\":\"POST\",\"url\":\"https://api.example.test/fail\",\"host\":\"api.example.test\",\"status\":500,\"statusText\":\"Server Error\",\"timeMs\":40,\"bodySize\":200}]",
      slowest_requests_json: "[]",
      largest_responses_json: "[]",
      har_r2_key: `fantasy402/hars/${compareScanId}.har`,
    },
  ];

  const response = await worker.fetch(
    authorized(`/scans/network-diff?baseScanId=${baseScanId}&compareScanId=${compareScanId}`),
    env(new MemoryR2Bucket(), new MemoryD1Database([], [], summaryRows)),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.diff.totalRequestsDelta, 1);
  assert.deepEqual(body.diff.hosts["api.example.test"], { base: 0, compare: 1, delta: 1 });
  assert.deepEqual(body.diff.statuses["500"], { base: 0, compare: 1, delta: 1 });
  assert.equal(body.diff.failedRequestsDelta, 1);
});

test("scan evidence export returns verdict and artifact manifest", async () => {
  const scanId = "00000000-0000-4000-8000-000000000000";
  const key = `fantasy402/scans/2026-05-17/${scanId}.json`;
  const screenshotKey = `fantasy402/screenshots/${scanId}_desktop.png`;
  const harKey = `fantasy402/hars/${scanId}.har`;
  const rows = [
    {
      scan_id: scanId,
      timestamp: "2026-05-17T00:00:00.000Z",
      url: "https://fantasy402.com",
      malicious: 0,
      tls_valid_days: 42,
      agent_readiness_level: 1,
      scan_r2_key: key,
      screenshot_r2_key: screenshotKey,
      har_r2_key: harKey,
    },
  ];
  const bucket = new MemoryR2Bucket();
  bucket.seed(key, "{\"ok\":true}", { customMetadata: { source: "cloudflare-url-scanner", archiveType: "scan-result" } });
  bucket.seed(screenshotKey, "png", { httpMetadata: { contentType: "image/png", cacheControl: "no-store, max-age=0" } });
  bucket.seed(harKey, "{\"log\":{}}", { customMetadata: { source: "cloudflare-url-scanner", archiveType: "scan-har" } });

  const response = await worker.fetch(authorized(`/scans/export?scanId=${scanId}`), env(bucket, new MemoryD1Database(rows)));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.scanId, scanId);
  assert.equal(body.verdict.scan_id, scanId);
  assert.deepEqual(body.artifacts.map((artifact: any) => artifact.type), ["scan", "screenshot", "har"]);
  assert.equal(body.artifacts.every((artifact: any) => artifact.found), true);
  assert.equal(JSON.stringify(body).includes("\"raw\""), false);
});

test("scan evidence export rejects invalid scan ids", async () => {
  const response = await worker.fetch(authorized("/scans/export?scanId=not-a-scan"), env(new MemoryR2Bucket()));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "Invalid scanId" });
});

test("manual scan trigger requires bearer auth", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/scans/trigger", { method: "POST" }),
    env(new MemoryR2Bucket()),
  );
  assert.equal(response.status, 401);
});

test("trigger-scan alias requires bearer auth", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/trigger-scan", { method: "POST" }),
    env(new MemoryR2Bucket()),
  );
  assert.equal(response.status, 401);
});

test("manual scan trigger rejects invalid URLs before external calls", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/scans/trigger", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "not-a-url" }),
    }),
    env(new MemoryR2Bucket()),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "failed", message: "Invalid URL" });
});

test("manual scan trigger rejects hosts outside the configured scan policy", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/scans/trigger", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://unexpected.example" }),
    }),
    env(new MemoryR2Bucket()),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { status: "failed", message: "Scan target host is not allowed" });
});

test("manual scan trigger returns JSON when scanner token is missing", async () => {
  const response = await worker.fetch(
    new Request("https://worker.test/trigger-scan", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://fantasy402.com" }),
    }),
    {
      ...env(new MemoryR2Bucket()),
      CLOUDFLARE_API_TOKEN: undefined,
    },
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    status: "failed",
    subsystem: "cloudflare-url-scanner",
    message: "CLOUDFLARE_API_TOKEN is required",
  });
});

test("manual scan trigger alerts on unexpected hosts and failed requests", async () => {
  const originalFetch = globalThis.fetch;
  const bucket = new MemoryR2Bucket();
  const db = new MemoryD1Database();
  const scanId = "00000000-0000-4000-8000-000000000099";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/urlscanner/v2/scan")) {
      return Response.json({ uuid: scanId, url: "https://fantasy402.com", message: "Submission successful" });
    }
    if (url.endsWith(`/urlscanner/v2/result/${scanId}`)) {
      return Response.json({
        task: { uuid: scanId, url: "https://fantasy402.com", time: "2026-05-17T00:00:00.000Z", success: true },
        verdicts: { overall: { malicious: false } },
        page: { tlsValidDays: 366 },
      });
    }
    if (url.includes(`/urlscanner/v2/screenshots/${scanId}.png`)) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    }
    if (url.endsWith(`/urlscanner/v2/har/${scanId}`)) {
      return Response.json({
        log: {
          entries: [
            {
              time: 20,
              request: { method: "GET", url: "https://fantasy402.com/" },
              response: { status: 200, statusText: "OK", bodySize: 100, content: { mimeType: "text/html", size: 100 } },
            },
            {
              time: 40,
              request: { method: "GET", url: "https://unexpected.example/script.js" },
              response: { status: 500, statusText: "Server Error", bodySize: 10, content: { mimeType: "application/javascript", size: 10 } },
            },
          ],
        },
      });
    }
    return Response.json({ success: false }, { status: 404 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.test/trigger-scan", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://fantasy402.com" }),
      }),
      env(bucket, db),
    );
    assert.equal(response.status, 202);
    const alertTypes = db.runs
      .filter((bindings) =>
        bindings[3] === "url-scan-unexpected-hosts" ||
        bindings[3] === "url-scan-new-third-party" ||
        bindings[3] === "url-scan-failed-requests"
      )
      .map((bindings) => bindings[3]);
    assert.deepEqual(alertTypes, [
      "url-scan-unexpected-hosts",
      "url-scan-new-third-party",
      "url-scan-failed-requests",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
