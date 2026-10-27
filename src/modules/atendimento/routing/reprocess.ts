import { prisma } from "@/lib/prisma";
import { activeMailbox } from "@/modules/atendimento/mailbox-archive";
import { classifyAndRouteEmail } from "./classifier";
export async function rerouteGmailTickets(organizationId: string, ticketId?: string) {
  const tickets = await prisma.serviceTicket.findMany({
    where: { organizationId, source: "GMAIL", status: { in: ["NEW", "IN_PROGRESS", "SPAM"] }, AND: [activeMailbox], ...(ticketId ? { id: ticketId } : {}), history: { none: { userId: { not: null } } }, messages: { none: { direction: "OUTBOUND" } } },
    orderBy: { updatedAt: "asc" }, take: 200,
    include: { messages: { where: { direction: "INBOUND" }, orderBy: { receivedAt: "desc" }, take: 1, include: { attachments: { select: { name: true } } } } },
  });
  let changed = 0;
  for (const ticket of tickets) {
    const message = ticket.messages[0]; if (!message) continue;
    const decision = await classifyAndRouteEmail({ organizationId, senderEmail: message.fromEmail, subject: message.subject || ticket.subject, textBody: message.textBody || "", htmlBody: message.htmlBody || "", attachmentNames: message.attachments.map((a) => a.name), recipientEmails: [...message.toEmails, ...message.ccEmails] });
    const data = { clientId: decision.clientId, assignedToId: decision.assignedToId, assignedAt: decision.assignedToId ? ticket.assignedToId === decision.assignedToId ? ticket.assignedAt : new Date() : null, routingArea: decision.area, routingSquad: decision.squad, routingConfidence: decision.confidence, routingReason: decision.reason, isSpam: decision.isSpam, spamScore: decision.spamScore, status: decision.isSpam ? "SPAM" as const : decision.assignedToId ? "IN_PROGRESS" as const : "NEW" as const };
    const different = Object.entries(data).some(([field, value]) => !["assignedAt"].includes(field) && ticket[field as keyof typeof ticket] !== value);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.serviceTicket.updateMany({ where: { id: ticket.id, organizationId, AND: [activeMailbox], updatedAt: ticket.updatedAt, history: { none: { userId: { not: null } } }, messages: { none: { direction: "OUTBOUND" } } }, data: different ? data : { updatedAt: new Date() } });
      if (updated.count && different) { changed++; await tx.serviceTicketHistory.create({ data: { ticketId: ticket.id, type: "AUTO_ROUTED", message: decision.reason, metadata: { assignedToId: decision.assignedToId, clientId: decision.clientId, area: decision.area, confidence: decision.confidence, spam: decision.isSpam } } }); }
    });
  }
  return { checked: tickets.length, changed };
}
