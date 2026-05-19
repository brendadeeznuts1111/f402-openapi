import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldSendCycleAlert,
  formatCycleAlertMessage,
  maybeSendCycleAlert,
} from "../scripts/cycle-alerts.mjs";

test("shouldSendCycleAlert respects threshold and cooldown", () => {
  const cfg = { webhookUrl: "https://example.com/hook", failureThreshold: 3, cooldownMs: 60_000 };
  assert.equal(shouldSendCycleAlert({ consecutiveFailures: 2 }, cfg).send, false);
  assert.equal(shouldSendCycleAlert({ consecutiveFailures: 3 }, cfg).send, true);
  const cooled = shouldSendCycleAlert(
    { consecutiveFailures: 5, lastAlertAt: new Date().toISOString() },
    cfg,
  );
  assert.equal(cooled.send, false);
  assert.equal(cooled.reason, "cooldown");
});

test("maybeSendCycleAlert posts slack-style body", async () => {
  let posted = "";
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    posted = String(init?.body);
    return new Response("ok", { status: 200 });
  };
  const result = await maybeSendCycleAlert(
    { consecutiveFailures: 3, lastStatus: "failed", message: "test" },
    { fetch: fetchImpl, config: { webhookUrl: "https://x", failureThreshold: 3, cooldownMs: 0 } },
  );
  assert.equal(result.sent, true);
  assert.match(posted, /"text"/);
  assert.match(posted, /consecutiveFailures/);
});

test("formatCycleAlertMessage includes key fields", () => {
  const text = formatCycleAlertMessage({
    lastStatus: "partial",
    consecutiveFailures: 2,
    lastRunAt: "2026-01-01T00:00:00.000Z",
  });
  assert.match(text, /partial/);
  assert.match(text, /consecutiveFailures/);
});
