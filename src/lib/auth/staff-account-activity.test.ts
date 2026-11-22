import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStaffAccountActivity } from "./staff-account-activity";

const actorId = "9c2a8725-1247-4a0f-8fd1-9fa0f6fa87b1";
const createdAt = new Date("2026-11-22T01:00:00.000Z");
const roleNameByKey = new Map([
  ["admin", "Administrator"],
  ["meter_reader", "Meter Reader"],
]);

test("staff activity formats only approved status and role event fields", () => {
  const items = formatStaffAccountActivity(
    [
      {
        id: "suspended-event",
        eventType: "staff_account_suspended",
        metadata: {
          changedBy: actorId,
          previousStatus: "active",
          newStatus: "suspended",
          token: "must-not-be-shown",
        },
        createdAt,
      },
      {
        id: "roles-event",
        eventType: "staff_roles_changed",
        metadata: {
          changedBy: actorId,
          previousRoleKeys: ["meter_reader"],
          newRoleKeys: ["admin", "meter_reader"],
        },
        createdAt,
      },
    ],
    roleNameByKey,
  );

  assert.deepEqual(
    items.map((item) => ({
      action: item.action,
      details: item.details,
      actorId: item.actorId,
    })),
    [
      {
        action: "Account suspended",
        details: "Status changed from Active to Suspended.",
        actorId,
      },
      {
        action: "Roles updated",
        details: "Roles changed from Meter Reader to Administrator, Meter Reader.",
        actorId,
      },
    ],
  );
  assert.equal(JSON.stringify(items).includes("must-not-be-shown"), false);
});

test("staff activity ignores unrelated events and sanitizes malformed metadata", () => {
  const items = formatStaffAccountActivity(
    [
      {
        id: "login-event",
        eventType: "login_failed",
        metadata: { changedBy: actorId, secret: "not-an-account-change" },
        createdAt,
      },
      {
        id: "malformed-event",
        eventType: "staff_roles_changed",
        metadata: {
          changedBy: "not-a-uuid",
          previousRoleKeys: ["admin", 12],
          newRoleKeys: ["meter_reader"],
          secret: "must-not-be-shown",
        },
        createdAt,
      },
      {
        id: "missing-metadata-event",
        eventType: "staff_account_reactivated",
        metadata: null,
        createdAt,
      },
    ],
    roleNameByKey,
  );

  assert.equal(items.length, 2);
  assert.equal(items[0]?.actorId, null);
  assert.equal(items[0]?.details, "Role change details are unavailable.");
  assert.equal(items[1]?.details, "Status change details are unavailable.");
  assert.equal(JSON.stringify(items).includes("must-not-be-shown"), false);
  assert.equal(JSON.stringify(items).includes("not-an-account-change"), false);
});
