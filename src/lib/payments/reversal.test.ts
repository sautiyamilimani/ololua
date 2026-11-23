import assert from "node:assert/strict";
import { test } from "node:test";
import { getBillStatusAfterReversal, getReversalEffect } from "./reversal-state";

test("payment reversal separates restored credit from reversed allocations", () => {
  assert.deepEqual(
    getReversalEffect("250.00", "200.00"),
    {
      reversedAllocationAmount: "200.00",
      restoredCreditAmount: "50.00",
    },
  );
  assert.deepEqual(getReversalEffect("250.00", "300.00"), null);
});

test("invoice status is recalculated after allocation reversals", () => {
  assert.equal(getBillStatusAfterReversal("100.00", "100.00"), "PAID");
  assert.equal(getBillStatusAfterReversal("100.00", "40.00"), "PARTIALLY_PAID");
  assert.equal(getBillStatusAfterReversal("100.00", "0.00"), "UNPAID");
});
