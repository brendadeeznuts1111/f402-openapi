import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPerformanceLiveQuerySchema,
  customerProfileQuerySchema,
  customerProfileSeedSchema,
  pendingWagersQuerySchema,
  searchCustomersQuerySchema,
} from "../src/schemas";
import { formatZodIssues, parseSearchParams, validationErrorBody } from "../src/validate";

test("customerProfileQuerySchema requires customer_id or id", () => {
  const result = parseSearchParams(customerProfileQuerySchema, new URLSearchParams());
  assert.equal(result.ok, false);
  if (result.ok) return;
  const body = validationErrorBody(result.error);
  assert.equal(body.code, "VALIDATION_ERROR");
  assert.ok(body.issues.some((i) => i.path === "customer_id"));
});

test("customerProfileQuerySchema rejects start after end", () => {
  const result = parseSearchParams(
    customerProfileQuerySchema,
    new URLSearchParams({
      customer_id: "GX195",
      start_date: "2026-05-20",
      end_date: "2026-05-01",
    }),
  );
  assert.equal(result.ok, false);
});

test("customerProfileQuerySchema maps live flag and customerId", () => {
  const result = parseSearchParams(
    customerProfileQuerySchema,
    new URLSearchParams({ id: "GX195", live: "0" }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.customerId, "GX195");
  assert.equal(result.data.wantLive, false);
});

test("customerProfileSeedSchema rejects empty object", () => {
  const parsed = customerProfileSeedSchema.safeParse({});
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.ok(formatZodIssues(parsed.error).length > 0);
});

test("customerProfileSeedSchema rejects literal undefined string", () => {
  const parsed = customerProfileSeedSchema.safeParse({ customer_id: "undefined" });
  assert.equal(parsed.success, false);
});

test("agentPerformanceLiveQuerySchema validates type enum", () => {
  const bad = parseSearchParams(
    agentPerformanceLiveQuerySchema,
    new URLSearchParams({ type: "INVALID" }),
  );
  assert.equal(bad.ok, false);

  const ok = parseSearchParams(
    agentPerformanceLiveQuerySchema,
    new URLSearchParams({ type: "cp", free_play: "n" }),
  );
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.data.type, "CP");
  assert.equal(ok.data.free_play, "N");
  assert.equal(ok.data.start, "Invalid date");
});

test("searchCustomersQuerySchema requires q min length", () => {
  const result = parseSearchParams(searchCustomersQuerySchema, new URLSearchParams({ q: "x" }));
  assert.equal(result.ok, false);
});

test("pendingWagersQuerySchema rejects invalid wager_type", () => {
  const result = parseSearchParams(
    pendingWagersQuerySchema,
    new URLSearchParams({ wager_type: "X" }),
  );
  assert.equal(result.ok, false);
});
