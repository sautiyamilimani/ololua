import assert from "node:assert/strict";
import { test } from "node:test";
import { getExpiredTransferStatus } from "./credit-transfer-lifecycle";

test("only overdue pending transfers expire", () => {
  const now = new Date("2026-11-24T01:00:00.000Z");
  assert.equal(
    getExpiredTransferStatus(
      "PENDING",
      new Date("2026-11-24T00:59:59.000Z"),
      now,
    ),
    "EXPIRED",
  );
  assert.equal(
    getExpiredTransferStatus(
      "CONFIRMED",
      new Date("2026-11-23T00:00:00.000Z"),
      now,
    ),
    null,
  );
  assert.equal(
    getExpiredTransferStatus("PENDING", null, now),
    null,
  );
});
