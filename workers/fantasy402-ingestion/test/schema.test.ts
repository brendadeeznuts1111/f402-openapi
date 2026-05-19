import assert from "node:assert/strict";
import fs from "node:fs";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import {
  ENDPOINT_KEYS,
  archiveKey,
  clampInteger,
  isEndpointKey,
  normalizeArchivePrefix,
  parseScanTriggerRequest,
  routeSchemas,
} from "../src/schema";

test("schema helpers validate component-level inputs consistently", () => {
  assert.equal(isEndpointKey("getAgentPerformance"), true);
  assert.equal(isEndpointKey("deleteEverything"), false);
  assert.equal(ENDPOINT_KEYS.includes("getHeriarchy"), true);

  assert.equal(archiveKey("getAgentPerformance", "2026-05-17", "snapshot-1"), "fantasy402/getAgentPerformance/2026-05-17/snapshot-1.json");
  assert.equal(normalizeArchivePrefix("/fantasy402/getPlayers"), "fantasy402/getPlayers");
  assert.equal(normalizeArchivePrefix("other/private"), "fantasy402");
  assert.equal(clampInteger(5000, 1, 1000), 1000);
  assert.equal(clampInteger(Number.NaN, 1, 1000), 1);
});

test("scan trigger request schema accepts default target and rejects invalid URLs", () => {
  assert.deepEqual(parseScanTriggerRequest(null), {});
  assert.deepEqual(parseScanTriggerRequest({}), {});
  assert.deepEqual(parseScanTriggerRequest({ url: "https://fantasy402.com" }), { url: "https://fantasy402.com" });
  for (const parsed of [parseScanTriggerRequest({ url: "ftp://fantasy402.com" }), parseScanTriggerRequest({ url: 402 })]) {
    assert.equal("success" in parsed && parsed.success === false, true);
  }
});

test("project metadata references the public LLM docs and worker entry points", () => {
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8"));
  assert.equal(manifest.name, "fantasy402-ingestion");
  assert.equal(manifest.entrypoints.worker, "src/index.ts");
  assert.equal(manifest.public.llm, "public/llm.txt");
  assert.equal(fs.existsSync(fileURLToPath(new URL("../public/llm.txt", import.meta.url))), true);
  assert.equal(fs.existsSync(fileURLToPath(new URL("../agents.md", import.meta.url))), true);
});

test("metadata stays synchronized with route schemas and source entry points", () => {
  const schemaNames = Object.keys(routeSchemas).sort();
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8"));
  const llmText = fs.readFileSync(fileURLToPath(new URL("../public/llm.txt", import.meta.url)), "utf8");
  const agentsText = fs.readFileSync(fileURLToPath(new URL("../agents.md", import.meta.url)), "utf8");

  assert.deepEqual([...manifest.schemas].sort(), schemaNames);
  assert.equal(fs.existsSync(fileURLToPath(new URL(`../${manifest.entrypoints.worker}`, import.meta.url))), true);
  assert.equal(fs.existsSync(fileURLToPath(new URL(`../${manifest.entrypoints.urlScanner}`, import.meta.url))), true);
  assert.equal(fs.existsSync(fileURLToPath(new URL(`../${manifest.entrypoints.schema}`, import.meta.url))), true);

  for (const schemaName of schemaNames) {
    assert.match(llmText, new RegExp(`\\b${schemaName}\\b`), `public/llm.txt is missing ${schemaName}`);
  }
  for (const settingsRoute of ["/settings", "/settings/schema", "/settings/validate"]) {
    assert.match(llmText, new RegExp(`\`${settingsRoute.replace(/\//g, "\\/")}\``), `public/llm.txt is missing ${settingsRoute}`);
  }
  assert.match(agentsText, /routeSchemas/);
  assert.match(agentsText, /UPDATE_SNAPSHOTS=1/);
});

test("OpenAPI exposes schemas that correspond to exported route models", () => {
  const spec = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../openapi.worker.json", import.meta.url)), "utf8"));
  for (const schemaName of Object.keys(routeSchemas)) {
    assert.ok(spec.components.schemas[schemaName], `missing OpenAPI schema ${schemaName}`);
    assert.equal(spec.components.schemas[schemaName].additionalProperties, false);
  }
});
