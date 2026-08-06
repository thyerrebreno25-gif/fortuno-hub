import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export async function getOperationMember() {
  const supabase = await createSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return prisma.organizationMember.findFirst({
    where: { userId: user.id }, orderBy: { createdAt: "asc" },
    select: { userId: true, organizationId: true, role: true, user: { select: { name: true, email: true } } },
  });
}
export const canManageOperations = (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role);
