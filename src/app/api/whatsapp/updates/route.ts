import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { WHATSAPP_SOURCES } from "@/modules/whatsapp/core";
export async function GET() {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!permission.canView) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const where = { organizationId: member.organizationId, source: { in: [...WHATSAPP_SOURCES] } };
  const [tickets, connection] = await Promise.all([
    prisma.serviceTicket.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    prisma.whatsAppConnection.findUnique({ where: { organizationId: member.organizationId }, select: { status: true, webhookConfiguredAt: true, expiresAt: true } }),
  ]);
  const mode = connection?.status === "CONNECTED" && connection.webhookConfiguredAt && (!connection.expiresAt || connection.expiresAt > new Date()) ? "CONNECTED" : "DISCONNECTED";
  return NextResponse.json({ revision: [tickets._count, tickets._max.updatedAt?.toISOString()].join(":"), mode }, { headers: { "Cache-Control": "private, no-store" } });
}
