import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getRolePermissions } from "@/modules/permissions/permissions";

export async function getOperationMember() {
  const supabase = await createSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const member = await prisma.organizationMember.findFirst({
    where: { userId: user.id }, orderBy: { createdAt: "asc" },
    select: { userId: true, organizationId: true, role: true, user: { select: { name: true, email: true } } },
  });
  if (!member || member.role === "CLIENT") return null;
  const permissions = await getRolePermissions(member.organizationId, member.role);
  return permissions.OPERATIONS.canView ? member : null;
}
export const canManageOperations = (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role);
