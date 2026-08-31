import type { Prisma } from "@/generated/prisma/client";
import { canBroadcastToOrganization } from "./notice-permissions";

type NoticeTargetingMember = {
  id: string;
  organizationId: string;
  role: string;
};

export function targetableNoticeMemberWhere(
  member: NoticeTargetingMember,
  requestedMemberIds?: string[],
): Prisma.OrganizationMemberWhereInput {
  return {
    organizationId: member.organizationId,
    id: {
      ...(requestedMemberIds ? { in: requestedMemberIds } : {}),
      not: member.id,
    },
    role: { not: "CLIENT" },
    ...(canBroadcastToOrganization(member)
      ? {}
      : { teamLeaderId: member.id }),
  };
}
