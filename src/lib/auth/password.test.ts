import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from "./password";

test("password hashes verify only the password used to create them", async () => {
  const password = "correct horse battery staple";
  const hash = await hashPassword(password);

  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("incorrect password", hash), false);
  assert.notEqual(await hashPassword(password), hash);
});

test("unsupported and malformed password hashes fail closed", async () => {
  assert.equal(await verifyPassword("any password", "unsupported$hash"), false);
  assert.equal(await verifyPasswordOrDummy("any password", "unsupported$hash"), false);
  assert.equal(await verifyPasswordOrDummy("any password", null), false);
});
