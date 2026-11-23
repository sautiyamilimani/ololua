import assert from "node:assert/strict";
import { test } from "node:test";
import { tariffPeriodsOverlap } from "./state";

test("tariff periods use half-open timestamp boundaries", () => {
  const boundary = new Date("2026-02-01T00:00:00.000Z");
  assert.equal(
    tariffPeriodsOverlap(
      new Date("2026-01-01T00:00:00.000Z"),
      boundary,
      boundary,
      null,
    ),
    false,
  );
  assert.equal(
    tariffPeriodsOverlap(
      new Date("2026-01-01T00:00:00.000Z"),
      null,
      boundary,
      null,
    ),
    true,
  );
});
