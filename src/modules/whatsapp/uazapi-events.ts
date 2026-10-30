import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { classifyAndRouteEmail } from "@/modules/atendimento/routing/classifier";
import { normalizeWhatsappIdentity, whatsappChannelAddress } from "./core";
import { resolveWhatsappRouting } from "./server";
import { normalizeUazapiEvent, object, text } from "./uazapi";
import { checkConnection, whatsappConnection } from "./uazapi-server";

type Connection = NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
type Event = NonNullable<ReturnType<typeof normalizeUazapiEvent>>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const at = (timestamp: number) => {
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  return Number.isFinite(date.getTime()) && timestamp > 0 ? date : new Date();
};
export async function enqueueUazapiEvent(connection: Connection, event: Event) {
  const identity = event.kind === "messages" ? [event.kind, event.id, event.fromMe] : event;
  const id = hash(connection.id + connection.instanceId + JSON.stringify(identity));
  await prisma.whatsAppWebhookInbox.upsert({ where: { id }, update: {}, create: {
    id, connectionId: connection.id, eventType: event.kind,
    payload: { instanceId: connection.instanceId, event } as Prisma.InputJsonValue,
  } });
}
export async function enqueueUazapiHistory(connection: Connection, events: Array<Extract<Event, { kind: "messages" }>>) {
  if (!events.length) return 0;
  const result = await prisma.whatsAppWebhookInbox.createMany({ skipDuplicates: true, data: events.map((event) => ({
    id: hash(connection.id + (connection.phone || connection.instanceId) + JSON.stringify([event.kind, event.id, event.fromMe])),
    connectionId: connection.id, eventType: event.kind, payload: { instanceId: connection.instanceId, event } as Prisma.InputJsonValue,
  })) });
  return result.count;
}

export async function receiveMessage(connection: Connection, event: Extract<Event, { kind: "messages" }>) {
  if (event.fromMe && event.wasSentByApi && !event.historical) return;
  const kind = event.group ? "GROUP" : "CONTACT";
  const identifier = normalizeWhatsappIdentity(kind, event.chatId);
  const address = whatsappChannelAddress(kind, identifier);
  const recipient = `wa-account:${connection.id}:${connection.phone || connection.instanceId}`;
  const externalMessageId = `uazapi:${connection.phone || connection.instanceId}:${event.id}`;
  const existing = await prisma.serviceMessage.findFirst({ where: { ticket: { organizationId: connection.organizationId, source: "WHATSAPP_API", senderEmail: address }, OR: [
    { externalMessageId }, { externalMessageId: `uazapi:${connection.instanceId}:${event.id}` },
    { AND: [{ providerMetadata: { path: ["connectionId"], equals: connection.id } }, { providerMetadata: { path: ["messageId"], equals: event.id } }] },
    { externalMessageId: { endsWith: ":" + event.id }, providerMetadata: { path: ["connectionId"], equals: connection.id } },
  ] }, select: { id: true, ticketId: true, providerMetadata: true } });
  if (existing && (!object(existing.providerMetadata).accountPhone || object(existing.providerMetadata).accountPhone === connection.phone)) {
    const previous = object(existing.providerMetadata);
    if (previous.instanceId === connection.instanceId && previous.apiMessageId === event.apiId && previous.accountPhone === connection.phone) return;
    await prisma.serviceMessage.update({ where: { id: existing.id }, data: { providerMetadata: { ...object(existing.providerMetadata), provider: "UAZAPI", connectionId: connection.id, instanceId: connection.instanceId, accountPhone: connection.phone, chatId: event.chatId, messageId: event.id, apiMessageId: event.apiId } } });
    if (event.media) await prisma.serviceAttachment.updateMany({ where: { messageId: existing.id }, data: { externalAttachmentId: `uazapi:${connection.instanceId}:${event.media.id}`, ...(event.media.mimeType ? { mimeType: event.media.mimeType } : {}) } });
    if (object(existing.providerMetadata).instanceId !== connection.instanceId) await prisma.serviceTicket.update({ where: { id: existing.ticketId }, data: { updatedAt: new Date() } });
    return;
  }
  const classification = await classifyAndRouteEmail({ organizationId: connection.organizationId, senderEmail: address, subject: event.chatName || event.senderName, textBody: event.body, attachmentNames: event.media ? [event.media.name] : [] });
  const routing = await resolveWhatsappRouting({ organizationId: connection.organizationId, kind, identifier, routingArea: classification.area });
  const timestamp = at(event.timestamp);
  await prisma.$transaction(async (tx) => {
    // Serialize each chat so simultaneous deliveries cannot create separate active tickets.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${connection.id + event.chatId}))`;
    if (await tx.serviceMessage.findFirst({ where: { externalMessageId, ticket: { organizationId: connection.organizationId } }, select: { id: true } })) return;
    const scope = { organizationId: connection.organizationId, source: "WHATSAPP_API" as const, senderEmail: address, mergedIntoId: null, OR: [{ recipientEmail: recipient }, { recipientEmail: { startsWith: `wa-uazapi:${connection.id}:` } }] };
    const closed = event.historical ? await tx.serviceTicket.findFirst({ where: { ...scope, status: "RESOLVED", resolvedAt: { gte: timestamp } }, orderBy: { resolvedAt: "asc" } }) : null;
    const active = closed || await tx.serviceTicket.findFirst({ where: { ...scope, status: { notIn: ["RESOLVED", "SPAM"] } }, orderBy: { lastMessageAt: "desc" } });
    if (event.fromMe && !active && !event.historical) return;
    const name = event.chatName || (event.group ? active?.senderName : event.senderName) || identifier;
    const ticket = active ? await tx.serviceTicket.update({ where: { id: active.id }, data: {
      updatedAt: new Date(),
      recipientEmail: recipient,
      ...(event.historical && timestamp < active.receivedAt ? { receivedAt: timestamp } : {}),
      ...(!event.fromMe && timestamp >= active.lastMessageAt && active.status === "WAITING_CUSTOMER" ? { status: active.assignedToId ? "IN_PROGRESS" as const : "NEW" as const } : {}),
      ...(timestamp >= active.lastMessageAt ? { snippet: event.body.slice(0, 220), lastMessageAt: timestamp, senderName: name } : {}),
      ...(event.fromMe && !active.firstResponseAt ? { firstResponseAt: timestamp } : {}),
    } }) : await tx.serviceTicket.create({ data: {
      organizationId: connection.organizationId, source: "WHATSAPP_API", clientId: routing.clientId,
      routingArea: classification.area, routingSquad: routing.routingSquad, routingConfidence: routing.clientId && !routing.ambiguous ? 100 : 0,
      routingReason: `${routing.reason} ${classification.reason}`, assignedToId: routing.assignedToId, assignedAt: routing.assignedToId ? timestamp : null,
      externalThreadId: externalMessageId, subject: name, senderName: name, senderEmail: address, recipientEmail: recipient,
      snippet: event.body.slice(0, 220), status: event.fromMe ? "WAITING_CUSTOMER" : routing.assignedToId ? "IN_PROGRESS" : "NEW", receivedAt: timestamp, lastMessageAt: timestamp,
    } });
    const message = await tx.serviceMessage.create({ data: {
      ticketId: ticket.id, externalMessageId, direction: event.fromMe ? "OUTBOUND" : "INBOUND",
      fromName: event.senderName || name, fromEmail: event.fromMe ? recipient : address, toEmails: [event.fromMe ? address : recipient], textBody: event.body, receivedAt: timestamp,
      providerMetadata: { provider: "UAZAPI", connectionId: connection.id, instanceId: connection.instanceId, accountPhone: connection.phone, chatId: event.chatId, messageId: event.id, apiMessageId: event.apiId, historical: Boolean(event.historical) },
    } });
    if (event.media) await tx.serviceAttachment.create({ data: { id: "uazapi_" + hash(connection.organizationId + externalMessageId), messageId: message.id, externalAttachmentId: `uazapi:${connection.instanceId}:${event.media.id}`, name: event.media.name, mimeType: event.media.mimeType } });
    if (!active) await tx.serviceTicketHistory.create({ data: { ticketId: ticket.id, type: "WHATSAPP_API_INBOUND_CREATED", message: routing.assignedToId ? "Mensagem recebida pela Uazapi e direcionada ao responsável." : "Mensagem recebida pela Uazapi na fila geral." } });
  });
}

export function advancesDelivery(current: string | null, next: string) {
  const ranks: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };
  if (next === "failed") return !current || current === "accepted";
  return next in ranks && (ranks[next] > (ranks[current || ""] ?? -1));
}
async function processEvent(connection: Connection, event: Event) {
  if (event.kind === "messages") return receiveMessage(connection, event);
  if (event.kind === "connection") { await checkConnection(connection); return; }
  if (!event.status || !event.ids.length) return;
  const messages = await prisma.serviceMessage.findMany({ where: { externalMessageId: { in: event.ids.flatMap((id) => [`uazapi:${connection.instanceId}:${id}`, `uazapi:${connection.phone}:${id}`]) }, ticket: { organizationId: connection.organizationId, source: "WHATSAPP_API" } }, select: { id: true, ticketId: true, deliveryStatus: true } });
  for (const message of messages) if (advancesDelivery(message.deliveryStatus, event.status)) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.serviceMessage.updateMany({ where: { id: message.id, deliveryStatus: message.deliveryStatus }, data: { deliveryStatus: event.status, statusUpdatedAt: at(event.timestamp) } });
      if (changed.count) await tx.serviceTicket.update({ where: { id: message.ticketId }, data: { updatedAt: new Date() } });
    });
  }
}
export async function drainUazapiInbox(connectionId?: string) {
  const now = new Date();
  await prisma.whatsAppWebhookInbox.updateMany({ where: { connectionId, status: "PROCESSING", claimedAt: { lt: new Date(now.getTime() - 300000) } }, data: { status: "PENDING" } });
  const items = await prisma.whatsAppWebhookInbox.findMany({ where: { connectionId, attempts: { lt: 5 }, OR: [{ status: "PENDING" }, { status: "FAILED", claimedAt: { lt: new Date(now.getTime() - 60000) } }] }, take: 200, orderBy: { receivedAt: "asc" }, include: { connection: true } });
  let cursor = 0;
  async function worker() {
  while (cursor < items.length) {
    const item = items[cursor++];
    const claimed = await prisma.whatsAppWebhookInbox.updateMany({ where: { id: item.id, status: item.status, attempts: item.attempts }, data: { status: "PROCESSING", claimedAt: now, attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const payload = object(item.payload);
      if (text(payload.instanceId) === item.connection.instanceId) await processEvent(item.connection, payload.event as Event);
      await prisma.whatsAppWebhookInbox.update({ where: { id: item.id }, data: { status: "COMPLETED", processedAt: new Date(), lastError: null, payload: { instanceId: item.connection.instanceId, kind: item.eventType } } });
    } catch {
      await prisma.whatsAppWebhookInbox.update({ where: { id: item.id }, data: { status: "FAILED", lastError: "Falha ao processar evento; nova tentativa agendada." } });
    }
  }
  }
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, () => worker()));
  return items.length;
}
