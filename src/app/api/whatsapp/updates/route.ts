import { reserveRoutingBatch, reconcileQueuedWhatsapp } from "@/modules/whatsapp/automatic-routing-server";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { latestHistorySync, processWhatsAppHistory } from "@/modules/whatsapp/history-sync";
export const maxDuration = 120;
export async function GET() {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!permission.canView) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const account = await currentWhatsAppAccount(member.organizationId);
  const connection = account.connection;
  const tickets = await prisma.serviceTicket.aggregate({ where: { ...account.where, mergedIntoId: null }, _count: true, _max: { updatedAt: true } });
  const mode = connection?.status === "CONNECTED" && connection.webhookConfiguredAt && (!connection.expiresAt || connection.expiresAt > new Date()) ? "CONNECTED" : "DISCONNECTED";
  if (mode === "CONNECTED" && connection && reserveRoutingBatch(account.accountKey)) after(async () => { await reconcileQueuedWhatsapp(connection); });
  const historySync = connection ? await latestHistorySync(connection.id, connection.phone) : null;
  if (mode === "CONNECTED" && historySync?.status === "PENDING") after(async () => { await processWhatsAppHistory(connection!.id); });
  return NextResponse.json({ accountKey: account.accountKey, revision: [account.accountKey, tickets._count, tickets._max.updatedAt?.toISOString()].join(":"), mode, historySync }, { headers: { "Cache-Control": "private, no-store" } });
}
