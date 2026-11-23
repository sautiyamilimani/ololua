import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCalendarDays,
  calculateBillingAmount,
  formatUtcDate,
} from "./state";

test("billing amount uses exact consumption and tariff-rate arithmetic", () => {
  assert.equal(calculateBillingAmount("12.500", "50.00"), "625.00");
  assert.equal(calculateBillingAmount("0.000", "50.00"), "0.00");
  assert.equal(calculateBillingAmount("1.001", "0.50"), "0.50");
});

test("invoice due date adds UTC calendar days", () => {
  const issuedAt = new Date("2026-11-22T23:30:00.000Z");
  assert.equal(formatUtcDate(addCalendarDays(issuedAt, 30)), "2026-12-22");
});
