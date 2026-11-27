import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCreateCustomerMeterAccountInput } from "./input";

test("customer meter account input normalizes text and optional fields", () => {
  assert.deepEqual(
    parseCreateCustomerMeterAccountInput({
      customerId: "550e8400-e29b-41d4-a716-446655440000",
      serviceVariantId: "550e8400-e29b-41d4-a716-446655440001",
      zoneId: null,
      notes: null,
    }),
    {
      customerId: "550e8400-e29b-41d4-a716-446655440000",
      serviceVariantId: "550e8400-e29b-41d4-a716-446655440001",
      zoneId: null,
      locationDescription: null,
      notes: null,
      meterId: null,
    },
  );
});

test("customer meter account input rejects unknown fields and invalid values", () => {
  const valid = {
    customerId: "550e8400-e29b-41d4-a716-446655440000",
    serviceVariantId: "550e8400-e29b-41d4-a716-446655440001",
    zoneId: null,
  };

  assert.equal(
    parseCreateCustomerMeterAccountInput({ ...valid, accountNumber: "OLO-000001" }),
    null,
  );
  assert.equal(
    parseCreateCustomerMeterAccountInput({ ...valid, customerId: "bad-id" }),
    null,
  );
  assert.deepEqual(
    parseCreateCustomerMeterAccountInput({
      ...valid,
      meterId: "550e8400-e29b-41d4-a716-446655440002",
      locationDescription: "  Near the school ",
    })?.locationDescription,
    "Near the school",
  );
  assert.equal(
    parseCreateCustomerMeterAccountInput({
      ...valid,
      locationDescription: "Near the school",
    }),
    null,
  );
  assert.equal(
    parseCreateCustomerMeterAccountInput({
      ...valid,
      propertyAddress: "Plot 12",
    }),
    null,
  );
});
