import { describe, expect, test } from "bun:test";
import {
  CUSTOMER_PROFILE_FACET_KEYS,
  mapCustomerAccountInfo,
  mapCustomerProfileFacet,
} from "../src/customer-profile";

describe("customer profile mapping", () => {
  test("maps account info with customer id hint", () => {
    const record = mapCustomerAccountInfo({ INFO: { balance: 100 } }, "snap-1", "cust-9");
    expect(record?.customerId).toBe("cust-9");
    expect(record?.rawSnapshotId).toBe("snap-1");
  });

  test("maps profile facets", () => {
    for (const facet of CUSTOMER_PROFILE_FACET_KEYS) {
      const record = mapCustomerProfileFacet(facet, { INFO: { customerID: "c1" } }, "snap-2");
      expect(record?.facet).toBe(facet);
      expect(record?.customerId).toBe("c1");
    }
  });
});
