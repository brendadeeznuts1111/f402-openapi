import assert from "node:assert/strict";
import test from "node:test";
import {
  computeCycleBackoffMs,
  ingestLoopsFromCatalog,
  shouldRefreshAuth,
  canRunIngestWithLocalAuth,
} from "../scripts/automation-policy.mjs";
import { isCycleInBackoff, recordCycleOutcome, readCycleState } from "../scripts/cycle-state.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("shouldRefreshAuth skips when preflight ready and JWT valid", () => {
  const d = shouldRefreshAuth({
    preflight: { ok: true, status: "ready" },
    local: { jwtStatus: "valid", jwtTtlSeconds: 3600, source: "browser-auth.json" },
  });
  assert.equal(d.run, false);
});

test("shouldRefreshAuth proactive when JWT inside buffer", () => {
  const d = shouldRefreshAuth({
    preflight: { ok: true, status: "ready" },
    local: { jwtStatus: "valid", jwtTtlSeconds: 60, source: "browser-auth.json" },
  });
  assert.equal(d.run, true);
  assert.equal(d.reason, "proactive-buffer");
});

test("ingestLoopsFromCatalog caps loops", () => {
  const loops = ingestLoopsFromCatalog({ pendingCount: 50, batchSize: 12 }, { maxIngestLoopsPerCycle: 8 });
  assert.equal(loops, 5);
});

test("canRunIngestWithLocalAuth blocks near-expiry JWT", () => {
  const gate = canRunIngestWithLocalAuth(
    { jwtStatus: "valid", jwtTtlSeconds: 30, source: "browser-auth.json" },
    { jwtIngestMinTtlSec: 120 },
  );
  assert.equal(gate.ok, false);
});

test("cycle backoff and record", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f402-cycle-"));
  const stateFile = path.join(dir, "state.json");
  recordCycleOutcome(stateFile, { status: "failed", steps: {} });
  const state = readCycleState(stateFile);
  assert.equal(state?.consecutiveFailures, 1);
  assert.ok(isCycleInBackoff(state));
  recordCycleOutcome(stateFile, { status: "ok", steps: {} });
  const ok = readCycleState(stateFile);
  assert.equal(ok?.consecutiveFailures, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("computeCycleBackoffMs grows with failures", () => {
  assert.ok(computeCycleBackoffMs(3) > computeCycleBackoffMs(1));
});
