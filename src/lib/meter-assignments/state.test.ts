import assert from "node:assert/strict";
import { test } from "node:test";
import { isMeterAssignmentActionValid } from "./state";

test("new assignments require an active meter and active account", () => {
  assert.equal(isMeterAssignmentActionValid("ACTIVE", "ACTIVE", "ASSIGN"), true);
  assert.equal(isMeterAssignmentActionValid("DEFECTIVE", "ACTIVE", "ASSIGN"), false);
  assert.equal(isMeterAssignmentActionValid("ACTIVE", "SUSPENDED", "ASSIGN"), false);
  assert.equal(isMeterAssignmentActionValid("ACTIVE", "CLOSED", "ASSIGN"), false);
});

test("removal is a valid action independent of current account or meter state", () => {
  assert.equal(isMeterAssignmentActionValid("DEFECTIVE", "CLOSED", "REMOVE"), true);
  assert.equal(isMeterAssignmentActionValid("ACTIVE", "ACTIVE", "REMOVE"), true);
});
