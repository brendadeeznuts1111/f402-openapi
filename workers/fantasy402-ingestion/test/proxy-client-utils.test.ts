import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocalIngestProxyUrl,
  requireOperatorTokenUnlessProxy,
  workerAuthorizationHeaders,
} from "../scripts/proxy-client-utils.mjs";

test("isLocalIngestProxyUrl detects loopback proxy port", () => {
  assert.equal(isLocalIngestProxyUrl("http://127.0.0.1:8791"), true);
  assert.equal(isLocalIngestProxyUrl("http://localhost:8791/ingest/local/plan"), true);
  assert.equal(isLocalIngestProxyUrl("https://fantasy402-ingestion.example.workers.dev"), false);
});

test("workerAuthorizationHeaders omits Bearer for local proxy", () => {
  assert.deepEqual(workerAuthorizationHeaders("secret-token", "http://127.0.0.1:8791"), {});
  assert.deepEqual(workerAuthorizationHeaders("secret-token", "https://worker.example.dev"), {
    Authorization: "Bearer secret-token",
  });
});

test("requireOperatorTokenUnlessProxy skips token on proxy origin", () => {
  assert.doesNotThrow(() => requireOperatorTokenUnlessProxy("", "http://127.0.0.1:8791"));
  assert.throws(() => requireOperatorTokenUnlessProxy("", "https://worker.example.dev"), /Missing INGESTION_TRIGGER_TOKEN/);
});
