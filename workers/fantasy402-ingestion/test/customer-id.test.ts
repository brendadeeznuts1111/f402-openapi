import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeriveCustomerId,
  customerIdSourceForKey,
  extractPlayerCustomerId,
  GET_PLAYERS_CUSTOMER_ID_SOURCE,
} from "../src/customer-id";

test("extractPlayerCustomerId reads first LIST customerID", () => {
  assert.equal(
    extractPlayerCustomerId({
      LIST: [{ customerID: "RX6157", Login: "RX6157" }, { customerID: "RX6158" }],
    }),
    "RX6157",
  );
});

test("extractPlayerCustomerId ignores empty and redacted values", () => {
  assert.equal(extractPlayerCustomerId({ LIST: [{ customerID: "__REDACTED__" }] }), null);
  assert.equal(extractPlayerCustomerId({ LIST: [] }), null);
  assert.equal(extractPlayerCustomerId(null), null);
});

test("canDeriveCustomerId is true when getPlayers is in manifest", () => {
  assert.equal(canDeriveCustomerId(), true);
});

test("customer-scoped endpoints declare Manager/getPlayers source", () => {
  for (const key of ["getPending", "Pending", "getCommunicationMessages"]) {
    assert.equal(customerIdSourceForKey(key), GET_PLAYERS_CUSTOMER_ID_SOURCE);
  }
});
