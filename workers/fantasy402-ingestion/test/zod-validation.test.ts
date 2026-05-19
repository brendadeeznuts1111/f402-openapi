import assert from "node:assert/strict";
import test from "node:test";
import { parseScanTriggerRequest, routeSchemas } from "../src/schema";
import { invalidFixture, missingRequiredFixture, validFixture } from "./zod-utils";

test("Zod schemas accept generated valid fixtures", () => {
  for (const [name, schema] of Object.entries(routeSchemas)) {
    const parsed = schema.safeParse(validFixture(schema));
    assert.equal(parsed.success, true, `${name} should accept generated valid fixture`);
  }
});

test("Zod schemas reject malformed non-object inputs", () => {
  for (const [name, schema] of Object.entries(routeSchemas)) {
    const parsed = schema.safeParse("not-an-object");
    assert.equal(parsed.success, false, `${name} should reject malformed non-object input`);
    if (!parsed.success) assert.ok(parsed.error.issues.length > 0);
  }
});

test("Zod schemas reject missing required fields", () => {
  for (const [name, schema] of Object.entries(routeSchemas)) {
    const fixture = missingRequiredFixture(schema);
    if (fixture === null) continue;

    const parsed = schema.safeParse(fixture);
    assert.equal(parsed.success, false, `${name} should reject a missing required field`);
    if (!parsed.success) {
      assert.ok(parsed.error.issues.length > 0, `${name} should report at least one issue for missing required field`);
    }
  }
});

test("Zod schemas reject generated invalid fixtures and failed refinements", () => {
  for (const [name, schema] of Object.entries(routeSchemas)) {
    const parsed = schema.safeParse(invalidFixture(schema));
    assert.equal(parsed.success, false, `${name} should reject generated invalid fixture`);
    if (!parsed.success) assert.ok(parsed.error.issues.length > 0);
  }
});

test("scan trigger helper returns stable error structures for malformed Zod inputs", () => {
  for (const payload of [{ url: "not-a-url" }, { url: "ftp://fantasy402.com" }, { url: 402 }]) {
    const parsed = parseScanTriggerRequest(payload);
    assert.equal("success" in parsed && parsed.success === false, true);
    if ("success" in parsed && parsed.success === false) {
      assert.equal(parsed.error.code, "VALIDATION_001");
      assert.equal(parsed.error.message, "Invalid URL");
    }
  }
  assert.deepEqual(parseScanTriggerRequest({ url: "https://fantasy402.com" }), { url: "https://fantasy402.com" });
  assert.deepEqual(parseScanTriggerRequest({}), {});
});
