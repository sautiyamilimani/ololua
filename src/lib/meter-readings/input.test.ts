import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSubmitMeterReadingInput } from "./input";

test("meter reading input normalizes numeric and text values", () => {
  const parsed = parseSubmitMeterReadingInput({
    meterAssignmentId: "550e8400-e29b-41d4-a716-446655440000",
    readingAt: "2026-11-22T10:00:00.000Z",
    currentReading: "12.5",
    idempotencyKey: " reading-001 ",
    backdatedApprovalReason: null,
    notes: "  Normal reading ",
  });

  assert.ok(parsed);
  assert.equal(parsed.currentReading, "12.500");
  assert.equal(parsed.idempotencyKey, "reading-001");
  assert.equal(parsed.notes, "Normal reading");
});

test("meter reading input rejects malformed values and unknown fields", () => {
  const valid = {
    meterAssignmentId: "550e8400-e29b-41d4-a716-446655440000",
    readingAt: "2026-11-22T10:00:00.000Z",
    currentReading: "12.500",
    idempotencyKey: "reading-001",
  };
  assert.equal(parseSubmitMeterReadingInput({ ...valid, currentReading: "-1" }), null);
  assert.equal(parseSubmitMeterReadingInput({ ...valid, currentReading: "1000000000" }), null);
  assert.equal(parseSubmitMeterReadingInput({ ...valid, meterAssignmentId: "bad" }), null);
  assert.equal(parseSubmitMeterReadingInput({ ...valid, accountId: "server-controlled" }), null);
});
