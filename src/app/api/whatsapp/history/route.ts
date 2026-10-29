import { after, NextResponse } from "next/server";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { whatsappConnection } from "@/modules/whatsapp/uazapi-server";
import { latestHistorySync, processWhatsAppHistory, scheduleHistorySync } from "@/modules/whatsapp/history-sync";
import { prisma } from "@/lib/prisma";
export const maxDuration = 120;
export async function POST() {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!permission.canEdit) return NextResponse.json({ error: "Sem permissão para sincronizar o histórico." }, { status: 403 });
  const connection = await whatsappConnection(member.organizationId);
  if (!connection || connection.status !== "CONNECTED" || !connection.phone || connection.expiresAt && connection.expiresAt < new Date()) return NextResponse.json({ error: "Conecte o WhatsApp antes de atualizar o histórico." }, { status: 409 });
  await prisma.whatsAppWebhookInbox.updateMany({ where: { connectionId: connection.id, status: "FAILED", AND: [{ payload: { path: ["instanceId"], equals: connection.instanceId } }, { payload: { path: ["event", "historical"], equals: true } }] }, data: { status: "PENDING", attempts: 0 } });
  await scheduleHistorySync(connection, { force: true });
  after(async () => { await processWhatsAppHistory(connection.id); });
  return NextResponse.json({ sync: await latestHistorySync(connection.id) }, { status: 202 });
}
