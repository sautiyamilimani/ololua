import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCreateMeterInput, parseUpdateMeterInput } from "./input";

test("meter create input normalizes serial number and notes", () => {
  assert.deepEqual(
    parseCreateMeterInput({
      serialNumber: "  METER-001 ",
      notes: "  Main property ",
    }),
    { serialNumber: "METER-001", notes: "Main property" },
  );
});

test("meter input rejects invalid fields and values", () => {
  assert.equal(parseCreateMeterInput({ serialNumber: " ", notes: null }), null);
  assert.equal(parseCreateMeterInput({ serialNumber: "M-1", status: "ACTIVE" }), null);
  assert.equal(parseUpdateMeterInput({}), null);
  assert.equal(parseUpdateMeterInput({ status: "BROKEN" }), null);
  assert.equal(parseUpdateMeterInput({ notes: 123 }), null);
});
