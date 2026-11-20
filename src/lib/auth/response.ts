import { NextResponse } from "next/server";

type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "INVITATION_INVALID"
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
