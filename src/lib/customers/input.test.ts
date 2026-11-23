import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCreateCustomerInput,
  parseLinkStaffCustomerAccessInput,
  parseUpdateCustomerInput,
} from "./input";

test("customer create input normalizes required fields and defaults optional fields", () => {
  assert.deepEqual(
    parseCreateCustomerInput({
      customerType: "individual",
      fullName: "  Customer Name ",
      phone: " 0700000000 ",
      email: " CUSTOMER@Example.Test ",
    }),
    {
      customerType: "individual",
      fullName: "Customer Name",
      phone: "0700000000",
      email: "customer@example.test",
      physicalAddress: null,
      locationDescription: null,
      notes: null,
    },
  );
});

test("customer create input rejects invalid and server-controlled fields", () => {
  const valid = {
    customerType: "business",
    fullName: "Business",
    phone: "0700000000",
    email: "business@example.test",
  };

  assert.equal(parseCreateCustomerInput({ ...valid, status: "inactive" }), null);
  assert.equal(parseCreateCustomerInput({ ...valid, customerNumber: "OLO-000001" }), null);
  assert.equal(parseCreateCustomerInput({ ...valid, email: "bad-email" }), null);
  assert.equal(parseCreateCustomerInput({ ...valid, fullName: " " }), null);
});

test("customer update input permits partial changes and explicit clearing", () => {
  assert.deepEqual(
    parseUpdateCustomerInput({
      email: "  NEW@Example.Test ",
      physicalAddress: null,
      status: "inactive",
    }),
    {
      email: "new@example.test",
      physicalAddress: null,
      status: "inactive",
    },
  );
  assert.equal(parseUpdateCustomerInput({}), null);
  assert.equal(
    parseUpdateCustomerInput({ email: "not-an-email", status: "disabled" }),
    null,
  );
});

test("staff customer access input requires exactly two valid IDs", () => {
  const staffUserId = "9e089ace-52e2-416b-b613-6d39e5d2d392";
  const customerId = "fa63fab1-cb5d-496e-872f-9b3775a6175f";

  assert.deepEqual(
    parseLinkStaffCustomerAccessInput({ staffUserId, customerId }),
    { staffUserId, customerId },
  );
  assert.equal(
    parseLinkStaffCustomerAccessInput({ staffUserId, customerId, extra: true }),
    null,
  );
  assert.equal(
    parseLinkStaffCustomerAccessInput({ staffUserId, customerId: "not-a-uuid" }),
    null,
  );
});
