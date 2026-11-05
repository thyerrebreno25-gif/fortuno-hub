import { NextResponse } from "next/server";
import { getRolePermissions, type PermissionShape } from "@/modules/permissions/permissions";
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

/** Enforce the same module permissions at the API boundary as in navigation. */
export async function onboardingAccessDenied(
  member: { organizationId: string; role: string },
  action: keyof PermissionShape = "canView",
) {
  if (member.role === "CLIENT") {
    return NextResponse.json({ error: "Sem permissão para acessar o onboarding." }, { status: 403 });
  }
  const permissions = (await getRolePermissions(member.organizationId, member.role)).ONBOARDING;
  if (!permissions.canView || !permissions[action]) {
    return NextResponse.json({ error: "Sem permissão para esta operação no onboarding." }, { status: 403 });
  }
  return null;
}
