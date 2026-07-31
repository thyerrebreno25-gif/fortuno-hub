import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export async function getOnboardingMember() {
  const supabase = await createSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  return prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { userId: true, organizationId: true, role: true },
  });
}

export const canManageOnboarding = (role: string) =>
  ["MASTER", "ADMIN", "MANAGER"].includes(role);
