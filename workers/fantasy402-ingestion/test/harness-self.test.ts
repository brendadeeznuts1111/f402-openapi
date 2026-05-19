import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const testRoot = fileURLToPath(new URL(".", import.meta.url));

test("component harness compiles under strict TypeScript settings", () => {
  execFileSync(
    resolve(projectRoot, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--pretty",
      "false",
      "--strict",
      "--noUncheckedIndexedAccess",
      "--exactOptionalPropertyTypes",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "ES2022",
      "--moduleResolution",
      "Bundler",
      "--lib",
      "ES2022",
      "--types",
      "@cloudflare/workers-types,node",
      "test/harness.ts",
    ],
    { cwd: projectRoot, stdio: "pipe" },
  );
});

test("test helper imports do not contain circular dependencies", () => {
  const helperFiles = fs
    .readdirSync(testRoot)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => resolve(testRoot, file));
  const helperSet = new Set(helperFiles);
  const graph = new Map<string, string[]>();

  for (const file of helperFiles) {
    const source = fs.readFileSync(file, "utf8");
    const imports = [...source.matchAll(/from\s+["'](\.\/[^"']+)["']/g)]
      .map((match) => resolve(dirname(file), `${match[1]}.ts`))
      .filter((candidate) => helperSet.has(candidate));
    graph.set(file, imports);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(file: string, stack: string[]): void {
    if (visiting.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file]);
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const next of graph.get(file) ?? []) visit(next, [...stack, next]);
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of helperFiles) visit(file, [file]);

  assert.deepEqual(
    cycles.map((cycle) => cycle.map((file) => basename(file))),
    [],
  );
});
