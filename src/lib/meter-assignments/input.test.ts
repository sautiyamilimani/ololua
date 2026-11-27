import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseAssignMeterInput,
  parseUpdateMeterAssignmentLocationInput,
} from "./input";

test("meter assignment input accepts and normalizes its optional location", () => {
  assert.deepEqual(
    parseAssignMeterInput({
      meterId: "550e8400-e29b-41d4-a716-446655440000",
      accountId: "550e8400-e29b-41d4-a716-446655440001",
      locationDescription: "  Outside the main gate ",
    }),
    {
      meterId: "550e8400-e29b-41d4-a716-446655440000",
      accountId: "550e8400-e29b-41d4-a716-446655440001",
      locationDescription: "Outside the main gate",
    },
  );
});

test("meter assignment input rejects invalid locations and unknown fields", () => {
  const valid = {
    meterId: "550e8400-e29b-41d4-a716-446655440000",
    accountId: "550e8400-e29b-41d4-a716-446655440001",
  };

  assert.equal(parseAssignMeterInput(valid)?.locationDescription, null);
  assert.equal(
    parseAssignMeterInput({ ...valid, propertyAddress: "Plot 12" }),
    null,
  );
  assert.equal(
    parseAssignMeterInput({ ...valid, locationDescription: " " }),
    null,
  );
});

test("meter assignment location updates allow clearing but reject missing fields", () => {
  assert.deepEqual(
    parseUpdateMeterAssignmentLocationInput({ locationDescription: null }),
    { locationDescription: null },
  );
  assert.deepEqual(
    parseUpdateMeterAssignmentLocationInput({
      locationDescription: "Water tank",
    }),
    { locationDescription: "Water tank" },
  );
  assert.equal(
    parseUpdateMeterAssignmentLocationInput({
      locationDescription: "x".repeat(500),
    })?.locationDescription?.length,
    500,
  );
  assert.equal(
    parseUpdateMeterAssignmentLocationInput({
      locationDescription: "x".repeat(501),
    }),
    null,
  );
  assert.equal(parseUpdateMeterAssignmentLocationInput({}), null);
  assert.equal(
    parseUpdateMeterAssignmentLocationInput({
      locationDescription: "Water tank",
      accountId: "not-allowed",
    }),
    null,
  );
});
