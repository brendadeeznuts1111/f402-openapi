#!/usr/bin/env node
/**
 * Upsert player_agents from a saved getListAgenstByAgent JSON response into D1.
 * Usage:
 *   node scripts/seed-player-agents-d1.mjs fantasy402/getListAgenstByAgent-response.json
 *   node scripts/seed-player-agents-d1.mjs fantasy402/getListAgenstByAgent-response.json --remote
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2];
const remote = process.argv.includes("--remote");
const batchSize = Number(process.env.SEED_BATCH_SIZE ?? "150");

if (!inputPath) {
  console.error("Usage: node scripts/seed-player-agents-d1.mjs <response.json> [--remote]");
  process.exit(1);
}

const root = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const players = Array.isArray(root.PLAYERS) ? root.PLAYERS : [];
const snapshotId = crypto.randomUUID();
const capturedAt = new Date().toISOString();

function stringField(item, keys, fallback = "") {
  for (const key of keys) {
    const value = item[key];
    if (value === undefined || value === null) continue;
    return String(value).trim();
  }
  return fallback;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const rows = players
  .map((item) => ({
    customerId: stringField(item, ["customerID", "CustomerID"]),
    login: stringField(item, ["Login", "login"]),
    nameFirst: stringField(item, ["NameFirst", "nameFirst"]),
    agentId: stringField(item, ["Agent", "agent"]),
  }))
  .filter((row) => row.customerId);

console.log(JSON.stringify({ input: inputPath, players: players.length, rows: rows.length, remote, batchSize }, null, 2));

const batchFile = path.join(workerRoot, "fantasy402", ".seed-player-agents-batch.sql");
fs.mkdirSync(path.dirname(batchFile), { recursive: true });

let files = 0;
let applied = 0;

for (let i = 0; i < rows.length; i += batchSize) {
  const batch = rows.slice(i, i + batchSize);
  const statements = batch.map(
    (row) =>
      `INSERT OR REPLACE INTO player_agents (customer_id, login, name_first, agent_id, raw_snapshot_id, captured_at) VALUES (${sqlLiteral(row.customerId)}, ${sqlLiteral(row.login)}, ${sqlLiteral(row.nameFirst)}, ${sqlLiteral(row.agentId)}, ${sqlLiteral(snapshotId)}, ${sqlLiteral(capturedAt)});`,
  );
  fs.writeFileSync(batchFile, `${statements.join("\n")}\n`, "utf8");
  files += 1;

  const wranglerBin = path.join(workerRoot, "node_modules", ".bin", "wrangler");
  const args = ["d1", "execute", "fantasy402-analytics", "--file", batchFile, "--yes"];
  if (remote) args.push("--remote");
  try {
    execFileSync(wranglerBin, args, { cwd: workerRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const execError = error;
    console.error(execError.stdout ?? "");
    console.error(execError.stderr ?? "");
    throw new Error(`batch ${files} failed at offset ${i}: ${execError.message}`);
  }
  applied += batch.length;
  if (files % 20 === 0 || i + batchSize >= rows.length) {
    console.error(`seeded ${applied}/${rows.length}`);
  }
}

try {
  fs.unlinkSync(batchFile);
} catch {
  /* ignore */
}

console.log(JSON.stringify({ status: "ok", rows: applied, snapshotId, capturedAt, batches: files }, null, 2));
