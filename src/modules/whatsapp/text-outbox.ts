import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { type Prisma } from "@/generated/prisma/client";
import { chatLock } from "./merge";
import { resolveWhatsappTicketId } from "./server";
import { sendUazapiText } from "./uazapi-server";
import { object } from "./uazapi";

type Scope = { organizationId: string; connectionId: string; instanceId: string; accountPhone: string; senderEmail: string; accountRecipient: string };
type Actor = { userId: string; user: { name: string | null; email: string } };
export type RecordedText = Scope & { actor: Actor; ticketId: string; requestId: string; content: string; wireBody: string; to: string; replyProviderId?: string; replyToMessageId?: string; mentionTargets?: Array<{phone:string;name:string;lid:string|null}> };
export class TextOutboxError extends Error { constructor(message: string, public status = 409) { super(message); } }
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ticketScope = (scope: Scope) => ({ organizationId: scope.organizationId, source: "WHATSAPP_API" as const, recipientEmail: scope.accountRecipient, senderEmail: scope.senderEmail });
const statuses: Record<string, number> = { unconfirmed: -1, accepted: 0, sent: 1, delivered: 2, read: 3 };
function bestStatus(current: string | null, next = "accepted") {
  if (!(next in statuses) && next !== "failed") next = "accepted";
  if (next === "failed") return (statuses[current || ""] ?? -1) > 0 ? current : "failed";
  return (statuses[current || ""] ?? -1) > (statuses[next] ?? 0) ? current : next;
}

/** Both the HTTP response and provider echo confirm the same durable attempt. */
export async function confirmRecordedText(scope: Scope, messageId: string, externalMessageId: string, provider: Record<string, string> = {}, status = "accepted") {
  return prisma.$transaction(async tx => {
    const account = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "WhatsAppConnection" WHERE id=${scope.connectionId} AND "organizationId"=${scope.organizationId} AND "instanceId"=${scope.instanceId} AND phone=${scope.accountPhone} AND status='CONNECTED' FOR SHARE`;
    if (!account.length) return false;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(scope.connectionId, scope.senderEmail)}))`;
    await tx.$queryRaw`SELECT id FROM "ServiceMessage" WHERE id=${messageId} FOR UPDATE`;
    const current = await tx.serviceMessage.findFirst({ where: { id: messageId, direction: "OUTBOUND", ticket: ticketScope(scope) } });
    const metadata = object(current?.providerMetadata);
    if (!current || metadata.type !== "WHATSAPP_TEXT_SEND" || metadata.accountPhone !== scope.accountPhone || metadata.connectionId !== scope.connectionId) return false;
    if (current.externalMessageId && current.externalMessageId !== externalMessageId) throw new TextOutboxError("O provedor informou identificadores diferentes para este envio. Confira a conversa antes de repetir.");
    const duplicate = await tx.serviceMessage.findFirst({ where: { id: { not: current.id }, externalMessageId, direction: "OUTBOUND", ticket: ticketScope(scope) }, include: { attachments: { select: { id: true } } } });
    // An untracked echo can precede the HTTP response. Keep the durable author/ID,
    // carry its receipt forward and remove only that proven duplicate text record.
    if (duplicate) {
      if (duplicate.attachments.length || object(duplicate.providerMetadata).type === "WHATSAPP_TEXT_SEND") throw new TextOutboxError("Existe outro registro deste envio. A conciliação precisa ser conferida.");
      await tx.serviceMessage.delete({ where: { id: duplicate.id } });
    }
    const now = new Date(), deliveryStatus = bestStatus(bestStatus(current.deliveryStatus, duplicate?.deliveryStatus || "accepted"), status);
    await tx.serviceMessage.update({ where: { id: current.id }, data: { externalMessageId, deliveryStatus, statusUpdatedAt: now, providerMetadata: { ...metadata, ...provider, sendState: "CONFIRMED", confirmedAt: metadata.confirmedAt || now.toISOString(), ...(duplicate ? { reconciledEchoId: duplicate.id } : {}) } as Prisma.InputJsonObject } });
    const ticket = await tx.serviceTicket.findFirst({ where: { id: current.ticketId, ...ticketScope(scope) } });
    const currentCall = ticket && +current.receivedAt >= +ticket.receivedAt && !["RESOLVED", "SPAM"].includes(ticket.status);
    if (ticket) await tx.serviceTicket.update({ where: { id: ticket.id }, data: { updatedAt: now, ...(+current.receivedAt >= +ticket.lastMessageAt ? { lastMessageAt: current.receivedAt, snippet: (current.textBody || "").slice(0, 220) } : {}), ...(currentCall && !ticket.firstResponseAt ? { firstResponseAt: current.receivedAt } : {}), ...(currentCall && ticket.assignedToId ? { status: "IN_PROGRESS" } : {}) } });
    if (metadata.sendState !== "CONFIRMED") await tx.serviceTicketHistory.create({ data: { ticketId: current.ticketId, userId: typeof metadata.userId === "string" ? metadata.userId : null, type: "WHATSAPP_REPLIED", message: "Envio de texto confirmado pelo WhatsApp.", metadata: { externalMessageId, messageId: current.id, requestId: metadata.requestId as string } } });
    return true;
  });
}

export async function sendRecordedText(input: RecordedText) {
  const messageId = "wa-text:" + digest([input.organizationId, input.accountRecipient, input.actor.userId, input.requestId]);
  const fingerprint = digest([input.senderEmail, input.wireBody, input.replyProviderId || null]);
  const now = new Date();
  const metadata = { type: "WHATSAPP_TEXT_SEND", provider: "UAZAPI", connectionId: input.connectionId, instanceId: input.instanceId, accountPhone: input.accountPhone, chatId: input.to, requestId: input.requestId, fingerprint, userId: input.actor.userId, sendState: "SENDING", attemptedAt: now.toISOString(), ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}), ...(input.mentionTargets?.length ? { mentionTargets: input.mentionTargets } : {}) };
  const claimed = await prisma.$transaction(async tx => {
    const account = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "WhatsAppConnection" WHERE id=${input.connectionId} AND "organizationId"=${input.organizationId} AND "instanceId"=${input.instanceId} AND phone=${input.accountPhone} AND status='CONNECTED' FOR SHARE`;
    if (!account.length) throw new TextOutboxError("A conexão mudou. Atualize a conversa antes de enviar.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(input.connectionId, input.senderEmail)}))`;
    const previous = await tx.serviceMessage.findFirst({ where: { id: messageId, ticket: ticketScope(input) } });
    if (previous) {
      if (object(previous.providerMetadata).fingerprint !== fingerprint) throw new TextOutboxError("A identificação deste envio já foi usada com outro conteúdo.");
      return { created: false, confirmed: Boolean(previous.externalMessageId), ticketId: previous.ticketId };
    }
    const ticketId = await resolveWhatsappTicketId(input.ticketId, input.organizationId, tx);
    const ticket = await tx.serviceTicket.findFirst({ where: { id: ticketId, ...ticketScope(input), mergedIntoId: null, assignedToId: input.actor.userId, status: { notIn: ["RESOLVED", "SPAM"] } } });
    if (!ticket) throw new TextOutboxError("A atribuição ou situação da conversa mudou. Atualize antes de enviar.");
    await tx.serviceMessage.create({ data: { id: messageId, ticketId, direction: "OUTBOUND", fromName: input.actor.user.name || input.actor.user.email, fromEmail: input.actor.user.email, toEmails: [input.senderEmail], textBody: input.content, receivedAt: now, deliveryStatus: "unconfirmed", statusUpdatedAt: now, providerMetadata: metadata } });
    await tx.serviceTicket.update({ where: { id: ticketId }, data: { updatedAt: now } });
    await tx.serviceTicketHistory.create({ data: { ticketId, userId: input.actor.userId, type: "WHATSAPP_SEND_ATTEMPT", message: "Tentativa de envio registrada antes de contatar o WhatsApp.", metadata: { messageId, requestId: input.requestId } } });
    return { created: true, confirmed: false, ticketId };
  });
  if (!claimed.created) return { ...claimed, messageId };
  try {
    const sent = await sendUazapiText({ organizationId: input.organizationId, accountRecipient: input.accountRecipient, instanceId: input.instanceId, to: input.to, body: input.wireBody, trackingId: messageId, replyToMessageId: input.replyProviderId });
    if (!await confirmRecordedText(input, messageId, sent.messageId, { messageId: sent.messageId.split(":").at(-1)! })) throw new TextOutboxError("Não foi possível conciliar a confirmação do envio.");
    return { ticketId: claimed.ticketId, messageId, confirmed: true };
  } catch (error) {
    const status = (error as {status?:unknown})?.status;
    const errorCode = error instanceof TextOutboxError ? "RECONCILIATION_CONFLICT" : error instanceof Error && /timeout|abort/i.test(error.name + error.message) ? "TIMEOUT" : typeof status === "number" ? "HTTP_" + status : "RESPONSE_OR_PERSISTENCE_ERROR";
    console.warn("WhatsApp: envio sem confirmação inicial", { messageId, ticketId: claimed.ticketId, errorCode });
    // A provider error after dispatch is uncertain, never grounds for an automatic resend.
    await prisma.serviceMessage.updateMany({ where: { id: messageId, externalMessageId: null, ticket: ticketScope(input) }, data: { deliveryStatus: "unconfirmed", statusUpdatedAt: new Date(), providerMetadata: { ...metadata, sendState: "UNKNOWN", errorCode } } });
    const saved = await prisma.serviceMessage.findFirst({ where: { id: messageId, ticket: ticketScope(input) }, select: { externalMessageId: true } });
    return { ticketId: claimed.ticketId, messageId, confirmed: Boolean(saved?.externalMessageId) };
  }
}

export async function reconcileTextEcho(scope: Scope, event: { trackingId?: string; fromMe: boolean; id: string; apiId: string; providerStatus?: string }) {
  if (!event.fromMe || !event.trackingId?.startsWith("wa-text:")) return false;
  const status = ["accepted", "sent", "delivered", "read", "failed"].includes(event.providerStatus || "") ? event.providerStatus! : "accepted";
  return confirmRecordedText(scope, event.trackingId, `uazapi:${scope.accountPhone}:${event.id}`, { messageId: event.id, apiMessageId: event.apiId }, status);
}
