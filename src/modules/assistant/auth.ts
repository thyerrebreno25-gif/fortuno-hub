import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getRolePermissions, type ModuleCode } from "@/modules/permissions/permissions";

export type AssistantMember = {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  isTeamLeader: boolean;
  teamMemberUserIds: string[];
  user: { id: string; name: string | null; email: string };
};

export async function getMemberForModule(module: ModuleCode): Promise<AssistantMember | null> {
  const supabase = await createSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const member = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      role: true,
      isTeamLeader: true,
      teamMembers: { select: { userId: true } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!member) return null;

  const permissions = await getRolePermissions(member.organizationId, member.role);
  return permissions[module].canView
    ? {
        id: member.id,
        userId: member.userId,
        organizationId: member.organizationId,
        role: member.role,
        isTeamLeader: member.isTeamLeader,
        teamMemberUserIds: member.teamMembers.map((teamMember) => teamMember.userId),
        user: member.user,
      }
    : null;
}

export function getMappingMember() { return getMemberForModule("OPERATIONAL_MAPPING"); }

export function getAssistantMember() { return getMemberForModule("ASSISTANT"); }
export function getInvoiceHistoryMember() { return getMemberForModule("IMPORTS"); }

export function hasOrganizationClientScope(member: AssistantMember) {
  return ["MASTER", "ADMIN", "MANAGER"].includes(member.role);
}

export function assistantClientAccessWhere(member: AssistantMember) {
  if (hasOrganizationClientScope(member)) return {};
  const responsibleUserIds = member.isTeamLeader
    ? Array.from(new Set([member.userId, ...member.teamMemberUserIds]))
    : [member.userId];
  return {
    OR: [
      { operationLeaderId: { in: responsibleUserIds } },
      { payableResponsibleId: { in: responsibleUserIds } },
      { receivableResponsibleId: { in: responsibleUserIds } },
      { generalResponsibleId: { in: responsibleUserIds } },
    ],
  };
}

export async function findAssistantClient(
  member: AssistantMember,
  clientId: string,
) {
  return prisma.client.findFirst({
    where: {
      id: clientId,
      organizationId: member.organizationId,
      active: true,
      ...assistantClientAccessWhere(member),
    },
    select: { id: true, name: true, document: true },
  });
}
