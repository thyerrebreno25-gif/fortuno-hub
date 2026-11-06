import { prisma } from "@/lib/prisma";
import { accountTicketWhere, type WhatsAppAccount } from "./account-scope";
import { parseWhatsappChannelAddress } from "./core";
import { classifyWhatsappArea, AUTOMATIC_WHATSAPP_PREFIX } from "./automatic-routing";
import { resolveWhatsappRouting } from "./server";
const batches = new Map<string, { until: number; cursor?: string }>();
export function reserveRoutingBatch(key: string | null) {
  if (!key || (batches.get(key)?.until || 0) > Date.now()) return false;
  for (const [id, batch] of batches) if (batch.until < Date.now() - 300000) batches.delete(id);
  batches.set(key, { ...batches.get(key), until: Date.now() + 60000 });
  return true;
}
export async function reconcileQueuedWhatsapp(account: WhatsAppAccount) {
  const key = "wa-account:" + account.id + ":" + account.phone, batch = batches.get(key);
  const tickets = await prisma.serviceTicket.findMany({ where: { ...accountTicketWhere(account.organizationId, account), mergedIntoId: null, assignedToId: null, isSpam: false, status: { notIn: ["RESOLVED", "SPAM"] } }, orderBy: { id: "asc" }, take: 50, ...(batch?.cursor ? { cursor: { id: batch.cursor }, skip: 1 } : {}), select: { id: true, clientId: true, senderEmail: true, senderName: true, subject: true, updatedAt: true, routingArea: true, routingSquad: true, routingReason: true, messages: { where: { direction: "INBOUND" }, take: 1, orderBy: { receivedAt: "desc" }, select: { textBody: true, attachments: { select: { name: true } } } } } });
  for (const ticket of tickets) {
    const channel = parseWhatsappChannelAddress(ticket.senderEmail), message = ticket.messages[0];
    const classified = classifyWhatsappArea(channel.kind === "GROUP" ? ticket.senderName || ticket.subject : "", message?.textBody || "", message?.attachments.map(file => file.name));
    const area = ticket.routingReason?.startsWith("Área do atendimento selecionada manualmente") ? ticket.routingArea : classified.area;
    const routing = await resolveWhatsappRouting({ organizationId: account.organizationId, kind: channel.kind, identifier: channel.externalId, displayName: ticket.senderName || ticket.subject, requestedClientId: ticket.clientId, routingArea: area });
    if (!routing.clientId) continue;
    const reason = AUTOMATIC_WHATSAPP_PREFIX + routing.reason + " " + classified.reason;
    if (ticket.clientId === routing.clientId && ticket.routingArea === area && ticket.routingReason === reason && ticket.routingSquad === routing.routingSquad && !routing.assignedToId) continue;
    await prisma.$transaction(async tx => {
      const current = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WhatsAppConnection" WHERE id = ${account.id} AND phone = ${account.phone} AND status = 'CONNECTED' FOR SHARE`;
      if (!current.length) return;
      const changed = await tx.serviceTicket.updateMany({ where: { ...accountTicketWhere(account.organizationId, account), id: ticket.id, updatedAt: ticket.updatedAt, assignedToId: null, status: { notIn: ["RESOLVED", "SPAM"] } }, data: { clientId: routing.clientId, routingArea: area, routingSquad: routing.routingSquad, routingReason: reason, routingConfidence: 100, assignedToId: routing.assignedToId, assignedAt: routing.assignedToId ? new Date() : null, status: routing.assignedToId ? "IN_PROGRESS" : "NEW" } });
      if (changed.count) await tx.serviceTicketHistory.create({ data: { ticketId: ticket.id, type: "WHATSAPP_AUTOMATIC_ROUTING", message: routing.assignedToId ? "Atendimento direcionado pelo cliente e pela área responsável." : "Cliente identificado; aguardando responsável ou triagem da área.", metadata: { clientId: routing.clientId, assignedToId: routing.assignedToId, routingArea: area } } });
    });
  }
  batches.set(key, { until: Date.now() + 60000, cursor: tickets.length === 50 ? tickets.at(-1)?.id : undefined });
}
