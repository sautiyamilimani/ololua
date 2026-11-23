import assert from "node:assert/strict";
import { test } from "node:test";
import { creditEntryIdempotency } from "./credit-transfer-state";

test("credit transfer ledger entries use stable direction-specific idempotency keys", () => {
  const transferId = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(
    creditEntryIdempotency(transferId, "OUT"),
    `credit-transfer:${transferId}:OUT`,
  );
  assert.equal(
    creditEntryIdempotency(transferId, "IN"),
    `credit-transfer:${transferId}:IN`,
  );
});
