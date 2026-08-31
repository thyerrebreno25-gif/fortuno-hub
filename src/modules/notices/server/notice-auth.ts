import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const NOTICE_MANAGER_ROLES = new Set(["MASTER", "ADMIN", "MANAGER"]);

export async function getNoticeMember() {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      role: true,
      isTeamLeader: true,
      teamLeaderId: true,
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });
}

export function canManageNotices(member: {
  role: string;
  isTeamLeader: boolean;
}) {
  return NOTICE_MANAGER_ROLES.has(member.role) || member.isTeamLeader;
}

export function canBroadcastToOrganization(member: { role: string }) {
  return NOTICE_MANAGER_ROLES.has(member.role);
}
