import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { permissions, rolePermissions, userRoles } from "@/lib/db/schema";

export const CUSTOMER_READ_PERMISSION = "customers.read";
export const CUSTOMER_MANAGE_PERMISSION = "customers.manage";
export const METER_READ_PERMISSION = "meters.read";
export const METER_MANAGE_PERMISSION = "meters.manage";

export async function userHasPermission(
  userId: string,
  permissionKey: string,
): Promise<boolean> {
  const [grant] = await db
    .select({ permissionId: permissions.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(permissions.permissionKey, permissionKey),
      ),
    )
    .limit(1);

  return grant !== undefined;
}
