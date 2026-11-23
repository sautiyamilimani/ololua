import { NextResponse } from "next/server";

type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "CURRENT_PASSWORD_INVALID"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ACCOUNT_SUSPENDED"
  | "INVITATION_INVALID"
  | "INVITATION_CONFLICT"
  | "ACCOUNT_STATUS_CONFLICT"
  | "STAFF_ROLE_CHANGE_CONFLICT"
  | "LAST_ACTIVE_ADMIN"
  | "RESET_TOKEN_INVALID"
  | "OTP_INVALID"
  | "EMAIL_DELIVERY_UNAVAILABLE"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "CUSTOMER_CONFLICT"
  | "METER_CONFLICT"
  | "CUSTOMER_METER_ACCOUNT_CONFLICT"
  | "CSRF_FAILED"
  | "INTERNAL_ERROR";

export function successResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
