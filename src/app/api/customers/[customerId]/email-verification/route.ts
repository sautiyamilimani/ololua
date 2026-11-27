import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { getClientIpAddress } from "@/lib/auth/client-ip";
import {
  parseCustomerEmailVerificationInput,
} from "@/lib/customers/input";
import {
  requestCustomerEmailVerification,
  verifyCustomerEmail,
} from "@/lib/customers/management";
import { readJsonBody } from "@/lib/auth/request";
import { errorResponse, successResponse } from "@/lib/auth/response";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/lib/auth/session-token";
import { isEmailOutboxSendingEnabled } from "@/lib/email/outbox-config";
import { sendPendingOutboxEmails } from "@/lib/email/outbox-delivery";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function logFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(
    `[customers.email-verification] Internal operation failed (${errorType}).`,
  );
}

function logDeliveryFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  console.error(
    `[customers.email-verification] Deferred email delivery failed (${errorType}).`,
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
): Promise<NextResponse> {
  try {
    if (!hasValidCsrfHeaders(request, getApplicationOrigin())) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const { customerId } = await context.params;
    if (!UUID_PATTERN.test(customerId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
    if (contentType?.toLowerCase() !== "application/json") {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }
    const body = await readJsonBody(request);
    const input = body.ok
      ? parseCustomerEmailVerificationInput(body.value)
      : null;
    if (!input) {
      return errorResponse(400, "VALIDATION_ERROR", "The request is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const result =
      input.action === "request"
        ? await requestCustomerEmailVerification(
            sessionToken,
            customerId,
            getClientIpAddress(request),
          )
        : await verifyCustomerEmail(
            sessionToken,
            customerId,
            input.code,
            getClientIpAddress(request),
          );

    if (result.kind === "unauthenticated") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    if (result.kind === "forbidden") {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to manage customers.");
    }
    if (result.kind === "not-found") {
      return errorResponse(404, "NOT_FOUND", "The customer was not found.");
    }
    if (result.kind === "invalid") {
      return errorResponse(400, "OTP_INVALID", "The verification code is invalid or expired.");
    }
    if (result.kind === "rate-limited") {
      return errorResponse(429, "RATE_LIMITED", "Too many attempts. Try again later.");
    }

    if (result.kind === "queued" && isEmailOutboxSendingEnabled()) {
      after(async () => {
        try {
          const delivery = await sendPendingOutboxEmails(
            "customer_email_verification",
          );
          if (delivery.retried > 0 || delivery.failed > 0) {
            console.error(
              `[customers.email-verification] Email delivery needs retry or failed (retried=${delivery.retried}, failed=${delivery.failed}).`,
            );
          }
        } catch (error) {
          logDeliveryFailure(error);
        }
      });
    }

    const response =
      result.kind === "queued"
        ? successResponse(
            {
              emailQueued: true,
              emailSent: false,
              emailSendingEnabled: isEmailOutboxSendingEnabled(),
            },
            202,
          )
        : result.kind === "verified"
          ? successResponse({ emailVerified: true })
          : successResponse({ emailVerified: true, alreadyVerified: true });
    setSessionCookie(response, sessionToken, result.sessionPolicy);
    return response;
  } catch (error) {
    logFailure(error);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
