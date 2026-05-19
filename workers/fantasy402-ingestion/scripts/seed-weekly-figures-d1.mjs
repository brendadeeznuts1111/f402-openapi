#!/usr/bin/env node
/**
 * Fetch or import getWeeklyFigureByAgentLite and insert weekly_figures into D1.
 * Usage:
 *   node scripts/seed-weekly-figures-d1.mjs [--remote] [browser-auth.json]
 *   node scripts/seed-weekly-figures-d1.mjs --remote --from-json fantasy402/getWeeklyFigureByAgentLite-response.json
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remote = process.argv.includes("--remote");
const fromJsonIdx = process.argv.indexOf("--from-json");
const fromJsonPath = fromJsonIdx >= 0 ? process.argv[fromJsonIdx + 1] : null;
const authFile =
  process.argv.find((arg) => arg.endsWith(".json") && arg !== fromJsonPath) ??
  path.join(workerRoot, "fantasy402", "browser-auth.json");

const agentId =
  process.env.FANTASY402_AGENT_ID ??
  (fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, "utf8")).agentId : null) ??
  "BILLY666";

let data;
if (fromJsonPath) {
  data = JSON.parse(fs.readFileSync(path.resolve(fromJsonPath), "utf8"));
} else {
  const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
  const body = new URLSearchParams({
    agentID: agentId,
    agentOwner: agentId,
    operation: "getWeeklyFigureByAgentLite",
    RRO: "1",
    week: "0",
    type: "A",
    layout: "byDay",
  });
  const headers = {
    accept: "*/*",
    authorization: auth.authorization,
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    cookie: [auth.cfClearance && `cf_clearance=${auth.cfClearance}`, auth.cfBm && `__cf_bm=${auth.cfBm}`].filter(Boolean).join("; "),
    ...(auth.browserHeaders ?? {}),
  };
  const response = await fetch("https://fantasy402.com/cloud/api/Manager/getWeeklyFigureByAgentLite", {
    method: "POST",
    headers,
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(JSON.stringify({ status: "failed", httpStatus: response.status, body: text.slice(0, 500) }, null, 2));
    process.exit(1);
  }
  data = JSON.parse(text);
}
const snapshotId = crypto.randomUUID();
const runId = crypto.randomUUID();
const capturedAt = new Date().toISOString();

function weeklyFigureListItems(root) {
  if (Array.isArray(root?.LIST)) return root.LIST;
  if (root?.LIST && typeof root.LIST === "object" && Array.isArray(root.LIST.ARRAY)) return root.LIST.ARRAY;
  return [];
}

const list = weeklyFigureListItems(data);

function stringField(item, keys, fallback = "") {
  for (const key of keys) {
    const value = item[key];
    if (value === undefined || value === null) continue;
    return String(value).trim();
  }
  return fallback;
}

function numberField(item, keys, fallback = 0) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const rows = list.map((item) => {
  const liteShape = "ThisWeek" in item || "Today" in item || "Active" in item;
  return {
    snapshotId,
    runId,
    agentId: stringField(item, ["AgentID", "agentID", "Agent"], agentId) || agentId,
    week: numberField(item, ["Week", "week"], 0),
    type: stringField(item, ["Type", "type"], liteShape ? "A" : "O"),
    figureDate: stringField(item, ["Date", "date", "FigureDate", "figureDate"], liteShape ? "lite-summary" : ""),
    wagerCount: numberField(item, ["WagerCount", "wagerCount", "TotalWagers", "totalWagers", "Active", "active"], 0),
    volume: numberField(item, ["Volume", "volume", "TotalVolume", "totalVolume"], 0),
    netAmount: numberField(item, ["NetAmount", "netAmount", "Net", "net", "ThisWeek", "Today"], 0),
    bigWagers: numberField(item, ["BigWagers", "bigWagers", "BigAmountCount"], 0),
    rawJson: JSON.stringify(item),
    capturedAt,
  };
});

console.log(JSON.stringify({ listItems: list.length, rows: rows.length, remote, agentId }, null, 2));

if (!rows.length) {
  fs.writeFileSync(path.join(workerRoot, "fantasy402", "getWeeklyFigureByAgentLite-response.json"), JSON.stringify(data, null, 2));
  console.error("No LIST rows — saved full response for inspection");
  process.exit(1);
}

const batchFile = path.join(workerRoot, "fantasy402", ".seed-weekly-figures-batch.sql");
const statements = rows.map(
  (r) =>
    `INSERT INTO weekly_figures (snapshot_id, run_id, agent_id, week, type, figure_date, wager_count, volume, net_amount, big_wagers, raw_json, captured_at) VALUES (${sqlLiteral(r.snapshotId)}, ${sqlLiteral(r.runId)}, ${sqlLiteral(r.agentId)}, ${r.week}, ${sqlLiteral(r.type)}, ${sqlLiteral(r.figureDate)}, ${r.wagerCount}, ${r.volume}, ${r.netAmount}, ${r.bigWagers}, ${sqlLiteral(r.rawJson)}, ${sqlLiteral(r.capturedAt)});`,
);

const batchSize = Number(process.env.SEED_BATCH_SIZE ?? "100");
let applied = 0;
for (let i = 0; i < statements.length; i += batchSize) {
  const chunk = statements.slice(i, i + batchSize);
  fs.writeFileSync(batchFile, `${chunk.join("\n")}\n`, "utf8");
  const args = ["d1", "execute", "fantasy402-analytics", "--file", batchFile, "--yes"];
  if (remote) args.push("--remote");
  try {
    execFileSync("npx", ["wrangler", ...args], { cwd: workerRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    console.error(error.stdout ?? "");
    console.error(error.stderr ?? "");
    throw error;
  }
  applied += chunk.length;
}

try {
  fs.unlinkSync(batchFile);
} catch {
  /* ignore */
}

console.log(JSON.stringify({ status: "ok", rows: applied, snapshotId, runId }, null, 2));
