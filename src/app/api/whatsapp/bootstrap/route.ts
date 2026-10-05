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
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const [clients, members] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: member.organizationId, active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        document: true,
        serviceSquad: true,
        operationLeaderId: true,
        payableResponsibleId: true,
        receivableResponsibleId: true,
        generalResponsibleId: true,
        contaAzulConnection: {
          select: {
            status: true,
            active: true,
            externalTenantName: true,
          },
        },
      },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId: member.organizationId,
        role: { not: "CLIENT" },
      },
      orderBy: { user: { name: "asc" } },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return NextResponse.json({
    mode:
      process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
        ? "CONNECTED"
        : "TEST",
    currentUser: member.user,
    canManage:
      permission.canManage || SERVICE_CENTER_MANAGER_ROLES.has(member.role),
    clients,
    members: members.map((item) => ({ ...item.user, role: item.role })),
  });
}
