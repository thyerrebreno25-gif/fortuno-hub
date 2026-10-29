import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { configureWebhook, whatsappConnection } from "./uazapi-server";
import { normalizeUazapiHistory, object, text, uazapiRequest } from "./uazapi";
import { drainUazapiInbox, enqueueUazapiHistory } from "./uazapi-events";
type Connection = NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
const activeStatuses = ["PENDING", "RUNNING", "IMPORTING"];
const milliseconds = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n < 1e12 ? n * 1000 : n : 0; };
export function historyPage(body: unknown, offset: number, since: Date) {
  const root = object(body);
  if (!Array.isArray(root.messages)) throw new Error("Formato inesperado na consulta de histórico.");
  const messages = root.messages.map(object);
  const pagination = object(root.pagination);
  const timestamps = messages.map((message) => milliseconds(message.messageTimestamp)).filter(Boolean);
  const hasMore = typeof pagination.hasMore === "boolean" ? pagination.hasMore : messages.length >= 200;
  const done = !messages.length || !hasMore || Boolean(timestamps.length && Math.min(...timestamps) < since.getTime());
  const nextOffset = pagination.nextOffset === undefined ? offset + messages.length : Number(pagination.nextOffset);
  if (!done && (!Number.isSafeInteger(nextOffset) || nextOffset <= offset)) throw new Error("A paginação do histórico não avançou.");
  return { messages, done, nextOffset };
}
export async function scheduleHistorySync(connection: Connection, options: { force?: boolean; reconnected?: boolean } = {}) {
  if (connection.status !== "CONNECTED" || !connection.phone || connection.expiresAt && connection.expiresAt < new Date()) return null;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"history:" + connection.id}))`;
    const scope = { connectionId: connection.id, accountPhone: connection.phone! };
    const existing = await tx.whatsAppHistorySync.findFirst({ where: { ...scope, instanceId: connection.instanceId, status: { in: activeStatuses } }, orderBy: { createdAt: "desc" } });
    if (existing) return existing;
    const recent = await tx.whatsAppHistorySync.findFirst({ where: { ...scope, instanceId: connection.instanceId }, orderBy: { createdAt: "desc" } });
    if (!options.force && recent && (Date.now() - recent.createdAt.getTime() < (options.reconnected ? 30000 : 300000))) return recent;
    const completed = await tx.whatsAppHistorySync.findFirst({ where: { ...scope, status: "COMPLETED" }, orderBy: { until: "desc" } });
    const legacy = !completed && !connection.lastDisconnectedAt ? await tx.serviceMessage.findFirst({ where: {
      ticket: { organizationId: connection.organizationId, source: "WHATSAPP_API" },
      AND: [{ providerMetadata: { path: ["connectionId"], equals: connection.id } }, { NOT: { providerMetadata: { path: ["instanceId"], equals: connection.instanceId } } }],
    }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }) : null;
    const anchor = completed?.until || connection.lastDisconnectedAt || legacy?.receivedAt || new Date(Date.now() - 86400000);
    const since = new Date(Math.max(Date.now() - 90 * 86400000, anchor.getTime() - 300000));
    return tx.whatsAppHistorySync.create({ data: { ...scope, instanceId: connection.instanceId, since } });
  });
}
export async function latestHistorySync(connectionId: string) {
  return prisma.whatsAppHistorySync.findFirst({ where: { connectionId }, orderBy: { createdAt: "desc" }, select: { status: true, queued: true, lastError: true, completedAt: true, since: true } });
}
async function scanHistory(connectionId?: string) {
  const now = new Date();
  const jobs = await prisma.whatsAppHistorySync.findMany({ where: { connectionId, nextRunAt: { lte: now }, attempts: { lt: 5 }, OR: [{ status: { in: ["PENDING", "FAILED"] } }, { status: "RUNNING", claimedAt: { lt: new Date(Date.now() - 300000) } }] }, orderBy: { createdAt: "asc" }, take: 2 });
  for (const job of jobs) {
    const claimed = await prisma.whatsAppHistorySync.updateMany({ where: { id: job.id, status: job.status, attempts: job.attempts }, data: { status: "RUNNING", claimedAt: now } });
    if (!claimed.count) continue;
    try {
      const connection = await prisma.whatsAppConnection.findUnique({ where: { id: job.connectionId } });
      if (!connection || connection.instanceId !== job.instanceId || connection.phone !== job.accountPhone) {
        await prisma.whatsAppHistorySync.update({ where: { id: job.id }, data: { status: "CANCELLED", completedAt: new Date() } }); continue;
      }
      if (connection.status !== "CONNECTED" || connection.expiresAt && connection.expiresAt < now) {
        await prisma.whatsAppHistorySync.update({ where: { id: job.id }, data: { status: "PENDING", nextRunAt: new Date(Date.now() + 60000) } }); continue;
      }
      const token = decryptIntegrationSecret(connection.tokenEncrypted);
      if (!job.offset) await configureWebhook(connection);
      const chats = object(await uazapiRequest(connection.serverUrl, token, "/chat/find", { compact: true, limit: 200, offset: 0, sort: "-wa_lastMsgTimestamp" }).catch(() => ({})));
      const names: Record<string, string> = {};
      if (Array.isArray(chats.chats)) for (const chat of chats.chats.map(object)) names[text(chat.wa_chatid)] = text(chat.name || chat.wa_contactName || chat.wa_name, 250);
      let offset = job.offset;
      for (let page = 0; page < 3; page++) {
        const result = historyPage(await uazapiRequest(connection.serverUrl, token, "/message/find", { limit: 200, offset }), offset, job.since);
        const events = normalizeUazapiHistory({ EventType: "history", event: "messages", messages: result.messages }, names).filter((event) => milliseconds(event.timestamp) >= job.since.getTime());
        const queued = await enqueueUazapiHistory(connection, events);
        offset = result.nextOffset;
        await prisma.whatsAppHistorySync.update({ where: { id: job.id }, data: { offset, queued: { increment: queued }, lastError: null, attempts: 0, ...(result.done ? { status: "IMPORTING" } : {}) } });
        if (result.done) break;
        if (page === 2) await prisma.whatsAppHistorySync.update({ where: { id: job.id }, data: { status: "PENDING", nextRunAt: new Date() } });
      }
    } catch (error) {
      const message = error instanceof Error && /^(A Uazapi|Formato inesperado|A paginação)/.test(error.message) ? error.message : "Não foi possível concluir a recuperação do histórico. Nova tentativa agendada.";
      await prisma.whatsAppHistorySync.update({ where: { id: job.id }, data: { status: "FAILED", attempts: { increment: 1 }, lastError: message, nextRunAt: new Date(Date.now() + 60000) } });
    }
  }
}
async function finishHistory(connectionId?: string) {
  const jobs = await prisma.whatsAppHistorySync.findMany({ where: { connectionId, status: "IMPORTING" }, take: 10 });
  for (const job of jobs) {
    const scope = { connectionId: job.connectionId, eventType: "messages", AND: [{ payload: { path: ["instanceId"], equals: job.instanceId } }, { payload: { path: ["event", "historical"], equals: true } }] };
    const pending = await prisma.whatsAppWebhookInbox.count({ where: { ...scope, status: { not: "COMPLETED" } } });
    const dead = pending ? await prisma.whatsAppWebhookInbox.count({ where: { ...scope, status: "FAILED", attempts: { gte: 5 } } }) : 0;
    if (dead) {
      await prisma.whatsAppHistorySync.update({ where: { id: job.id }, data: { status: "FAILED", attempts: 5, lastError: "Algumas mensagens não puderam ser importadas. Use Atualizar conversas para tentar novamente." } }); continue;
    }
    if (!pending) {
      await prisma.whatsAppHistorySync.update({ where: { id: job.id }, data: { status: "COMPLETED", completedAt: new Date(), lastError: null } });
      await prisma.whatsAppConnection.updateMany({ where: { id: job.connectionId, instanceId: job.instanceId, phone: job.accountPhone, status: "CONNECTED" }, data: { lastDisconnectedAt: null } });
    }
  }
}
export async function processWhatsAppHistory(connectionId?: string) {
  const deadline = Date.now() + 75000;
  await scanHistory(connectionId);
  for (let round = 0; round < 4 && Date.now() < deadline; round++) { const count = await drainUazapiInbox(connectionId); if (count < 200) break; }
  await finishHistory(connectionId);
}
export async function scheduleConnectedHistory() {
  const connections = await prisma.whatsAppConnection.findMany({ where: { status: "CONNECTED", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, take: 20 });
  for (const connection of connections) await scheduleHistorySync(connection);
}
