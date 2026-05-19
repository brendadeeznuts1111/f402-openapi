import assert from "node:assert/strict";
import test from "node:test";
import { submitAndWait } from "../src/url-scanner";
import { createComponentHarness, withFetchMock } from "./harness";

test("submitAndWait archives scanner artifacts and stores verdict", async () => {
  const harness = createComponentHarness();

  const scanResult = {
    result: {
      task: {
        uuid: "scan-123",
        url: "https://fantasy402.com",
        time: "2026-05-17T00:00:00.000Z",
        success: true,
      },
      verdicts: { overall: { malicious: false } },
      page: { tlsValidDays: 42 },
      meta: { processors: { agentReadiness: { level: 1 } } },
    },
  };

  const calls: string[] = [];
  await withFetchMock(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/urlscanner/v2/scan")) {
      return Response.json({ result: { uuid: "scan-123" } });
    }
    if (url.endsWith("/urlscanner/v2/result/scan-123")) {
      return Response.json(scanResult);
    }
    if (url.includes("/urlscanner/v2/screenshots/scan-123.png")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    }
    if (url.endsWith("/urlscanner/v2/har/scan-123")) {
      return Response.json({ log: { entries: [] } });
    }
    return new Response("not found", { status: 404 });
  }, async () => {
    const result = await submitAndWait("https://fantasy402.com", harness.env, {
      agentReadiness: true,
      screenshots: ["desktop", "mobile"],
    });

    assert.equal(result.task.uuid, "scan-123");
    assert.equal(harness.systemView().r2Writes.length, 4);
    assert.deepEqual(
      harness.systemView().r2Writes.map((write) => write.key),
      [
        "fantasy402/scans/2026-05-17/scan-123.json",
        "fantasy402/screenshots/scan-123_desktop.png",
        "fantasy402/screenshots/scan-123_mobile.png",
        "fantasy402/hars/scan-123.har",
      ],
    );
    assert.equal(harness.db.lastBindings[0], "scan-123");
    assert.equal(harness.db.lastBindings[3], 0);
    assert.equal(harness.db.lastBindings[4], 42);
    assert.equal(harness.db.lastBindings[5], 1);
    assert.ok(calls.every((url) => url.includes("/accounts/account-id/urlscanner/v2/")));
  });
});
