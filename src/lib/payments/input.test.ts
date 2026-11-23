import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRecordPaymentInput } from "./input";

test("payment input normalizes values and permits edited allocations", () => {
  assert.deepEqual(
    parseRecordPaymentInput({
      customerMeterAccountId: "550e8400-e29b-41d4-a716-446655440000",
      amount: "625.5",
      paymentMethod: "mpesa",
      externalReference: " MPESA123 ",
      payerPhone: null,
      notes: "  Counter payment ",
      allocations: [{
        billingId: "550e8400-e29b-41d4-a716-446655440001",
        amount: "625.50",
      }],
    }),
    {
      customerMeterAccountId: "550e8400-e29b-41d4-a716-446655440000",
      amount: "625.50",
      paymentMethod: "mpesa",
      externalReference: "MPESA123",
      payerPhone: null,
      notes: "Counter payment",
      allocations: [{
        billingId: "550e8400-e29b-41d4-a716-446655440001",
        amount: "625.50",
      }],
    },
  );
});

test("payment input rejects invalid money, method, and server fields", () => {
  const valid = {
    customerMeterAccountId: "550e8400-e29b-41d4-a716-446655440000",
    amount: "10.00",
    paymentMethod: "cash",
  };
  assert.equal(parseRecordPaymentInput({ ...valid, amount: "0.00" }), null);
  assert.equal(parseRecordPaymentInput({ ...valid, paymentMethod: "cheque" }), null);
  assert.equal(parseRecordPaymentInput({ ...valid, receiptNumber: "OLO-RCP-000001" }), null);
  assert.equal(parseRecordPaymentInput({ ...valid, allocations: "invalid" }), null);
});
