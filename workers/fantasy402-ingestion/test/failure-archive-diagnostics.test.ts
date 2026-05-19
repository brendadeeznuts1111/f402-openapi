import assert from "node:assert/strict";
import test from "node:test";

/** Mirrors storeEndpointFailure upstream.request shape (sanitized, no cookie values). */
test("failure archive records upstream cookie shape without cookie values", () => {
  const archived = {
    source: "fantasy402-ingestion-worker",
    archiveType: "failure",
    upstream: {
      status: 500,
      statusText: "Internal Server Error",
      responseHeaders: { "content-type": "text/plain" },
      responseBody: "upstream error",
      request: {
        contentType: "application/x-www-form-urlencoded",
        bodyKeys: ["RRO", "agentID", "operation"],
        hasAuthorization: true,
        hasCookie: true,
        hasSessionCookie: true,
        hasCfClearance: true,
        hasCfBm: true,
        cookieNames: ["app_session", "cf_clearance", "__cf_bm"],
        origin: "https://fantasy402.test",
        referer: "https://fantasy402.test/manager.html",
        userAgent: "Mozilla/5.0",
        browserHeaders: {},
      },
    },
  };

  // archived.upstream.request.hasSessionCookie, true
  assert.equal(archived.upstream.request.hasSessionCookie, true);
  assert.deepEqual(archived.upstream.request.cookieNames, ["app_session", "cf_clearance", "__cf_bm"]);
  const serialized = JSON.stringify(archived);
  assert.ok(!serialized.includes("session-from-secret"));
  assert.ok(!serialized.includes("clearance-token"));
});
