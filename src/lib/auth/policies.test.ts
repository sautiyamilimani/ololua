import assert from "node:assert/strict";
import test from "node:test";
import {
  getLockoutDurationMs,
  getPasswordMinimumLength,
  getSessionPolicy,
  canChangeStaffAccountStatus,
  canManageStaffRoles,
  isLastActiveAdmin,
  canManageStaffAccounts,
  isRoleAllowedForAccountType,
} from "./policy";

test("login failures follow the confirmed staged lockout schedule", () => {
  assert.equal(getLockoutDurationMs(1), null);
  assert.equal(getLockoutDurationMs(2), null);
  assert.equal(getLockoutDurationMs(3), 60_000);
  assert.equal(getLockoutDurationMs(4), null);
  assert.equal(getLockoutDurationMs(5), 180_000);
  assert.equal(getLockoutDurationMs(6), 1_800_000);
  assert.equal(getLockoutDurationMs(7), 1_800_000);
});

test("session and password policies distinguish customer, staff, and administrators", () => {
  assert.deepEqual(getSessionPolicy("customer", []), {
    idleTimeoutMs: 30 * 24 * 60 * 60 * 1000,
    persistentCookie: true,
  });
  assert.deepEqual(getSessionPolicy("staff", ["meter_reader"]), {
    idleTimeoutMs: 12 * 60 * 60 * 1000,
    persistentCookie: true,
  });
  assert.deepEqual(getSessionPolicy("staff", ["admin"]), {
    idleTimeoutMs: 5 * 60 * 1000,
    persistentCookie: false,
  });
  assert.equal(getPasswordMinimumLength("customer", []), 8);
  assert.equal(getPasswordMinimumLength("staff", ["admin"]), 12);
});

test("invalid failure counts are rejected", () => {
  assert.throws(() => getLockoutDurationMs(0), RangeError);
  assert.throws(() => getLockoutDurationMs(1.5), RangeError);
});

test("customer and staff role boundaries are kept separate", () => {
  assert.equal(isRoleAllowedForAccountType("customer", "customer"), true);
  assert.equal(isRoleAllowedForAccountType("customer", "meter_reader"), false);
  assert.equal(isRoleAllowedForAccountType("staff", "admin"), true);
  assert.equal(isRoleAllowedForAccountType("staff", "customer"), false);
});

test("only staff administrators and superadministrators can manage staff accounts", () => {
  assert.equal(canManageStaffAccounts("staff", ["admin"]), true);
  assert.equal(canManageStaffAccounts("staff", ["superadmin"]), true);
  assert.equal(canManageStaffAccounts("staff", ["meter_reader"]), false);
  assert.equal(canManageStaffAccounts("customer", ["admin"]), false);
});

test("staff status changes follow admin and superadmin boundaries", () => {
  assert.equal(
    canChangeStaffAccountStatus("admin-1", ["admin"], "reader-1", ["meter_reader"]),
    true,
  );
  assert.equal(
    canChangeStaffAccountStatus("admin-1", ["admin"], "admin-2", ["admin"]),
    false,
  );
  assert.equal(
    canChangeStaffAccountStatus("admin-1", ["admin"], "superadmin-1", ["superadmin"]),
    false,
  );
  assert.equal(
    canChangeStaffAccountStatus("superadmin-1", ["superadmin"], "admin-1", ["admin"]),
    true,
  );
  assert.equal(
    canChangeStaffAccountStatus("superadmin-1", ["superadmin"], "reader-1", ["meter_reader"]),
    true,
  );
  assert.equal(
    canChangeStaffAccountStatus(
      "superadmin-1",
      ["superadmin"],
      "superadmin-2",
      ["superadmin"],
    ),
    false,
  );
  assert.equal(
    canChangeStaffAccountStatus("admin-1", ["admin"], "admin-1", ["admin"]),
    false,
  );
});

test("staff role changes follow admin and superadmin boundaries", () => {
  assert.equal(
    canManageStaffRoles("admin-1", ["admin"], "reader-1", ["meter_reader"]),
    true,
  );
  assert.equal(
    canManageStaffRoles("admin-1", ["admin"], "admin-2", ["admin"]),
    false,
  );
  assert.equal(
    canManageStaffRoles("admin-1", ["admin"], "admin-1", ["admin"]),
    false,
  );
  assert.equal(
    canManageStaffRoles(
      "superadmin-1",
      ["superadmin"],
      "admin-1",
      ["admin"],
    ),
    true,
  );
  assert.equal(
    canManageStaffRoles(
      "superadmin-1",
      ["superadmin"],
      "superadmin-1",
      ["superadmin"],
    ),
    false,
  );
  assert.equal(
    canManageStaffRoles(
      "superadmin-1",
      ["superadmin"],
      "superadmin-2",
      ["superadmin"],
    ),
    false,
  );
  assert.equal(
    canManageStaffRoles("reader-1", ["meter_reader"], "reader-2", ["meter_reader"]),
    false,
  );
});

test("the last active admin is identified for role and status safeguards", () => {
  assert.equal(isLastActiveAdmin("active", ["admin"], 1), true);
  assert.equal(isLastActiveAdmin("active", ["admin"], 2), false);
  assert.equal(isLastActiveAdmin("suspended", ["admin"], 1), false);
  assert.equal(isLastActiveAdmin("active", ["meter_reader"], 1), false);
});
