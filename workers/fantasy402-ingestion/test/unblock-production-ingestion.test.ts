import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Local operator scripts are JavaScript modules without declaration files.
import { parseBrowserCurl, validateBrowserAuthPayload } from "../scripts/browser-auth-utils.mjs";
// @ts-expect-error Local operator scripts are JavaScript modules without declaration files.
import { runUnblockProductionIngestion } from "../scripts/unblock-production-ingestion.mjs";

const fullCurl = [
  "curl 'https://fantasy402.com/cloud/api/Manager/getAgentPerformance'",
  "  --header 'authorization: Bearer browser-token-secret'",
  "  --header 'content-type: application/x-www-form-urlencoded; charset=UTF-8'",
  "  --header 'user-agent: Browser/1.0'",
  "  --cookie 'ASP.NET_SessionId=app-session-secret; cf_clearance=clearance-secret; __cf_bm=bm-secret'",
  "  --data-raw 'operation=getAgentPerformance&agentID=agent-1&customerID=cust-1'",
].join(" \\\n");

const bearerCloudflareCurl = [
  "curl 'https://fantasy402.com/cloud/api/Manager/getAccountInfoOwner'",
  "  --header 'authorization: Bearer browser-token-secret'",
  "  --header 'content-type: application/json'",
  "  --header 'user-agent: Browser/1.0'",
  "  --cookie 'cf_clearance=clearance-secret; __cf_bm=bm-secret'",
  "  --data-raw '{\"operation\":\"getAccountInfoOwner\",\"agentOwner\":\"agent-1\"}'",
].join(" \\\n");

test("unblock auth validation accepts bearer plus Cloudflare-cookie captures without app session cookies", () => {
  const auth = parseBrowserCurl(bearerCloudflareCurl);
  assert.doesNotThrow(() => validateBrowserAuthPayload(auth, "test capture"));
  assert.equal(auth.sessionCookie, undefined);
  assert.equal(auth.cfClearance, "clearance-secret");
  assert.equal(auth.cfBm, "bm-secret");
});

test("unblock auth validation rejects explicit Cloudflare-only sessionCookie fields", () => {
  const auth = parseBrowserCurl([
    "curl 'https://fantasy402.com/cloud/api/Manager/getAgentPerformance'",
    "  --header 'authorization: Bearer browser-token-secret'",
    "  --header 'user-agent: Browser/1.0'",
    "  --cookie 'cf_clearance=clearance-secret; __cf_bm=bm-secret'",
  ].join(" \\\n"));
  auth.sessionCookie = "cf_clearance=clearance-secret; __cf_bm=bm-secret";

  assert.throws(
    () => validateBrowserAuthPayload(auth, "test capture"),
    /sessionCookie contains only Cloudflare cookies/,
  );
});

test("unblock auth validation rejects Cloudflare challenge captures", () => {
  const auth = parseBrowserCurl([
    "curl 'https://fantasy402.com/cdn-cgi/challenge-platform/h/b/jsd/oneshot/challenge-id'",
    "  --header 'content-type: text/plain;charset=UTF-8'",
    "  --header 'origin: https://fantasy402.com'",
    "  --header 'user-agent: Browser/1.0'",
    "  --cookie '__cf_bm=bm-secret'",
    "  --data-raw 'opaque-cloudflare-challenge-payload'",
  ].join(" \\\n"));

  assert.throws(
    () => validateBrowserAuthPayload(auth, "test capture"),
    /sourcePath is Cloudflare challenge telemetry/,
  );
});

test("unblock auth validation rejects expired browser bearer JWTs", () => {
  const expiredJwt = testJwt({ sub: "agent-1", exp: Math.floor(Date.now() / 1000) - 60 });
  const auth = parseBrowserCurl([
    "curl 'https://fantasy402.com/cloud/api/Manager/getAccountInfoOwner'",
    `  --header 'authorization: Bearer ${expiredJwt}'`,
    "  --header 'user-agent: Browser/1.0'",
    "  --cookie 'cf_clearance=clearance-secret; __cf_bm=bm-secret'",
  ].join(" \\\n"));

  assert.throws(
    () => validateBrowserAuthPayload(auth, "test capture"),
    /authorization JWT expired at/,
  );
});

test("unblock auth validation accepts full app-session cookie captures", () => {
  const auth = parseBrowserCurl(fullCurl);
  assert.doesNotThrow(() => validateBrowserAuthPayload(auth, "test capture"));
  assert.equal(auth.sessionCookie, "ASP.NET_SessionId=app-session-secret");
  assert.equal(auth.cfClearance, "clearance-secret");
  assert.equal(auth.cfBm, "bm-secret");
});

function testJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

test("unblock command stops before trigger when diagnostics are degraded", async () => {
  const calls: string[] = [];
  const fetch = mockFetch(calls, {
    diagnostics: {
      status: "degraded",
      upstreamAuthShape: {
        ingestionReadiness: {
          status: "blocked",
          blocker: "missing non-Cloudflare application session cookie such as ASP.NET_SessionId",
        },
      },
    },
  });

  await assert.rejects(
    () => runUnblockProductionIngestion({
      curlText: fullCurl,
      inputPath: "capture.curl",
      outputPath: "ignored.json",
      writeAuthFile: false,
      operatorToken: "operator-token-secret",
      fetch,
    }),
    /diagnostics are not ingestion-ready/,
  );
  assert.deepEqual(calls, ["POST /refresh-auth", "GET /diagnostics"]);
});

test("unblock command refreshes auth, triggers ingestion, and returns sanitized run endpoints", async () => {
  const calls: string[] = [];
  const fetch = mockFetch(calls);
  const summary = await runUnblockProductionIngestion({
    curlText: fullCurl,
    inputPath: "capture.curl",
    outputPath: "ignored.json",
    writeAuthFile: false,
    operatorToken: "operator-token-secret",
    fetch,
  });

  assert.deepEqual(calls, ["POST /refresh-auth", "GET /diagnostics", "POST /trigger", "GET /runs/endpoints"]);
  assert.equal(summary.status, "ok");
  assert.equal(summary.trigger.runId, "00000000-0000-4000-8000-000000000001");
  assert.equal(summary.runEndpoints.snapshots[0].trace_id, "trace-success");
  assert.equal(summary.runEndpoints.snapshots[0].r2_key, "fantasy402/getAgentPerformance/2026-05-17/snap.json");

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("browser-token-secret"), false);
  assert.equal(serialized.includes("app-session-secret"), false);
  assert.equal(serialized.includes("clearance-secret"), false);
  assert.equal(serialized.includes("bm-secret"), false);
  assert.equal(serialized.includes("operator-token-secret"), false);
});

function mockFetch(calls: string[], overrides: Record<string, unknown> = {}) {
  return async (url: URL, init: RequestInit = {}) => {
    const route = `${init.method ?? "GET"} ${url.pathname}`;
    calls.push(route);
    if (route === "POST /refresh-auth") {
      return jsonResponse(200, { status: "ok", accepted: ["authorization", "cfClearance", "cfBm"], ttlSeconds: 3600 });
    }
    if (route === "GET /diagnostics") {
      return jsonResponse(200, overrides.diagnostics ?? {
        status: "ready",
        upstreamAuthShape: {
          ingestionReadiness: { status: "ready", blocker: null },
        },
      });
    }
    if (route === "POST /trigger") {
      return jsonResponse(202, {
        runId: "00000000-0000-4000-8000-000000000001",
        status: "success",
        endpointsSucceeded: 1,
        endpointsFailed: 0,
      });
    }
    if (route === "GET /runs/endpoints") {
      return jsonResponse(200, {
        runId: "00000000-0000-4000-8000-000000000001",
        snapshots: [
          {
            id: "snap-1",
            endpoint_key: "getAgentPerformance",
            path: "/cloud/api/Manager/getAgentPerformance",
            captured_at: "2026-05-17T00:00:00.000Z",
            http_status: 200,
            item_count: 1,
            attempts: 1,
            r2_key: "fantasy402/getAgentPerformance/2026-05-17/snap.json",
            trace_id: "trace-success",
            duration_ms: 123,
          },
        ],
        failures: [],
      });
    }
    return jsonResponse(404, { status: "failed", message: "not found" });
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
