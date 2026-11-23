import assert from "node:assert/strict";
import { test } from "node:test";
import { getCustomerMeterAccountStatusAfterTransition } from "./lifecycle-state";

test("account lifecycle allows suspend, reactivate, close, and reopen", () => {
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("ACTIVE", "SUSPEND"),
    "SUSPENDED",
  );
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("SUSPENDED", "REACTIVATE"),
    "ACTIVE",
  );
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("ACTIVE", "CLOSE"),
    "CLOSED",
  );
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("SUSPENDED", "CLOSE"),
    "CLOSED",
  );
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("CLOSED", "REACTIVATE"),
    "ACTIVE",
  );
});

test("account lifecycle rejects invalid transitions", () => {
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("SUSPENDED", "SUSPEND"),
    null,
  );
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("ACTIVE", "REACTIVATE"),
    null,
  );
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("CLOSED", "SUSPEND"),
    null,
  );
  assert.equal(
    getCustomerMeterAccountStatusAfterTransition("CLOSED", "CLOSE"),
    null,
  );
});
