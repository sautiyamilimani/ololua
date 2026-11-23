import assert from "node:assert/strict";
import { test } from "node:test";
import { getReadingConsumption } from "./state";

test("reading consumption accepts zero and exact differences", () => {
  assert.equal(getReadingConsumption("0.000", "0.000"), "0.000");
  assert.equal(getReadingConsumption("12.500", "15.750"), "3.250");
});

test("reading consumption rejects decreasing readings", () => {
  assert.equal(getReadingConsumption("12.500", "12.499"), null);
});
