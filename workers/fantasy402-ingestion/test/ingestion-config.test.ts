import assert from "node:assert/strict";
import test from "node:test";
import {
  INGESTION_ALL,
  ingestionBatchSize,
  planIngestionBatch,
  resolveIngestionEndpointKeys,
} from "../src/ingestion-config";
import { UPSTREAM_MANIFEST } from "../src/upstream-manifest";

const knownKeys = new Set(UPSTREAM_MANIFEST.endpoints.map((entry) => entry.key));
const customerKeys = new Set(
  UPSTREAM_MANIFEST.endpoints.filter((entry) => entry.requiresCustomerId).map((entry) => entry.key),
);

test("resolveIngestionEndpointKeys expands all from manifest", () => {
  const keys = resolveIngestionEndpointKeys(INGESTION_ALL, {
    hasCustomerId: false,
    isKnownKey: (key) => knownKeys.has(key),
    requiresCustomerId: (key) => customerKeys.has(key),
  });
  assert.equal(keys.length, UPSTREAM_MANIFEST.endpoints.length - customerKeys.size);
  assert.ok(!keys.some((key) => customerKeys.has(key)));
});

test("resolveIngestionEndpointKeys includes customer endpoints when configured", () => {
  const keys = resolveIngestionEndpointKeys(INGESTION_ALL, {
    hasCustomerId: true,
    isKnownKey: (key) => knownKeys.has(key),
    requiresCustomerId: (key) => customerKeys.has(key),
  });
  assert.equal(keys.length, UPSTREAM_MANIFEST.endpoints.length);
});

test("planIngestionBatch rotates through catalog", () => {
  const catalog = ["a", "b", "c", "d", "e"];
  const first = planIngestionBatch(catalog, 0, 2);
  assert.deepEqual(first.keys, ["a", "b"]);
  assert.equal(first.nextCursor, 2);

  const second = planIngestionBatch(catalog, first.nextCursor, 2);
  assert.deepEqual(second.keys, ["c", "d"]);
  assert.equal(second.nextCursor, 4);

  const wrap = planIngestionBatch(catalog, second.nextCursor, 2);
  assert.deepEqual(wrap.keys, ["e", "a"]);
  assert.equal(wrap.nextCursor, 1);
});

test("ingestionBatchSize clamps invalid values", () => {
  assert.equal(ingestionBatchSize(undefined), 12);
  assert.equal(ingestionBatchSize("0"), 1);
  assert.equal(ingestionBatchSize("999"), 86);
  assert.equal(ingestionBatchSize("20"), 20);
});
