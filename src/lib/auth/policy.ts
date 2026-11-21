export type AccountType = "staff" | "customer";

export type SessionPolicy = {
  idleTimeoutMs: number;
  persistentCookie: boolean;
};

export function isAccountType(value: string): value is AccountType {
  return value === "staff" || value === "customer";
}

export function isRoleAllowedForAccountType(
  accountType: AccountType,
  roleKey: string,
): boolean {
  return accountType === "customer"
    ? roleKey === "customer"
    : roleKey !== "customer";
}

export function canManageInvitations(
  accountType: AccountType,
  roleKeys: readonly string[],
): boolean {
  return (
    accountType === "staff" &&
    roleKeys.some((roleKey) => roleKey === "admin" || roleKey === "superadmin")
  );
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function getLockoutDurationMs(failedLoginCount: number): number | null {
  if (!Number.isSafeInteger(failedLoginCount) || failedLoginCount < 1) {
    throw new RangeError("failedLoginCount must be a positive safe integer.");
  }

  if (failedLoginCount === 3) {
    return MINUTE;
  }

  if (failedLoginCount === 5) {
    return 3 * MINUTE;
  }

  if (failedLoginCount >= 6) {
    return 30 * MINUTE;
  }

  return null;
}

export function getSessionPolicy(
  accountType: AccountType,
  roleKeys: readonly string[],
): SessionPolicy {
  if (accountType === "customer") {
    return { idleTimeoutMs: 30 * DAY, persistentCookie: true };
  }

  const isAdmin = roleKeys.some((roleKey) =>
    roleKey === "admin" || roleKey === "superadmin",
  );

  return isAdmin
    ? { idleTimeoutMs: 5 * MINUTE, persistentCookie: false }
    : { idleTimeoutMs: 12 * HOUR, persistentCookie: true };
}

export function getPasswordMinimumLength(
  accountType: AccountType,
  roleKeys: readonly string[],
): number {
  if (
    accountType === "staff" &&
    roleKeys.some((roleKey) => roleKey === "admin" || roleKey === "superadmin")
  ) {
    return 12;
  }

  return 8;
}
