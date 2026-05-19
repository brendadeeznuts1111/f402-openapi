import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_PROFILE_FACET_KEYS,
  mapCustomerAccountInfo,
  mapCustomerProfileFacet,
} from "../src/customer-profile";

test("maps account info with customer id hint", () => {
  const record = mapCustomerAccountInfo({ INFO: { balance: 100 } }, "snap-1", "cust-9");
  assert.equal(record?.customerId, "cust-9");
  assert.equal(record?.rawSnapshotId, "snap-1");
});

test("maps profile facets", () => {
  for (const facet of CUSTOMER_PROFILE_FACET_KEYS) {
    const record = mapCustomerProfileFacet(facet, { INFO: { customerID: "c1" } }, "snap-2");
    assert.equal(record?.facet, facet);
    assert.equal(record?.customerId, "c1");
  }
});
