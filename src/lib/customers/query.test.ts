import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CUSTOMER_PAGE_SIZE,
  MAX_CUSTOMER_OFFSET,
  MAX_CUSTOMER_PAGE_SIZE,
  parseCustomerPage,
} from "./query";

test("customer page query uses defaults and accepts bounded values", () => {
  assert.deepEqual(parseCustomerPage(new URLSearchParams()), {
    limit: DEFAULT_CUSTOMER_PAGE_SIZE,
    offset: 0,
  });
  assert.deepEqual(
    parseCustomerPage(new URLSearchParams("limit=100&offset=250")),
    { limit: MAX_CUSTOMER_PAGE_SIZE, offset: 250 },
  );
  assert.deepEqual(
    parseCustomerPage(
      new URLSearchParams(`limit=1&offset=${MAX_CUSTOMER_OFFSET}`),
    ),
    { limit: 1, offset: MAX_CUSTOMER_OFFSET },
  );
});

test("customer page query rejects invalid, unbounded, and duplicate values", () => {
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.5",
    "limit=-1",
    "limit=abc",
    "offset=-1",
    "offset=10001",
    "limit=10&limit=20",
    "offset=1&offset=2",
  ]) {
    assert.equal(parseCustomerPage(new URLSearchParams(query)), null, query);
  }
});
