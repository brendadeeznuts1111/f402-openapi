import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGetInfoPlayerBody,
  buildGetPerformancePlayerBody,
  buildGetReportPlayerAnalysisBody,
  defaultAnalysisDateRange,
  extractInfoPlayerPayload,
  formatPerformanceAcc,
  normalizePerformanceRows,
  normalizePlayerAnalysisRows,
} from "../src/customer-profile-live";

test("formatPerformanceAcc pads login with plus signs", () => {
  assert.equal(formatPerformanceAcc("GX195"), "GX195+++++");
  assert.equal(formatPerformanceAcc("GX195     "), "GX195+++++");
});

test("buildGetInfoPlayerBody matches manager capture", () => {
  const body = buildGetInfoPlayerBody("BILLY666", "GX195");
  assert.equal(body.customerID, "GX195");
  assert.equal(body.agentID, "BILLY666");
  assert.equal(body.RRO, 0);
  assert.equal(body.operation, "getInfoPlayer");
});

test("buildGetPerformancePlayerBody matches manager capture", () => {
  const body = buildGetPerformancePlayerBody("BILLY666", "GX195", 0);
  assert.equal(body.acc, "GX195+++++");
  assert.equal(body.period, 0);
  assert.equal(body.RRO, 1);
});

test("extractInfoPlayerPayload reads INFO.data and balance", () => {
  const parsed = extractInfoPlayerPayload({
    INFO: {
      data: { Login: "GX195", CurrentBalance: 100 },
      balance: { AvailableBalance: 200 },
      thisWeek: { PreviousBalance: 1.5 },
    },
  });
  assert.equal(parsed.data?.Login, "GX195");
  assert.equal(parsed.balance?.AvailableBalance, 200);
  assert.equal(parsed.thisWeek?.PreviousBalance, 1.5);
});

test("normalizePerformanceRows accepts LIST", () => {
  const rows = normalizePerformanceRows({ LIST: [{ Sport: "Football", Win: 1 }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.Sport, "Football");
});

test("buildGetReportPlayerAnalysisBody matches manager capture", () => {
  const body = buildGetReportPlayerAnalysisBody("BILLY666", "GX195", "2026-05-05", "2026-05-19", 2, 2);
  assert.equal(body.customerID, "GX195+++++");
  assert.equal(body.agentID, "BILLY666");
  assert.equal(body.agentOwner, "BILLY666");
  assert.equal(body.reportType, 2);
  assert.equal(body.lineType, 2);
  assert.equal(body.operation, "getReportPlayerAnalysis");
  assert.equal(body.RRO, 1);
});

test("normalizePlayerAnalysisRows maps wager fields", () => {
  const rows = normalizePlayerAnalysisRows([
    {
      DESCRIPTION: "Basketball #564 Spurs",
      RISK: 15750,
      WAGERSTATUS: "W",
      SPORTSUBTYPE: "NBA                 ",
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.description, "Basketball #564 Spurs");
  assert.equal(rows[0]?.risk, 15750);
  assert.equal(rows[0]?.wager_status, "W");
  assert.equal(rows[0]?.sport, "NBA");
});

test("defaultAnalysisDateRange spans 14 days", () => {
  const now = new Date("2026-05-19T12:00:00Z");
  const { startDate, endDate } = defaultAnalysisDateRange(now);
  assert.equal(endDate, "2026-05-19");
  assert.equal(startDate, "2026-05-05");
});
