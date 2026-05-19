import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";
import { ERROR_CODES, settingsSchema } from "../src/schema";
import { createComponentHarness } from "./harness";

test("SettingsSchema rejects malformed settings payloads", () => {
  const invalidCases: Array<[string, unknown, string]> = [
    ["missing archivePrefix", { archiveListLimit: 50, scanListLimit: 20, defaultScanUrl: "https://fantasy402.com", screenshots: ["desktop"], agentReadiness: true }, "archivePrefix"],
    ["external archivePrefix", { archivePrefix: "other/", archiveListLimit: 50, scanListLimit: 20, defaultScanUrl: "https://fantasy402.com", screenshots: ["desktop"], agentReadiness: true }, "archivePrefix"],
    ["archiveListLimit too high", { archivePrefix: "fantasy402/", archiveListLimit: 1001, scanListLimit: 20, defaultScanUrl: "https://fantasy402.com", screenshots: ["desktop"], agentReadiness: true }, "archiveListLimit"],
    ["scanListLimit too low", { archivePrefix: "fantasy402/", archiveListLimit: 50, scanListLimit: 0, defaultScanUrl: "https://fantasy402.com", screenshots: ["desktop"], agentReadiness: true }, "scanListLimit"],
    ["non-http defaultScanUrl", { archivePrefix: "fantasy402/", archiveListLimit: 50, scanListLimit: 20, defaultScanUrl: "ftp://fantasy402.com", screenshots: ["desktop"], agentReadiness: true }, "defaultScanUrl"],
    ["empty screenshots", { archivePrefix: "fantasy402/", archiveListLimit: 50, scanListLimit: 20, defaultScanUrl: "https://fantasy402.com", screenshots: [], agentReadiness: true }, "screenshots"],
    ["unknown screenshot", { archivePrefix: "fantasy402/", archiveListLimit: 50, scanListLimit: 20, defaultScanUrl: "https://fantasy402.com", screenshots: ["tablet"], agentReadiness: true }, "screenshots"],
    ["agentReadiness wrong type", { archivePrefix: "fantasy402/", archiveListLimit: 50, scanListLimit: 20, defaultScanUrl: "https://fantasy402.com", screenshots: ["desktop"], agentReadiness: "yes" }, "agentReadiness"],
    ["unknown key", { archivePrefix: "fantasy402/", archiveListLimit: 50, scanListLimit: 20, defaultScanUrl: "https://fantasy402.com", screenshots: ["desktop"], agentReadiness: true, extra: true }, ""],
  ];

  for (const [name, payload, expectedPath] of invalidCases) {
    const parsed = settingsSchema.safeParse(payload);
    assert.equal(parsed.success, false, name);
    if (!parsed.success && expectedPath) {
      assert.ok(parsed.error.issues.some((issue) => issue.path.includes(expectedPath)), `${name} should report ${expectedPath}`);
    }
  }
});

test("error code registry is complete for frontend handling", () => {
  for (const [code, definition] of Object.entries(ERROR_CODES)) {
    assert.match(code, /^(AUTH|VALIDATION|NOT_FOUND|RATE_LIMIT|UPSTREAM|LLM)_/);
    assert.equal(typeof definition.httpStatus, "number");
    assert.ok(definition.description.length > 0);
    assert.ok(definition.frontendHandling.length > 0);
  }
});

test("public endpoints return standardized typed errors", async () => {
  const harness = createComponentHarness();
  const unauthorized = await worker.fetch(harness.request("/api/v1/settings"), harness.env);
  const missing = await worker.fetch(harness.request("/api/v1/missing"), harness.env);
  const invalid = await worker.fetch(
    harness.authorized("/api/v1/settings/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archivePrefix: "other/" }),
    }),
    harness.env,
  );

  for (const [response, code] of [
    [unauthorized, "AUTH_001"],
    [missing, "NOT_FOUND_001"],
    [invalid, "VALIDATION_001"],
  ] as const) {
    const body = await response.json() as { success: false; error: { code: string; message: string } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, code);
    assert.ok(body.error.message.length > 0);
  }
});
