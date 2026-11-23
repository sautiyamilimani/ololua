import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canFinalizeCrossCustomerTransfer,
  creditTransferExpiresAt,
} from "./credit-transfer-approval-state";

test("cross-customer transfer expires 24 hours after creation", () => {
  const created = new Date("2026-11-23T01:00:00.000Z");
  assert.equal(
    creditTransferExpiresAt(created).toISOString(),
    "2026-11-24T01:00:00.000Z",
  );
});

test("final confirmation requires both approvals before expiry", () => {
  const now = new Date("2026-11-23T02:00:00.000Z");
  const expires = new Date("2026-11-24T02:00:00.000Z");
  assert.equal(
    canFinalizeCrossCustomerTransfer(now, now, expires, now),
    true,
  );
  assert.equal(
    canFinalizeCrossCustomerTransfer(null, now, expires, now),
    false,
  );
  assert.equal(
    canFinalizeCrossCustomerTransfer(now, now, now, now),
    false,
  );
});
