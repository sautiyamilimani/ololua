import { after, NextResponse } from "next/server";
import { getClientIpAddress } from "@/lib/auth/client-ip";
import {
  attachRenewedSessionCookie,
  getRenewedRequestSession,
} from "@/lib/auth/active-request-session";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { requestPasswordChangeOtp } from "@/lib/auth/password-change";
import { isRecord, readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import {
  assertEmailOutboxSendingEnabled,
  EmailOutboxConfigurationError,
} from "@/lib/email/outbox-config";
import { sendPendingOutboxEmails } from "@/lib/email/outbox-delivery";

function logUnexpectedFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(`[auth.password-change.request-otp] Operation failed (${errorType}).`);
}

function logEmailDeliveryFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(
    `[auth.password-change.request-otp] Deferred email delivery failed (${errorType}).`,
  );
}

function logEmailDeliveryResult(result: {
  retried: number;
  failed: number;
}): void {
  if (result.retried > 0 || result.failed > 0) {
    console.error(
      `[auth.password-change.request-otp] Email delivery needs retry or failed (retried=${result.retried}, failed=${result.failed}).`,
    );
  }
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

    const currentPassword =
      typeof bodyResult.value.currentPassword === "string"
        ? bodyResult.value.currentPassword
        : "";

    if (currentPassword.length === 0) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const session = await getRenewedRequestSession();

    if (!session) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    try {
      assertEmailOutboxSendingEnabled();
    } catch (error) {
      if (error instanceof EmailOutboxConfigurationError) {
        return attachRenewedSessionCookie(
          errorResponse(
            503,
            "EMAIL_DELIVERY_UNAVAILABLE",
            "Email delivery is not available. Please try again later.",
          ),
          session,
        );
      }

      throw error;
    }

    const result = await requestPasswordChangeOtp(
      session.user.id,
      currentPassword,
      getClientIpAddress(request),
      request.headers.get("user-agent"),
    );

    if (result.kind === "rate-limited") {
      const response = NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Try again later.",
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

    if (result.kind === "invalid-current-password") {
      return attachRenewedSessionCookie(
        errorResponse(
          401,
          "CURRENT_PASSWORD_INVALID",
          "The current password could not be verified.",
        ),
        session,
      );
    }

    after(async () => {
      try {
        const delivery = await sendPendingOutboxEmails("password_change_otp");
        logEmailDeliveryResult(delivery);
      } catch (error) {
        logEmailDeliveryFailure(error);
      }
    });

    return attachRenewedSessionCookie(
      successResponse({ codeRequested: true }, 202),
      session,
    );
  } catch (error) {
    logUnexpectedFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
