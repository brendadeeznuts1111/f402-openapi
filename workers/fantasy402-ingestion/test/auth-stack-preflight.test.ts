import assert from "node:assert/strict";
import test from "node:test";
import { runAuthStackPreflight } from "../scripts/auth-stack-preflight.mjs";

test("preflight passes when local auth health reports ready", async () => {
  const fetchImpl = async (url: string) => {
    if (url.endsWith("/")) {
      return new Response(JSON.stringify({ service: "fantasy402-local-ingest-proxy" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        status: "ready",
        local: { jwtStatus: "valid", source: "auth-refresh-state" },
        worker: { ingestionReadiness: { status: "ready", blocker: null } },
        reasons: [],
      }),
      { status: 200 },
    );
  };

  const result = await runAuthStackPreflight({
    fetch: fetchImpl,
    workerOrigin: "http://127.0.0.1:8791",
    operatorToken: "",
  });
  assert.equal(result.ok, true);
  assert.equal(result.proxyMode, true);
});

test("preflight fails when proxy is down", async () => {
  const fetchImpl = async () => {
    throw new Error("connection refused");
  };
  const result = await runAuthStackPreflight({
    fetch: fetchImpl,
    workerOrigin: "http://127.0.0.1:8791",
    operatorToken: "",
  });
  assert.equal(result.ok, false);
  assert.match(result.findings.join(" "), /unreachable|failed/i);
});
