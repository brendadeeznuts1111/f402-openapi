import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCustomerProfileSources,
  resolveActiveSource,
  workerIngestionScheduleLabel,
} from "../src/customer-profile-sources";

test("workerIngestionScheduleLabel reflects trigger mode", () => {
  assert.match(workerIngestionScheduleLabel("skip"), /skip/i);
  assert.match(workerIngestionScheduleLabel("attempt"), /15/);
});

test("resolveActiveSource marks failed live", () => {
  assert.equal(
    resolveActiveSource({ ok: false, fetchedAt: "2026-01-01", error: "auth" }, null),
    "failed",
  );
  assert.equal(resolveActiveSource({ ok: true, fetchedAt: "2026-01-01" }, null), "live");
  assert.equal(
    resolveActiveSource(null, { present: true, capturedAt: "x", snapshotId: "s", ingestKey: "k", d1Table: "t" }),
    "seeded",
  );
});

test("buildCustomerProfileSources prefers live getInfoPlayer over seeded facet", () => {
  const profile = {
    player: { captured_at: "2026-05-01T00:00:00.000Z" },
    account: null,
    seededFacets: {
      getInfoPlayer: { capturedAt: "2026-05-02T00:00:00.000Z", snapshotId: "snap-1" },
    },
    webLogs: null,
  };
  const live = {
    fetched_at: "2026-05-19T12:00:00.000Z",
    getInfoPlayer: { ok: true },
    getPerformancePlayer: { ok: false, error: "auth" },
  };
  const { blocks } = buildCustomerProfileSources(profile, live, { workerTriggerMode: "skip" });
  const info = blocks.find((b) => b.id === "getInfoPlayer");
  assert.equal(info?.activeSource, "live");
  const perf = blocks.find((b) => b.id === "getPerformancePlayer");
  assert.equal(perf?.activeSource, "failed");
  assert.equal(perf?.live?.error, "auth");
});

test("buildCustomerProfileSources marks seeded-only facets and web_logs", () => {
  const profile = {
    player: null,
    account: null,
    seededFacets: {
      getMail: { capturedAt: "2026-05-03T00:00:00.000Z", snapshotId: "snap-mail" },
    },
    webLogs: { lastCapturedAt: "2026-05-18T00:00:00.000Z", count24h: 3 },
  };
  const mail = buildCustomerProfileSources(profile, null).blocks.find((b) => b.id === "getMail");
  assert.equal(mail?.activeSource, "seeded");
  const logs = buildCustomerProfileSources(profile, null).blocks.find((b) => b.id === "web_logs");
  assert.equal(logs?.activeSource, "seeded");
  assert.match(logs?.seeded?.detail ?? "", /3 events/);
});
