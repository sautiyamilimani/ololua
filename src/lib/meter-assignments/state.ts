export type MeterAssignmentAction = "ASSIGN" | "REMOVE";

export function isMeterAssignmentActionValid(
  meterStatus: "ACTIVE" | "DEFECTIVE",
  accountStatus: "ACTIVE" | "SUSPENDED" | "CLOSED",
  action: MeterAssignmentAction,
): boolean {
  if (action === "ASSIGN") {
    return meterStatus === "ACTIVE" && accountStatus === "ACTIVE";
  }
  return true;
}
