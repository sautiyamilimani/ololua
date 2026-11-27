import { cookies } from "next/headers";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getActiveSession } from "@/lib/auth/session";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { parsePartialSettingsUpdateInput } from "@/lib/settings/input";
import { updateSettings } from "@/lib/settings/management";

const settingKeys = [
  "invoice_due_days",
  "sms_payment_reminder_template",
  "sms_payment_confirmation_template",
  "sms_new_bill_template",
  "sms_announcement_template",
] as const;

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!isValidSessionToken(sessionToken)) {
    return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  const session = await getActiveSession(sessionToken);
  if (
    !session ||
    session.user.accountType !== "staff" ||
    !session.canManageStaffAccounts
  ) {
    return session
      ? errorResponse(403, "FORBIDDEN", "You are not allowed to manage settings.")
      : errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
  }

  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...settingKeys]));
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return successResponse({
    invoiceDueDays: Number(values.get("invoice_due_days") ?? "14"),
    paymentReminderTemplate:
      values.get("sms_payment_reminder_template") ?? "",
    paymentConfirmationTemplate:
      values.get("sms_payment_confirmation_template") ?? "",
    newBillTemplate:
      values.get("sms_new_bill_template") ?? "",
    announcementTemplate:
      values.get("sms_announcement_template") ?? "",
  });
}

export async function PATCH(request: Request) {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }
    if (
      request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json"
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "The settings request is invalid.");
    }
    const body = await readJsonBody(request);
    if (!body.ok) {
      return errorResponse(400, "VALIDATION_ERROR", "The settings request is invalid.");
    }
    const input = parsePartialSettingsUpdateInput(body.value);
    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "Enter valid settings values.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    const result = await updateSettings(sessionToken, input);
    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to manage settings.");
    }
    if (result.kind !== "success") {
      throw new Error("Settings update returned an unexpected result.");
    }

    const response = successResponse({ updatedAt: result.updatedAt.toISOString() });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[admin.settings] Internal operation failed (${errorType}).`);
    return errorResponse(500, "INTERNAL_ERROR", "The settings could not be updated.");
  }
}
