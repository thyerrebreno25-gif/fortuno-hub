import {isContactName} from "./contact-name";
import {callLabel, mergeCall, type WhatsAppCall} from "./call-core";
import {detectPaymentRequest} from "./payment-core";
import "server-only";
import {unstable_cache} from "next/cache";
import {decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { classifyWhatsappArea, AUTOMATIC_WHATSAPP_PREFIX, mayAutomaticallyRoute } from "./automatic-routing";
import { normalizeWhatsappIdentity, whatsappChannelAddress } from "./core";
import { resolveWhatsappRouting } from "./server";
import {validReactionEmoji} from "./reaction-core";
import {storeOwnReaction} from "./reactions";
import { normalizeUazapiEvent, object, text, uazapiRequest } from "./uazapi";
import { checkConnection, whatsappConnection } from "./uazapi-server";

type Connection = NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
type Event = NonNullable<ReturnType<typeof normalizeUazapiEvent>>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const at = (timestamp: number) => {
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  return Number.isFinite(date.getTime()) && timestamp > 0 ? date : new Date();
};
export async function enqueueUazapiEvent(connection: Connection, event: Event) {
  const identity = event.kind === "messages" ? [event.kind, event.id, event.fromMe, ...(event.call ? [event.call] : [])] : event;
  const id = hash(connection.id + connection.instanceId + (connection.phone || "unbound") + JSON.stringify(identity));
  await prisma.whatsAppWebhookInbox.upsert({ where: { id }, update: {}, create: {
    id, connectionId: connection.id, eventType: event.kind,
    payload: { instanceId: connection.instanceId, accountPhone: connection.phone, event } as Prisma.InputJsonValue,
  } });
}
export async function enqueueUazapiHistory(connection: Connection, events: Array<Extract<Event, { kind: "messages" }>>) {
  if (!events.length) return 0;
  const result = await prisma.whatsAppWebhookInbox.createMany({ skipDuplicates: true, data: events.map((event) => ({
    id: hash(connection.id + (connection.phone || connection.instanceId) + JSON.stringify([event.kind, event.id, event.fromMe, ...(event.call ? [event.call] : [])])),
    connectionId: connection.id, eventType: event.kind, payload: { instanceId: connection.instanceId, accountPhone: connection.phone, event } as Prisma.InputJsonValue,
  })) });
  return result.count;
}

export async function receiveMessage(connection: Connection, event: Extract<Event, { kind: "messages" }>) {
  if (event.fromMe && event.wasSentByApi && !event.historical && !event.call) return;
  const kind = event.group ? "GROUP" : "CONTACT";
  const identifier = normalizeWhatsappIdentity(kind, event.chatId);
  const address = whatsappChannelAddress(kind, identifier);
  const recipient = `wa-account:${connection.id}:${connection.phone || connection.instanceId}`;
  const externalMessageId = `uazapi:${connection.phone || connection.instanceId}:${event.id}`;
  const quotedOriginal=event.quote?await prisma.serviceMessage.findFirst({where:{direction:{not:"INTERNAL"},ticket:{organizationId:connection.organizationId,source:"WHATSAPP_API",senderEmail:address,recipientEmail:recipient,isSpam:false,mergedIntoId:null},OR:[{externalMessageId:`uazapi:${connection.phone}:${event.quote.externalId}`},{providerMetadata:{path:["apiMessageId"],equals:event.quote.apiId}}]},select:{id:true}}):null;
  const quoteMetadata=event.quote?{quotedExternalId:event.quote.externalId,quotedFallback:event.quote.fallback,...(quotedOriginal?{replyToMessageId:quotedOriginal.id}:{})}:{};
  const existing = await prisma.serviceMessage.findFirst({ where: { ticket: { organizationId: connection.organizationId, source: "WHATSAPP_API", senderEmail: address, recipientEmail: recipient }, OR: [
    { externalMessageId }, { externalMessageId: `uazapi:${connection.instanceId}:${event.id}` },
    { AND: [{ providerMetadata: { path: ["connectionId"], equals: connection.id } }, { providerMetadata: { path: ["messageId"], equals: event.id } }] },
    { externalMessageId: { endsWith: ":" + event.id }, providerMetadata: { path: ["connectionId"], equals: connection.id } },
  ] }, select: { id: true, ticketId: true, providerMetadata: true } });
  if (existing && (!object(existing.providerMetadata).accountPhone || object(existing.providerMetadata).accountPhone === connection.phone)) {
    if (event.call) { await prisma.$transaction(tx => updateCallRecord(tx, connection, existing.id, event.call!, event.fromMe)); return; }
    const previous = object(existing.providerMetadata);
    if (previous.instanceId === connection.instanceId && previous.apiMessageId === event.apiId && previous.accountPhone === connection.phone && (!event.quote||previous.quotedExternalId===event.quote.externalId&&(!quotedOriginal||previous.replyToMessageId===quotedOriginal.id))) return;
    await prisma.serviceMessage.update({ where: { id: existing.id }, data: { providerMetadata: { ...object(existing.providerMetadata), provider: "UAZAPI", connectionId: connection.id, instanceId: connection.instanceId, accountPhone: connection.phone, chatId: event.chatId, messageId: event.id, apiMessageId: event.apiId, ...quoteMetadata } } });
    if (event.media) await prisma.serviceAttachment.updateMany({ where: { messageId: existing.id }, data: { externalAttachmentId: `uazapi:${connection.instanceId}:${event.media.id}`, ...(event.media.mimeType ? { mimeType: event.media.mimeType } : {}) } });
    if (object(existing.providerMetadata).instanceId !== connection.instanceId) await prisma.serviceTicket.update({ where: { id: existing.ticketId }, data: { updatedAt: new Date() } });
    return;
  }
  const directory = (!isContactName(event.chatName) && (event.group || event.call || !isContactName(event.senderName))) ? await prisma.whatsAppDirectoryEntry.findUnique({ where: { connectionId_accountPhone_externalId: { connectionId: connection.id, accountPhone: connection.phone || "", externalId: event.chatId } }, select: { displayName: true } }) : null;
  const chatName = (isContactName(directory?.displayName) ? directory!.displayName : isContactName(event.chatName) ? event.chatName : "");
  const classification = classifyWhatsappArea(event.group ? chatName : "", event.body, event.media ? [event.media.name] : []);
  const routing = await resolveWhatsappRouting({ organizationId: connection.organizationId, kind, identifier, displayName: chatName, routingArea: classification.area });
  const timestamp = at(event.timestamp);
  await prisma.$transaction(async (tx) => {
    const currentAccount = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "WhatsAppConnection" WHERE id = ${connection.id} AND "organizationId" = ${connection.organizationId} AND "instanceId" = ${connection.instanceId} AND phone = ${connection.phone} AND status = 'CONNECTED' FOR SHARE`);
    if (!currentAccount.length) return;
    // Serialize each chat so simultaneous deliveries cannot create separate active tickets.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${connection.id + event.chatId}))`;
    const duplicate = await tx.serviceMessage.findFirst({ where: { OR:[{externalMessageId},...(event.call?[{providerMetadata:{path:["call","id"],equals:event.call.id}}]:[])], ticket: { organizationId: connection.organizationId, source:"WHATSAPP_API",recipientEmail:recipient,senderEmail:address } }, select: { id: true } });
    if (duplicate) { if (event.call) await updateCallRecord(tx, connection, duplicate.id, event.call, event.fromMe); return; }
    const scope = { organizationId: connection.organizationId, source: "WHATSAPP_API" as const, senderEmail: address, mergedIntoId: null, recipientEmail: recipient };
    const closed = event.historical ? await tx.serviceTicket.findFirst({ where: { ...scope, status: "RESOLVED", resolvedAt: { gte: timestamp } }, orderBy: { resolvedAt: "asc" } }) : null;
    const active = closed || await tx.serviceTicket.findFirst({ where: { ...scope, status: { notIn: ["RESOLVED", "SPAM"] } }, orderBy: { lastMessageAt: "desc" } }) || await tx.serviceTicket.findFirst({where:{...scope,status:"RESOLVED",isSpam:false},orderBy:{lastMessageAt:"desc"}});
    const reopening=Boolean(active?.status==="RESOLVED"&&!event.historical&&!event.fromMe&&(!active.resolvedAt||timestamp>=active.resolvedAt));
    if (event.fromMe && !active && !event.historical && !event.call) return;
    const automatic = !reopening && active?.status!=="RESOLVED" && !event.fromMe && !event.historical && (!active || timestamp >= active.lastMessageAt) && (!active || !active.assignedToId&&mayAutomaticallyRoute(active, classification.area));
    const routingReason = AUTOMATIC_WHATSAPP_PREFIX + routing.reason + " " + classification.reason;
    const name = chatName || (event.group || event.fromMe ? active?.senderName : event.senderName) || identifier;
    const ticket = active ? await tx.serviceTicket.update({ where: { id: active.id }, data: {
      updatedAt: new Date(),
      ...(reopening?{status:"NEW" as const,assignedToId:null,assignedAt:null,firstResponseAt:null,resolvedAt:null,receivedAt:timestamp,whatsappDepartmentId:null,whatsappDepartmentName:null,routingReason:"Conversa reaberta na fila de atendimento; nova mensagem após a finalização."}:{}),
      ...(automatic ? { clientId: routing.clientId || active.clientId, whatsappDepartmentId:null,whatsappDepartmentName:null,routingArea: classification.area, routingSquad: routing.routingSquad, routingReason, routingConfidence: routing.clientId && !routing.ambiguous ? 100 : 0, assignedToId: null, assignedAt: null, status: "NEW" as const } : {}),
      recipientEmail: recipient,
      ...(event.historical && timestamp < active.receivedAt ? { receivedAt: timestamp } : {}),
      ...(!automatic && !event.fromMe && timestamp >= active.lastMessageAt && active.status === "WAITING_CUSTOMER" ? { status: active.assignedToId ? "IN_PROGRESS" as const : "NEW" as const } : {}),
      ...(timestamp >= active.lastMessageAt ? { snippet: event.body.slice(0, 220), lastMessageAt: timestamp, senderName: name } : {}),
      ...(event.fromMe && !event.call && !active.firstResponseAt ? { firstResponseAt: timestamp } : {}),
    } }) : await tx.serviceTicket.create({ data: {
      organizationId: connection.organizationId, source: "WHATSAPP_API", clientId: routing.clientId,
      routingArea: classification.area, routingSquad: routing.routingSquad, routingConfidence: routing.clientId && !routing.ambiguous ? 100 : 0,
      routingReason, assignedToId: null, assignedAt: null,
      externalThreadId: externalMessageId, subject: name, senderName: name, senderEmail: address, recipientEmail: recipient,
      snippet: event.body.slice(0, 220), status: event.fromMe ? "WAITING_CUSTOMER" : "NEW", receivedAt: timestamp, lastMessageAt: timestamp,
    } });
    if(reopening&&active)await tx.serviceTicketHistory.create({data:{ticketId:ticket.id,type:"WHATSAPP_REOPENED",message:"Nova mensagem reabriu a mesma conversa na fila.",metadata:{assignedToId:null,reopenPolicy:"QUEUE",previousResolvedById:active.resolvedById||null,previousAssignedToId:active.assignedToId,previousReceivedAt:active.receivedAt.toISOString(),previousFirstResponseAt:active.firstResponseAt?.toISOString()||null,previousResolvedAt:active.resolvedAt?.toISOString()||null}}});
    if (active && automatic && (active.assignedToId !== routing.assignedToId || active.clientId !== routing.clientId || active.routingArea !== classification.area)) await tx.serviceTicketHistory.create({ data: { ticketId: ticket.id, type: "WHATSAPP_AUTOMATIC_ROUTING", message: routingReason, metadata: { previousAssignedToId: active.assignedToId, assignedToId: routing.assignedToId, clientId: routing.clientId, routingArea: classification.area } } });
    const message = await tx.serviceMessage.create({ data: {
      ticketId: ticket.id, externalMessageId, direction: event.fromMe ? "OUTBOUND" : "INBOUND",
      fromName: event.senderName || name, fromEmail: event.fromMe ? recipient : address, toEmails: [event.fromMe ? address : recipient], textBody: event.body, receivedAt: timestamp,
      providerMetadata: { provider: "UAZAPI", connectionId: connection.id, instanceId: connection.instanceId, accountPhone: connection.phone, chatId: event.chatId, ...(event.group && event.sender ? {senderJid:event.sender} : {}), messageId: event.id, apiMessageId: event.apiId, historical: Boolean(event.historical),...(event.call ? {call:event.call} : {}),...quoteMetadata },
    } });
    const paymentReason=!event.call&&!event.historical&&!event.fromMe?(detectPaymentRequest(event.body,event.media?[event.media.name]:[])||(classification.area==="ACCOUNTS_PAYABLE"&&event.media?"Anexo recebido em contas a pagar: confira se contém uma solicitação de pagamento.":null)):null;
    if(paymentReason)await tx.$executeRaw(Prisma.sql`INSERT INTO "WhatsAppPaymentRequest" ("messageId","organizationId","ticketId","accountRecipient",reason) VALUES (${message.id},${connection.organizationId},${ticket.id},${recipient},${paymentReason}) ON CONFLICT ("messageId") DO NOTHING`);
    if (event.media) await tx.serviceAttachment.create({ data: { id: "uazapi_" + hash(connection.organizationId + externalMessageId), messageId: message.id, externalAttachmentId: `uazapi:${connection.instanceId}:${event.media.id}`, name: event.media.name, mimeType: event.media.mimeType } });
    if (!active) await tx.serviceTicketHistory.create({ data: { ticketId: ticket.id, type: "WHATSAPP_API_INBOUND_CREATED", message: routing.assignedToId ? "Mensagem recebida pela Uazapi e direcionada ao responsável." : "Mensagem recebida pela Uazapi na fila geral." } });
  });
}

async function updateCallRecord(tx: Prisma.TransactionClient, connection: Connection, id: string, next: WhatsAppCall, outbound: boolean) {
  // Row lock prevents a delayed offer from overwriting a completed call.
  const rows = await tx.$queryRaw<Array<{id:string;ticketId:string;providerMetadata:Prisma.JsonValue;receivedAt:Date}>>(Prisma.sql`
    SELECT m.id,m."ticketId",m."providerMetadata",m."receivedAt" FROM "ServiceMessage" m JOIN "ServiceTicket" t ON t.id=m."ticketId"
    WHERE m.id=${id} AND t."organizationId"=${connection.organizationId} AND t.source='WHATSAPP_API'
      AND t."recipientEmail"=${`wa-account:${connection.id}:${connection.phone}`} FOR UPDATE OF m`);
  const row=rows[0];if(!row)return;
  const metadata=object(row.providerMetadata), previous=object(metadata.call);
  const call=mergeCall(previous.id ? previous as WhatsAppCall : null,next), body=callLabel(call,outbound);
  await tx.serviceMessage.update({where:{id},data:{textBody:body,providerMetadata:{...metadata,call} as Prisma.InputJsonValue}});
  // Refresh an existing preview only when it still represents this call.
  await tx.serviceTicket.updateMany({where:{id:row.ticketId,organizationId:connection.organizationId,lastMessageAt:row.receivedAt},data:{snippet:body.slice(0,220),updatedAt:new Date()}});
  await tx.serviceTicket.updateMany({where:{id:row.ticketId,organizationId:connection.organizationId},data:{updatedAt:new Date()}});
}
async function receiveCall(connection:Connection,event:Extract<Event,{kind:"call"}>) {
  const existing=await prisma.serviceMessage.findFirst({where:{ticket:{organizationId:connection.organizationId,source:"WHATSAPP_API",recipientEmail:`wa-account:${connection.id}:${connection.phone}`},providerMetadata:{path:["call","id"],equals:event.call.id}},select:{id:true,providerMetadata:true}});
  if(existing){await prisma.$transaction(tx=>updateCallRecord(tx,connection,existing.id,event.call,event.fromMe));return;}
  // Some completed logs contain only the call ID. Never invent a contact for those.
  if(!event.chatId)return;
  await receiveMessage(connection,{kind:"messages",id:`call:${event.id}`,apiId:`call:${event.id}`,chatId:event.chatId,group:event.chatId.endsWith("@g.us"),fromMe:event.fromMe,wasSentByApi:false,senderName:event.senderName,chatName:"",sender:event.chatId,body:callLabel(event.call,event.fromMe),timestamp:event.call.timestamp,media:null,call:event.call});
}

export async function repairCallPlaceholders(connection:Connection,ticketId:string){
  const rows=await prisma.serviceMessage.findMany({where:{ticketId,textBody:"[Mensagem sem texto]",direction:{not:"INTERNAL"},ticket:{organizationId:connection.organizationId,source:"WHATSAPP_API",recipientEmail:`wa-account:${connection.id}:${connection.phone}`}},select:{id:true,direction:true,providerMetadata:true},take:5,orderBy:{receivedAt:"desc"}});
  for(const row of rows){
    const meta=object(row.providerMetadata),apiId=text(meta.apiMessageId,250);
    if(!apiId||meta.accountPhone!==connection.phone)continue;
    const result=await unstable_cache(()=>uazapiRequest(connection.serverUrl,decryptIntegrationSecret(connection.tokenEncrypted),"/message/find",{id:apiId}),["whatsapp-call-repair-v1",connection.id,connection.instanceId,connection.phone||"",apiId],{revalidate:600})();
    const messages=object(result).messages;if(!Array.isArray(messages))continue;
    for(const raw of messages.slice(0,5)){
      const event=normalizeUazapiEvent({EventType:"messages",message:raw});
      if(event?.kind!=="messages"||!event.call||event.fromMe!==(row.direction==="OUTBOUND")||!(event.apiId===apiId||event.id===meta.messageId))continue;
      await prisma.$transaction(tx=>updateCallRecord(tx,connection,row.id,event.call!,event.fromMe));break;
    }
  }
}

export function advancesDelivery(current: string | null, next: string) {
  const ranks: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };
  if (next === "failed") return !current || current === "accepted";
  return next in ranks && (ranks[next] > (ranks[current || ""] ?? -1));
}
async function receiveReaction(connection:Connection,event:Extract<Event,{kind:"reaction"}>){
  if(!validReactionEmoji(event.emoji))return;
  const senderEmail=whatsappChannelAddress(event.chatId.endsWith("@g.us")?"GROUP":"CONTACT",normalizeWhatsappIdentity(event.chatId.endsWith("@g.us")?"GROUP":"CONTACT",event.chatId));
  const message=await prisma.serviceMessage.findFirst({where:{ticket:{organizationId:connection.organizationId,source:"WHATSAPP_API",senderEmail,recipientEmail:`wa-account:${connection.id}:${connection.phone}`},OR:[{externalMessageId:`uazapi:${connection.phone}:${event.targetId}`},{providerMetadata:{path:["messageId"],equals:event.targetId}}]},select:{id:true,ticketId:true,providerMetadata:true}});
  if(!message)return;
  if(event.fromMe&&object(object(message.providerMetadata).hubReaction).emoji===event.emoji)return;
  if(event.fromMe)await storeOwnReaction(message.id,event.emoji,event.senderName||"WhatsApp da empresa");
  else await prisma.$executeRaw(Prisma.sql`UPDATE "ServiceMessage" SET "providerMetadata"=jsonb_set(COALESCE("providerMetadata",'{}'::jsonb),'{customerReactions}',COALESCE("providerMetadata"->'customerReactions','{}'::jsonb)||jsonb_build_object(${event.sender||event.chatId},jsonb_build_object('emoji',${event.emoji},'name',${event.senderName||"Cliente"})),true) WHERE id=${message.id}`);
  await prisma.serviceTicket.updateMany({where:{organizationId:connection.organizationId,source:"WHATSAPP_API",senderEmail,recipientEmail:`wa-account:${connection.id}:${connection.phone}`,mergedIntoId:null},data:{updatedAt:new Date()}});
}
async function processEvent(connection: Connection, event: Event) {
  if (event.kind === "messages") {
    if(event.call){
      const existing=await prisma.serviceMessage.findFirst({where:{ticket:{organizationId:connection.organizationId,source:"WHATSAPP_API",recipientEmail:`wa-account:${connection.id}:${connection.phone}`},providerMetadata:{path:["call","id"],equals:event.call.id}},select:{id:true}});
      if(existing){await prisma.$transaction(tx=>updateCallRecord(tx,connection,existing.id,event.call!,event.fromMe));return;}
    }
    return receiveMessage(connection, event);
  }
  if(event.kind === "call")return receiveCall(connection,event);
  if(event.kind === "reaction")return receiveReaction(connection,event);
  if (event.kind === "connection") { await checkConnection(connection); return; }
  if (!event.status || !event.ids.length) return;
  if(event.status==="deleted"){
    // A deletion is a state change: retain the original text, media and delivery receipts.
    await prisma.$executeRaw(Prisma.sql`UPDATE "ServiceMessage" m SET "providerMetadata"=jsonb_set(COALESCE(m."providerMetadata",'{}'::jsonb),'{deletedAt}',to_jsonb(${at(event.timestamp).toISOString()}::text),true) FROM "ServiceTicket" t WHERE t.id=m."ticketId" AND t."organizationId"=${connection.organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${`wa-account:${connection.id}:${connection.phone}`} AND (m."externalMessageId"=ANY(${event.ids.flatMap(id=>[`uazapi:${connection.phone}:${id}`,`uazapi:${connection.instanceId}:${id}`])}::text[]) OR m."providerMetadata"->>'apiMessageId'=ANY(${event.ids}::text[]))`);
    await prisma.serviceTicket.updateMany({where:{organizationId:connection.organizationId,source:"WHATSAPP_API",recipientEmail:`wa-account:${connection.id}:${connection.phone}`,messages:{some:{externalMessageId:{in:event.ids.flatMap(id=>[`uazapi:${connection.phone}:${id}`,`uazapi:${connection.instanceId}:${id}`])}}}},data:{updatedAt:new Date()}});
    return;
  }
  const messages = await prisma.serviceMessage.findMany({ where: { externalMessageId: { in: event.ids.flatMap((id) => [`uazapi:${connection.instanceId}:${id}`, `uazapi:${connection.phone}:${id}`]) }, ticket: { organizationId: connection.organizationId, source: "WHATSAPP_API", recipientEmail: `wa-account:${connection.id}:${connection.phone}` } }, select: { id: true, ticketId: true, deliveryStatus: true } });
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
      if (text(payload.instanceId) === item.connection.instanceId && (object(payload.event).kind === "connection" || Boolean(item.connection.phone) && payload.accountPhone === item.connection.phone)) await processEvent(item.connection, payload.event as Event);
      await prisma.whatsAppWebhookInbox.update({ where: { id: item.id }, data: { status: "COMPLETED", processedAt: new Date(), lastError: null, payload: { instanceId: item.connection.instanceId, kind: item.eventType } } });
    } catch {
      await prisma.whatsAppWebhookInbox.update({ where: { id: item.id }, data: { status: "FAILED", lastError: "Falha ao processar evento; nova tentativa agendada." } });
    }
  }
  }
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, () => worker()));
  return items.length;
}
