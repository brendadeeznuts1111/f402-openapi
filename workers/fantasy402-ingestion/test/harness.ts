import type { Env } from "../src/index";

interface StoredObject {
  key: string;
  body: string | ArrayBuffer;
  etag: string;
  size: number;
  uploaded: Date;
  storageClass: string;
  httpMetadata: Record<string, string>;
  customMetadata: Record<string, string>;
}

interface SeedObject extends Partial<Omit<StoredObject, "key" | "body">> {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface D1StatementRecord {
  sql: string;
  bindings: unknown[];
  mode: "run" | "all";
}

export class MemoryR2Object {
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

export class MemoryR2Bucket {
  readonly writes: { key: string; value: string | ArrayBuffer; options: R2PutOptions }[] = [];
  private readonly objects = new Map<string, StoredObject>();

  seed(key: string, body: string | ArrayBuffer, metadata: SeedObject = {}): void {
    const size = metadata.size ?? (typeof body === "string" ? body.length : body.byteLength);
    this.objects.set(key, {
      key,
      body,
      etag: metadata.etag ?? "test-etag",
      size,
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

  async put(key: string, value: string | ArrayBuffer, options: R2PutOptions = {}): Promise<R2Object> {
    this.writes.push({ key, value, options });
    const stored: StoredObject = {
      key,
      body: value,
      etag: "etag",
      size: typeof value === "string" ? value.length : value.byteLength,
      uploaded: new Date("2026-05-17T00:00:00.000Z"),
      storageClass: String(options.storageClass ?? "InfrequentAccess"),
      httpMetadata: (options.httpMetadata ?? {}) as Record<string, string>,
      customMetadata: (options.customMetadata ?? {}) as Record<string, string>,
    };
    this.objects.set(key, stored);
    return new MemoryR2Object(stored) as unknown as R2Object;
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}): Promise<R2Objects> {
    const prefix = options.prefix ?? "";
    const limit = options.limit ?? 1000;
    const start = options.cursor ? Number(options.cursor) : 0;
    const all = [...this.objects.values()]
      .filter((object) => object.key.startsWith(prefix))
      .sort((a, b) => a.key.localeCompare(b.key));
    const page = all.slice(start, start + limit);
    const next = start + page.length;
    return {
      objects: page.map((object) => new MemoryR2Object(object) as unknown as R2Object),
      truncated: next < all.length,
      cursor: next < all.length ? String(next) : "",
      delimitedPrefixes: [],
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const object = this.objects.get(key);
    return object ? (new MemoryR2Object(object) as unknown as R2ObjectBody) : null;
  }
}

export class MemoryD1Database {
  readonly statements: D1StatementRecord[] = [];

  constructor(private readonly rowsBySql: { match: RegExp; rows: Record<string, unknown>[] }[] = []) {}

  prepare(sql: string): D1PreparedStatement {
    const database = this;
    return {
      bind(...bindings: unknown[]) {
        return {
          async run() {
            database.statements.push({ sql, bindings, mode: "run" });
            return { success: true, meta: {} };
          },
          async all() {
            database.statements.push({ sql, bindings, mode: "all" });
            const matched = database.rowsBySql.find((entry) => entry.match.test(sql));
            return { success: true, meta: {}, results: matched?.rows ?? [] };
          },
        } as unknown as D1PreparedStatement;
      },
    } as D1PreparedStatement;
  }

  get lastBindings(): unknown[] {
    return this.statements.at(-1)?.bindings ?? [];
  }
}

export class MemoryKVNamespace {
  readonly writes: { key: string; value: string; options?: KVNamespacePutOptions }[] = [];
  private readonly values = new Map<string, string>();

  seed(key: string, value: unknown): void {
    this.values.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  async get(key: string, type?: "text" | "json"): Promise<unknown> {
    const value = this.values.get(key) ?? null;
    if (type === "json" && typeof value === "string") return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void> {
    this.writes.push(options === undefined ? { key, value } : { key, value, options });
    this.values.set(key, value);
  }
}

export interface HarnessOptions {
  bucket?: MemoryR2Bucket;
  db?: MemoryD1Database;
  kv?: MemoryKVNamespace;
  overrides?: Partial<Env>;
}

export interface ComponentHarness {
  env: Env;
  bucket: MemoryR2Bucket;
  db: MemoryD1Database;
  kv: MemoryKVNamespace;
  authorized(path: string, init?: RequestInit): Request;
  request(path: string, init?: RequestInit): Request;
  systemView(): {
    env: Record<string, string | undefined>;
    kvWrites: MemoryKVNamespace["writes"];
    r2Writes: MemoryR2Bucket["writes"];
    d1Statements: D1StatementRecord[];
  };
}

export function createComponentHarness(options: HarnessOptions = {}): ComponentHarness {
  const bucket = options.bucket ?? new MemoryR2Bucket();
  const db = options.db ?? new MemoryD1Database();
  const kv = options.kv ?? new MemoryKVNamespace();
  const env = {
    SESSION_KV: kv,
    ANALYTICS_DB: db,
    RAW_ARCHIVE: bucket,
    ENVIRONMENT: "test",
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_API_TOKEN: "scanner-token",
    FANTASY402_BASE_URL: "https://fantasy402.test",
    FANTASY402_INGESTION_ENDPOINTS: "getAgentPerformance,getAgentBilling,getEnterTransactions",
    FANTASY402_USERNAME: "worker-user",
    FANTASY402_PASSWORD: "worker-password",
    FANTASY402_AGENT_ID: "agent-1",
    INGESTION_TRIGGER_TOKEN: "test-token",
    ...options.overrides,
  } as unknown as Env;

  return {
    env,
    bucket,
    db,
    kv,
    request: (path, init) => new Request(`https://worker.test${path}`, init),
    authorized: (path, init = {}) =>
      new Request(`https://worker.test${path}`, {
        ...init,
        headers: {
          Authorization: "Bearer test-token",
          ...init.headers,
        },
      }),
    systemView: () => ({
      env: {
        ENVIRONMENT: env.ENVIRONMENT,
        FANTASY402_BASE_URL: env.FANTASY402_BASE_URL,
        FANTASY402_INGESTION_ENDPOINTS: env.FANTASY402_INGESTION_ENDPOINTS,
        FANTASY402_AGENT_ID: env.FANTASY402_AGENT_ID,
        FANTASY402_CUSTOMER_ID: env.FANTASY402_CUSTOMER_ID,
      },
      kvWrites: kv.writes,
      r2Writes: bucket.writes,
      d1Statements: db.statements,
    }),
  };
}

export async function withFetchMock<T>(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
  callback: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
