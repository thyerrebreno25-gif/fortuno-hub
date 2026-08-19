import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export async function getAuditMember() {
  const supabase = await createSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      role: true,
      isTeamLeader: true,
      teamLeaderId: true,
      teamMembers: { select: { userId: true } },
      user: { select: { name: true, email: true } },
    },
  });
}

export function isAuditAdministrator(role: string) {
  return ["MASTER", "ADMIN"].includes(role);
}

export function canSuperviseAudit(role: string, isTeamLeader = false) {
  return isAuditAdministrator(role) || role === "MANAGER" || isTeamLeader;
}
