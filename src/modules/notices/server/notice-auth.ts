import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export {
  canBroadcastToOrganization,
  canManageNotices,
  NOTICE_MANAGER_ROLES,
} from "./notice-permissions";

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
