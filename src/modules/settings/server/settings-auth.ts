import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export async function getSettingsMember() {
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
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}

export const SETTINGS_ADMIN_ROLES = new Set(["MASTER", "ADMIN"]);
export const SETTINGS_MANAGER_ROLES = new Set(["MASTER", "ADMIN", "MANAGER"]);
