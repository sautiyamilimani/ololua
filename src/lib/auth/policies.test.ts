import assert from "node:assert/strict";
import test from "node:test";
import { getLockoutDurationMs, getPasswordMinimumLength, getSessionPolicy } from "./policy";

test("login failures follow the confirmed staged lockout schedule", () => {
  assert.equal(getLockoutDurationMs(1), null);
  assert.equal(getLockoutDurationMs(2), null);
  assert.equal(getLockoutDurationMs(3), 60_000);
  assert.equal(getLockoutDurationMs(4), null);
  assert.equal(getLockoutDurationMs(5), 180_000);
  assert.equal(getLockoutDurationMs(6), 1_800_000);
  assert.equal(getLockoutDurationMs(7), 1_800_000);
});

test("session and password policies distinguish customer, staff, and administrators", () => {
  assert.deepEqual(getSessionPolicy("customer", []), {
    idleTimeoutMs: 30 * 24 * 60 * 60 * 1000,
    persistentCookie: true,
  });
  assert.deepEqual(getSessionPolicy("staff", ["meter_reader"]), {
    idleTimeoutMs: 12 * 60 * 60 * 1000,
    persistentCookie: true,
  });
  assert.deepEqual(getSessionPolicy("staff", ["admin"]), {
    idleTimeoutMs: 5 * 60 * 1000,
    persistentCookie: false,
  });
  assert.equal(getPasswordMinimumLength("customer", []), 8);
  assert.equal(getPasswordMinimumLength("staff", ["admin"]), 12);
});

test("invalid failure counts are rejected", () => {
  assert.throws(() => getLockoutDurationMs(0), RangeError);
  assert.throws(() => getLockoutDurationMs(1.5), RangeError);
});
