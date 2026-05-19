import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransactionsBody,
  normalizeTransactionRows,
  TRANSACTION_REPORT_TYPES,
} from "../src/transactions-live";
import { parseSearchParams } from "../src/validate";
import { transactionsLiveQuerySchema } from "../src/schemas";

test("buildTransactionsBody matches manager getTransactionHistory (agent)", () => {
  const body = buildTransactionsBody({
    type: "agent",
    agentId: "BILLY666",
    startDate: "2026-05-19",
    endDate: "2026-05-19",
  });
  assert.equal(body.operation, "getTransactionHistory");
  assert.equal(body.agentID, "BILLY666");
  assert.equal(body.freeFlag, "agent");
  assert.equal(body.deposits, "checked");
  assert.equal(body.distribution, "unchecked");
  assert.equal(body.fess, "checked");
});

test("buildTransactionsBody matches manager getReportDeletedTransactions", () => {
  const body = buildTransactionsBody({
    type: "deleted",
    agentId: "BILLY666",
    customerId: "BILLY666",
    startDate: "2026-05-19",
    endDate: "2026-05-19",
  });
  assert.equal(body.operation, "getReportDeletedTransactions");
  assert.ok(String(body.customerID).startsWith("BILLY666"));
  assert.equal(body.RRO, 1);
});

test("buildTransactionsBody free-play uses promotional only", () => {
  const body = buildTransactionsBody({
    type: "free-play",
    agentId: "A1",
    startDate: "2026-05-01",
    endDate: "2026-05-02",
  });
  assert.equal(body.promotional, "checked");
  assert.equal(body.deposits, "unchecked");
  assert.equal(body.freeFlag, "player");
});

test("transactionsLiveQuerySchema validates type enum", () => {
  const bad = parseSearchParams(transactionsLiveQuerySchema, new URLSearchParams({ type: "invalid" }));
  assert.equal(bad.ok, false);
  const ok = parseSearchParams(
    transactionsLiveQuerySchema,
    new URLSearchParams({ type: "player", start_date: "2026-05-01", end_date: "2026-05-19" }),
  );
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.data.type, "player");
  assert.equal(ok.data.startDate, "2026-05-01");
});

test("normalizeTransactionRows maps LIST", () => {
  const rows = normalizeTransactionRows({
    LIST: [{ DESCRIPTION: "Deposit", AMOUNT: 100, LOGIN: "P1" }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.description, "Deposit");
  assert.equal(rows[0]?.login, "P1");
});

test("TRANSACTION_REPORT_TYPES covers manager select options", () => {
  assert.equal(TRANSACTION_REPORT_TYPES.player.label, "Player Transactions");
  assert.equal(TRANSACTION_REPORT_TYPES.summary.operation, "getTransactionList");
});
