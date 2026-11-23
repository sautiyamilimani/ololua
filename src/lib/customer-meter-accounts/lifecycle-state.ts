export type CustomerMeterAccountStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";
export type CustomerMeterAccountTransition =
  | "SUSPEND"
  | "REACTIVATE"
  | "CLOSE";

export function getCustomerMeterAccountStatusAfterTransition(
  currentStatus: CustomerMeterAccountStatus,
  transition: CustomerMeterAccountTransition,
): CustomerMeterAccountStatus | null {
  if (transition === "SUSPEND") {
    return currentStatus === "ACTIVE" ? "SUSPENDED" : null;
  }
  if (transition === "REACTIVATE") {
    return currentStatus === "SUSPENDED" || currentStatus === "CLOSED"
      ? "ACTIVE"
      : null;
  }
  if (transition === "CLOSE") {
    return currentStatus === "ACTIVE" || currentStatus === "SUSPENDED"
      ? "CLOSED"
      : null;
  }
  return null;
}
