import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index";
import { createComponentHarness } from "./harness";

test("operator viewer renders each tab without crashing", async () => {
  const harness = createComponentHarness();
  const response = await worker.fetch(harness.request("/archive/viewer"), harness.env);
  const html = await response.text();

  assert.equal(response.status, 200);
  for (const tabName of ["archive", "scans", "settings"]) {
    assert.match(html, new RegExp(`data-tab="${tabName}"`), `${tabName} tab is missing`);
    assert.match(html, new RegExp(`data-panel="${tabName}"`), `${tabName} panel is missing`);
    assert.match(html, new RegExp(`showTab\\(${tabName}|showTab\\(tab\\.dataset\\.tab|data-tab="${tabName}"`));
  }
});

test("settings routes respond through the worker harness", async () => {
  const harness = createComponentHarness();
  const settings = await worker.fetch(harness.authorized("/settings"), harness.env);
  const schema = await worker.fetch(harness.authorized("/settings/schema"), harness.env);
  const validated = await worker.fetch(
    harness.authorized("/settings/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await settings.clone().json()),
    }),
    harness.env,
  );

  assert.equal(settings.status, 200);
  assert.equal(schema.status, 200);
  assert.equal(validated.status, 200);
  assert.equal((await schema.json() as { name: string }).name, "SettingsSchema");
});

test("agent routes expose typed registry and health", async () => {
  const harness = createComponentHarness();
  const registry = await worker.fetch(harness.authorized("/api/v1/agents"), harness.env);
  const health = await worker.fetch(harness.authorized("/api/v1/agents/health"), harness.env);

  assert.equal(registry.status, 200);
  assert.equal(health.status, 200);
  assert.deepEqual((await registry.json() as { agents: { id: string }[] }).agents.map((agent) => agent.id), ["Summarizer", "Router", "CodeGen"]);
  assert.deepEqual((await health.json() as { agents: { status: string }[] }).agents.map((agent) => agent.status), ["ok", "ok", "ok"]);
});

test("versioned route aliases resolve through the public route crawler", async () => {
  const harness = createComponentHarness();
  const health = await worker.fetch(harness.request("/api/v1/health"), harness.env);
  const settings = await worker.fetch(harness.authorized("/api/v1/settings"), harness.env);
  const scans = await worker.fetch(harness.authorized("/api/v1/scans?limit=1"), harness.env);

  assert.equal(health.status, 200);
  assert.equal(settings.status, 200);
  assert.equal(scans.status, 200);
});
