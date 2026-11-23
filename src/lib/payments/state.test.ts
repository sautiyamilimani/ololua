import assert from "node:assert/strict";
import { test } from "node:test";
import { centsToMoney, moneyToCents } from "./state";

test("payment money conversion is exact", () => {
  assert.equal(moneyToCents("625.00"), BigInt(62500));
  assert.equal(centsToMoney(BigInt(62500)), "625.00");
  assert.equal(centsToMoney(BigInt(0)), "0.00");
});
