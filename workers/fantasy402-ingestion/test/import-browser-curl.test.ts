import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("browser cURL import accepts long header and cookie flags from copied requests", () => {
  const dir = mkdtempSync(join(tmpdir(), "fantasy402-curl-"));
  const curlPath = join(dir, "request.curl");
  const outputPath = join(dir, "browser-auth.json");
  writeFileSync(
    curlPath,
    [
      "curl 'https://fantasy402.com/cloud/api/Manager/getAgentPerformance'",
      "  --header 'authorization: Bearer browser-token'",
      "  --header 'content-type: application/x-www-form-urlencoded; charset=UTF-8'",
      "  --header 'user-agent: Browser/1.0'",
      "  --cookie 'ASP.NET_SessionId=app-session; cf_clearance=clearance-token; __cf_bm=bm-token'",
      "  --data-raw 'operation=getAgentPerformance&agentID=agent-1&customerID=cust-1'",
    ].join(" \\\n"),
  );

  const result = spawnSync("node", ["scripts/import-browser-curl.mjs", curlPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FANTASY402_BROWSER_AUTH_FILE: outputPath,
    },
    encoding: "utf8",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    const imported = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(imported.authorization, "Bearer browser-token");
    assert.equal(imported.sessionCookie, "ASP.NET_SessionId=app-session");
    assert.equal(imported.cfClearance, "clearance-token");
    assert.equal(imported.cfBm, "bm-token");
    assert.equal(imported.agentId, "agent-1");
    assert.equal(imported.customerId, "cust-1");
    assert.equal(imported.browserHeaders["user-agent"], "Browser/1.0");
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
