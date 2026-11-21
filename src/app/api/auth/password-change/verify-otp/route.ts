import { NextResponse } from "next/server";
import { getClientIpAddress } from "@/lib/auth/client-ip";
import {
  attachRenewedSessionCookie,
  getRenewedRequestSession,
} from "@/lib/auth/active-request-session";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { verifyPasswordChangeOtp } from "@/lib/auth/password-change";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.password-change.verify-otp] Operation failed (${errorType}).`);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();

    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const bodyResult = await readJsonBody(request);

    if (!bodyResult.ok || !isRecord(bodyResult.value)) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const otp =
      typeof bodyResult.value.otp === "string" ? bodyResult.value.otp : "";

    if (!/^\d{6}$/u.test(otp)) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const session = await getRenewedRequestSession();

    if (!session) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result = await verifyPasswordChangeOtp(
      session.user.id,
      otp,
      getClientIpAddress(request),
      request.headers.get("user-agent"),
    );

    if (result.kind === "rate-limited") {
      const response = NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many attempts. Request a new code or try again later.",
          },
        },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(result.retryAfterSeconds),
          },
        },
      );

      return attachRenewedSessionCookie(response, session);
    }

    if (result.kind === "invalid") {
      return attachRenewedSessionCookie(
        errorResponse(
          400,
          "OTP_INVALID",
          "The code is invalid, expired, or can no longer be used.",
        ),
        session,
      );
    }

    return attachRenewedSessionCookie(
      successResponse({
        codeVerified: true,
        verificationToken: result.verificationToken,
      }),
      session,
    );
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
