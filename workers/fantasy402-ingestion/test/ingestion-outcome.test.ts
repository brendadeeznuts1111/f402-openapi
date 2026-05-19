import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyIngestionOutcome,
  deriveRunStatus,
  formatRunMeta,
  parseRunMeta,
  skipNoteForRun,
} from "../src/ingestion-outcome";

test("classifyIngestionOutcome treats 403 and 404 as skipped", () => {
  assert.equal(classifyIngestionOutcome(403), "skipped");
  assert.equal(classifyIngestionOutcome(404), "skipped");
  assert.equal(classifyIngestionOutcome(401), "failed");
  assert.equal(classifyIngestionOutcome(500), "failed");
  assert.equal(classifyIngestionOutcome(null), "failed");
});

test("deriveRunStatus distinguishes partial runs", () => {
  assert.equal(deriveRunStatus(12, 0), "success");
  assert.equal(deriveRunStatus(8, 4), "partial");
  assert.equal(deriveRunStatus(0, 12), "failed");
});

test("skipNoteForRun explains all-skipped worker runs", () => {
  assert.match(
    skipNoteForRun(0, 0, 12) ?? "",
    /local\/browser ingest/i,
  );
  assert.equal(skipNoteForRun(6, 0, 0), undefined);
  assert.equal(skipNoteForRun(0, 2, 0), "One or more endpoints failed");
});

test("formatRunMeta and parseRunMeta round-trip skipped counts", () => {
  const meta = formatRunMeta(7, "One or more endpoints failed");
  assert.ok(meta);
  assert.deepEqual(parseRunMeta(meta), { skipped: 7, note: "One or more endpoints failed" });
  assert.deepEqual(parseRunMeta("legacy error"), { skipped: 0, note: "legacy error" });
});
