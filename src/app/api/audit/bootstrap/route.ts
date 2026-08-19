import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canSuperviseAudit,
  getAuditMember,
  isAuditAdministrator,
} from "@/modules/audit/auth";

export async function GET() {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const canSupervise = canSuperviseAudit(member.role, member.isTeamLeader);
  const administrator = isAuditAdministrator(member.role);

  const [clients, members] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: member.organizationId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, document: true, operationLeaderId: true },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId: member.organizationId,
        role: "OPERATOR",
        isTeamLeader: false,
        ...(administrator || (member.role === "MANAGER" && !member.isTeamLeader)
          ? {}
          : member.isTeamLeader
            ? { teamLeaderId: member.id }
            : { userId: "__NO_AUDIT_OPERATOR__" }),
      },
      orderBy: { user: { name: "asc" } },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    }),
  ]);

  return NextResponse.json({
    currentUser: {
      id: member.userId,
      role: member.role,
      name: member.user.name,
      email: member.user.email,
      isTeamLeader: member.isTeamLeader,
      canSupervise,
    },
    clients,
    operators: members.map((item) => ({ id: item.userId, role: item.role, name: item.user.name || item.user.email, email: item.user.email })),
  });
}
