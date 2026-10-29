import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { WHATSAPP_SOURCES } from "@/modules/whatsapp/core";
import { latestHistorySync, processWhatsAppHistory } from "@/modules/whatsapp/history-sync";
export const maxDuration = 120;
export async function GET() {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!permission.canView) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const where = { organizationId: member.organizationId, source: { in: [...WHATSAPP_SOURCES] }, mergedIntoId: null };
  const [tickets, connection] = await Promise.all([
    prisma.serviceTicket.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    prisma.whatsAppConnection.findUnique({ where: { organizationId: member.organizationId }, select: { id: true, status: true, webhookConfiguredAt: true, expiresAt: true } }),
  ]);
  const mode = connection?.status === "CONNECTED" && connection.webhookConfiguredAt && (!connection.expiresAt || connection.expiresAt > new Date()) ? "CONNECTED" : "DISCONNECTED";
  const historySync = connection ? await latestHistorySync(connection.id) : null;
  if (mode === "CONNECTED" && historySync?.status === "PENDING") after(async () => { await processWhatsAppHistory(connection!.id); });
  return NextResponse.json({ revision: [tickets._count, tickets._max.updatedAt?.toISOString()].join(":"), mode, historySync }, { headers: { "Cache-Control": "private, no-store" } });
}
