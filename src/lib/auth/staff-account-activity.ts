import { isRecord } from "./request";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/u;

export type StaffAccountActivitySource = {
  id: string;
  eventType: string;
  metadata: unknown;
  createdAt: Date;
};

export type StaffAccountActivityItem = {
  id: string;
  action: string;
  details: string;
  actorId: string | null;
  createdAt: Date;
};

function getActorId(metadata: Record<string, unknown>): string | null {
  const value = metadata.changedBy;
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function getStatusLabel(value: unknown): string | null {
  if (value === "active") {
    return "Active";
  }
  if (value === "suspended") {
    return "Suspended";
  }

  return null;
}

function getRoleLabels(
  value: unknown,
  roleNameByKey: ReadonlyMap<string, string>,
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const roleKeys: string[] = [];
  for (const roleKey of value) {
    if (typeof roleKey !== "string" || !ROLE_KEY_PATTERN.test(roleKey)) {
      return null;
    }

    roleKeys.push(roleKey);
  }

  return roleKeys
    .map(
      (roleKey) =>
        roleNameByKey.get(roleKey) ?? roleKey.replace(/_/gu, " "),
    )
    .sort((left, right) => left.localeCompare(right, "en"));
}

function formatRoleLabels(roleLabels: string[]): string {
  return roleLabels.length > 0 ? roleLabels.join(", ") : "No roles";
}

export function formatStaffAccountActivity(
  events: readonly StaffAccountActivitySource[],
  roleNameByKey: ReadonlyMap<string, string>,
): StaffAccountActivityItem[] {
  const items: StaffAccountActivityItem[] = [];

  for (const event of events) {
    const metadata = isRecord(event.metadata) ? event.metadata : {};
    const actorId = getActorId(metadata);

    if (
      event.eventType === "staff_account_suspended" ||
      event.eventType === "staff_account_reactivated"
    ) {
      const previousStatus = getStatusLabel(metadata.previousStatus);
      const newStatus = getStatusLabel(metadata.newStatus);

      items.push({
        id: event.id,
        action:
          event.eventType === "staff_account_suspended"
            ? "Account suspended"
            : "Account reactivated",
        details:
          previousStatus && newStatus
            ? `Status changed from ${previousStatus} to ${newStatus}.`
            : "Status change details are unavailable.",
        actorId,
        createdAt: event.createdAt,
      });
      continue;
    }

    if (event.eventType === "staff_roles_changed") {
      const previousRoles = getRoleLabels(
        metadata.previousRoleKeys,
        roleNameByKey,
      );
      const newRoles = getRoleLabels(metadata.newRoleKeys, roleNameByKey);

      items.push({
        id: event.id,
        action: "Roles updated",
        details:
          previousRoles && newRoles
            ? `Roles changed from ${formatRoleLabels(previousRoles)} to ${formatRoleLabels(newRoles)}.`
            : "Role change details are unavailable.",
        actorId,
        createdAt: event.createdAt,
      });
    }
  }

  return items;
}
