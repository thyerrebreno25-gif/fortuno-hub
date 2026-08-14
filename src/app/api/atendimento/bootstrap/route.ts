import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getServiceCenterPermission,
  SERVICE_CENTER_MANAGER_ROLES,
} from "@/modules/atendimento/auth";

export async function GET() {
  const member = await getServiceCenterMember();

  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getServiceCenterPermission(
    member.organizationId,
    member.role,
  );

  if (!permission.canView) {
    return NextResponse.json(
      { error: "Seu perfil não possui acesso à Central de Atendimento." },
      { status: 403 },
    );
  }

  const [clients, members] = await Promise.all([
    prisma.client.findMany({
      where: {
        organizationId: member.organizationId,
        active: true,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        operationalEmail: true,
        operationalEmailCc: true,
        operationLeaderId: true,
      },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: member.organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
  ]);

  return NextResponse.json({
    currentUser: {
      id: member.user.id,
      name: member.user.name || member.user.email,
      email: member.user.email,
      role: member.role,
      canManage:
        permission.canManage ||
        SERVICE_CENTER_MANAGER_ROLES.has(member.role),
    },
    permission,
    clients,
    members: members
      .filter((row) => row.role !== "CLIENT")
      .map((row) => ({
        ...row.user,
        role: row.role,
      })),
  });
}
