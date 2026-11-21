import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canManageInvitations } from "@/lib/auth/policy";
import {
  accountSecurityEvents,
  emailOutbox,
  invitations,
  roles,
  userRoles,
} from "@/lib/db/schema";
import { getApplicationOrigin, hasValidCsrfHeaders } from "@/lib/auth/csrf";
import { errorResponse, successResponse } from "@/lib/auth/response";
import { getActiveSession } from "@/lib/auth/session";
import {
  isValidSessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-token";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
): Promise<NextResponse> {
  try {
    const applicationOrigin = getApplicationOrigin();

    if (!hasValidCsrfHeaders(request, applicationOrigin)) {
      return errorResponse(403, "CSRF_FAILED", "The request could not be verified.");
    }

    const { invitationId } = await context.params;

    if (!UUID_PATTERN.test(invitationId)) {
      return errorResponse(400, "VALIDATION_ERROR", "The invitation is invalid.");
    }

    const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;

    if (!isValidSessionToken(sessionToken)) {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const session = await getActiveSession(sessionToken);

    if (!session || session.user.accountType !== "staff") {
      return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const roleRows = await db
      .select({ roleKey: roles.roleKey })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, session.user.id));
    const authorized = canManageInvitations(
      "staff",
      roleRows.map((role) => role.roleKey),
    );

    if (!authorized) {
      return errorResponse(403, "FORBIDDEN", "You are not allowed to revoke invitations.");
    }

    const now = new Date();
    const result = await db.transaction(async (transaction) => {
      const [invitation] = await transaction
        .select({
          id: invitations.id,
          userId: invitations.userId,
          status: invitations.status,
        })
        .from(invitations)
        .where(eq(invitations.id, invitationId))
        .limit(1)
        .for("update");

      if (!invitation || invitation.status !== "pending") {
        return "not-found" as const;
      }

      await transaction
        .update(invitations)
        .set({ status: "revoked", revokedAt: now })
        .where(eq(invitations.id, invitation.id));

      await transaction
        .update(emailOutbox)
        .set({
          status: "failed",
          lastError: "Invitation was revoked before delivery.",
          updatedAt: now,
        })
        .where(
          and(
            eq(emailOutbox.idempotencyKey, `invitation:${invitation.id}`),
            eq(emailOutbox.status, "queued"),
          ),
        );

      await transaction.insert(accountSecurityEvents).values({
        userId: invitation.userId,
        eventType: "invitation_revoked",
        userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
        metadata: {
          invitationId: invitation.id,
          revokedBy: session.user.id,
        },
        requestId: randomUUID(),
      });

      return "revoked" as const;
    });

    if (result === "not-found") {
      return errorResponse(404, "NOT_FOUND", "The pending invitation was not found.");
    }

    return successResponse({ revoked: true });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    console.error(`[auth.invitation.revoke] Internal operation failed (${errorType}).`);
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.");
  }
}
