import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";
import { routeSchemas } from "../src/schema";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function readProjectFile(path: string): string {
  return fs.readFileSync(resolve(projectRoot, path), "utf8");
}

function extractBacktickLinks(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((link) => Boolean(link?.includes("."))) as string[];
}

test("public llms.txt lists every dashboard route, route schema, and harness artifact", () => {
  const spec = JSON.parse(readProjectFile("openapi.worker.json"));
  const manifest = JSON.parse(readProjectFile("manifest.json"));
  const llmsPath = manifest.public.llms ?? "public/llms.txt";
  const llmsText = readProjectFile(llmsPath);
  const routePaths = Object.keys(spec.paths).sort();
  const harnessArtifacts = [
    "test/harness.ts",
    "test/harness-self.test.ts",
    "test/openapi-validator.test.ts",
    "test/performance.test.ts",
    "test/error-paths.test.ts",
    "test/route-crawler.test.ts",
    "test/schema.test.ts",
    "test/snapshot.test.ts",
    "test/zod-utils.ts",
    "test/zod-validation.test.ts",
    "test/__snapshots__/openapi-schemas.snap.json",
    "test/__snapshots__/zod-schemas.snap.json",
    "test/__snapshots__/performance-baseline.json",
    "test/harness/snapshots/settings-schema.snap.json",
    "scripts/harness-report.ts",
    "scripts/harness-watch.mjs",
  ].sort();

  for (const routePath of routePaths) {
    assert.match(llmsText, new RegExp(`\`${routePath.replace(/\//g, "\\/")}\``), `${llmsPath} is missing route ${routePath}`);
  }
  for (const schemaName of Object.keys(routeSchemas).sort()) {
    assert.match(llmsText, new RegExp(`\`${schemaName}\``), `${llmsPath} is missing schema ${schemaName}`);
  }
  for (const artifactPath of harnessArtifacts) {
    assert.match(llmsText, new RegExp(`\`${artifactPath.replace(/\//g, "\\/")}\``), `${llmsPath} is missing harness artifact ${artifactPath}`);
  }
});

test("llms.txt dry-run crawl finds no broken local links", () => {
  const manifest = JSON.parse(readProjectFile("manifest.json"));
  const llmsPath = manifest.public.llms ?? "public/llms.txt";
  const links = extractBacktickLinks(readProjectFile(llmsPath));
  const missingLinks = links.filter((link) => !link.startsWith("/") && !fs.existsSync(resolve(projectRoot, link)));

  assert.deepEqual(missingLinks, []);
});

test("metadata files referenced by manifest exist", () => {
  const manifest = JSON.parse(readProjectFile("manifest.json"));
  const metadataPaths = [manifest.public.llm, manifest.public.llms, "agents.md"].filter(Boolean);

  for (const metadataPath of metadataPaths) {
    const absolutePath = resolve(projectRoot, metadataPath);
    assert.equal(fs.existsSync(absolutePath), true, `${metadataPath} is missing`);
    assert.equal(fs.statSync(absolutePath).isFile(), true, `${metadataPath} is not a file`);
    assert.equal(fs.existsSync(dirname(absolutePath)), true);
  }
});
