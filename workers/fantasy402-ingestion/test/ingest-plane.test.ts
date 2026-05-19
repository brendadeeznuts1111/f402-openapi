import assert from "node:assert/strict";
import test from "node:test";
import {
  ingestPlaneForKey,
  ingestPlaneSummary,
  partitionKeysByPlane,
  workerTriggerMode,
} from "../src/ingest-plane.ts";

test("Manager routes default to browser plane", () => {
  assert.equal(ingestPlaneForKey("getPlayers"), "browser");
  assert.equal(ingestPlaneForKey("getBetTicker"), "browser");
});

test("ingestPlaneSummary recommends skip when no edge routes", () => {
  const summary = ingestPlaneSummary(["getPlayers", "getBetTicker"]);
  assert.equal(summary.edgeEligibleCount, 0);
  assert.equal(summary.browserPlaneCount, 2);
  assert.match(summary.workerTriggerRecommendation, /skip/i);
});

test("workerTriggerMode parses skip", () => {
  assert.equal(workerTriggerMode({ FANTASY402_WORKER_TRIGGER_MODE: "skip" }), "skip");
  assert.equal(workerTriggerMode({ FANTASY402_WORKER_TRIGGER_MODE: "attempt" }), "attempt");
});

test("partitionKeysByPlane splits keys", () => {
  const parts = partitionKeysByPlane(["a", "b"]);
  assert.equal(parts.browser.length, 2);
  assert.equal(parts.edge.length, 0);
});
