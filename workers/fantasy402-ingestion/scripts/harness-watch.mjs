import { spawnSync } from "node:child_process";

console.clear();
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/harness-report.ts", "--check"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
});

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
console.log(`[${startedAt}] Component Harness`);
console.log(output || "no output");
process.exitCode = result.status ?? 1;
