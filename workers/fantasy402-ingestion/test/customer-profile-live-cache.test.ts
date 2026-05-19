import assert from "node:assert/strict";
import test from "node:test";
import {
  profileLiveCacheKeyPerf,
  profileLiveCacheKeyAnalysis,
  PROFILE_LIVE_CACHE_TTL_SECONDS,
} from "../src/customer-profile-live-cache";

test("profileLiveCacheKeyPerf is stable per acc and period", () => {
  const a = profileLiveCacheKeyPerf("BILLY666", "GX195+++++", 0);
  const b = profileLiveCacheKeyPerf("BILLY666", "GX195+++++", 0);
  const c = profileLiveCacheKeyPerf("BILLY666", "GX195+++++", 1);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("profileLiveCacheKeyAnalysis includes date range", () => {
  const k = profileLiveCacheKeyAnalysis("A", "GX195", "2026-05-01", "2026-05-19", 2, 2);
  assert.match(k, /2026-05-01/);
  assert.match(k, /analysis/);
});

test("PROFILE_LIVE_CACHE_TTL_SECONDS is under two minutes", () => {
  assert.equal(PROFILE_LIVE_CACHE_TTL_SECONDS, 45);
});
