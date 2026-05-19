import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAuthHealthTimelineHtml,
  formatWorkerAuthHealthBadge,
  needsAuthRefreshFromAuthHealth,
} from "../../../dashboard/js/auth-stack.js";

test("needsAuthRefreshFromAuthHealth detects degraded and expiring", () => {
  assert.equal(needsAuthRefreshFromAuthHealth({ status: "ready" }), false);
  assert.equal(needsAuthRefreshFromAuthHealth({ status: "degraded" }), true);
  assert.equal(
    needsAuthRefreshFromAuthHealth({
      status: "ready",
      authorizationExpiry: { status: "expiring", ttlSeconds: 120 },
    }),
    true,
  );
});

test("formatWorkerAuthHealthBadge reflects overlay and blocker", () => {
  const ready = formatWorkerAuthHealthBadge({
    status: "ready",
    authorizationExpiry: { status: "valid", ttlSeconds: 3600 },
    authCacheOverlay: { active: true },
    ingestionReadiness: { status: "ready", blocker: null },
  });
  assert.equal(ready.className, "ds-badge--success");
  assert.match(ready.hint, /overlay/i);

  const blocked = formatWorkerAuthHealthBadge({
    status: "degraded",
    authorizationExpiry: { status: "expired" },
    ingestionReadiness: { status: "blocked", blocker: "JWT expired" },
  });
  assert.equal(blocked.className, "ds-badge--error");
});

test("formatAuthHealthTimelineHtml emits valid div markup", () => {
  const ready = formatAuthHealthTimelineHtml({
    status: "ready",
    authorizationExpiry: { status: "valid", ttlSeconds: 900 },
    authCacheOverlay: { active: false },
    ingestionReadiness: { status: "ready", blocker: null },
  });
  assert.match(ready, /ds-timeline__title/);
  assert.doesNotMatch(ready, /<\/?motion/i);

  const unknown = formatAuthHealthTimelineHtml(null);
  assert.match(unknown, /Could not load/);
});
