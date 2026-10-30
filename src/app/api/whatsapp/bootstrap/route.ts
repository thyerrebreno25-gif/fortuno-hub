import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getWhatsAppPermission,
  SERVICE_CENTER_MANAGER_ROLES,
} from "@/modules/atendimento/auth";
import { connectionView, whatsappConnection } from "@/modules/whatsapp/uazapi-server";

export async function GET() {
  const member = await getServiceCenterMember();

  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getWhatsAppPermission(
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

  const connection = connectionView(await whatsappConnection(member.organizationId));
  const rolePermissions = new Map(await Promise.all([...new Set(members.map((item) => item.role))].map(async (role) => [role, await getWhatsAppPermission(member.organizationId, role)] as const)));
  return NextResponse.json({
    mode: connection.status === "CONNECTED" && "webhookReady" in connection && connection.webhookReady ? "CONNECTED" : "DISCONNECTED",
    currentUser: member.user,
    canEdit: permission.canEdit,
    canViewManagement: canViewWhatsAppManagement(member.role, permission.canView),
    canConfigureConnection: member.role === "MASTER" || member.role === "ADMIN" && permission.canManage,
    canManage:
      permission.canManage || SERVICE_CENTER_MANAGER_ROLES.has(member.role),
    clients,
    members: members.map((item) => ({ ...item.user, role: item.role, canAttend: Boolean(rolePermissions.get(item.role)?.canView && rolePermissions.get(item.role)?.canEdit) })),
  });
}
