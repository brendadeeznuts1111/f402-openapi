import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGetAgentPerformanceBody,
  normalizeAgentPerformanceRows,
} from "../src/agent-performance-live";

test("buildGetAgentPerformanceBody matches manager capture", () => {
  const body = buildGetAgentPerformanceBody("BILLY666", { type: "CP", freePlay: "Y" });
  assert.equal(body.agentID, "BILLY666");
  assert.equal(body.type, "CP");
  assert.equal(body.freePlay, "Y");
  assert.equal(body.start, "Invalid date");
  assert.equal(body.operation, "getAgentPerformance");
  assert.equal(body.RRO, 1);
  assert.equal(body.period, -1);
});

test("normalizeAgentPerformanceRows maps customer performance", () => {
  const rows = normalizeAgentPerformanceRows(
    {
      INFO: {
        LIST: [
          {
            CustomerID: "GX195     ",
            Login: "GX195",
            wagercount: 5,
            net: -100.5,
          },
        ],
      },
    },
    "CP",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.customer_id, "GX195");
  assert.equal(rows[0]?.net, -100.5);
});

test("normalizeAgentPerformanceRows maps CPV-style customer row", () => {
  const rows = normalizeAgentPerformanceRows(
    { INFO: { LIST: [{ CustomerID: "X", Login: "L", volume: 1000, net: 50 }] } },
    "CPV",
  );
  assert.equal(rows[0]?.volume, 1000);
});

test("normalizeAgentPerformanceRows maps sport performance", () => {
  const rows = normalizeAgentPerformanceRows(
    {
      INFO: {
        LIST: [
          {
            SportType: "Basketball          ",
            SportSubType: "NBA                 ",
            Bets: 26,
            WonLost: 100,
          },
        ],
      },
    },
    "CPS",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sport_sub_type, "NBA");
  assert.equal(rows[0]?.bets, 26);
});
