import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { parseWhatsappChannelAddress } from "./core";
import { object } from "./uazapi";
import type { whatsappConnection } from "./uazapi-server";
type Connection = NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
const include = { messages: { select: { id: true, externalMessageId: true, providerMetadata: true } }, history: { select: { id: true } } } satisfies Prisma.ServiceTicketInclude;
type Candidate = Prisma.ServiceTicketGetPayload<{ include: typeof include }>;
export class MergeConflict extends Error {}
function scope(connection: Connection): Prisma.ServiceTicketWhereInput {
  return { organizationId: connection.organizationId, source: "WHATSAPP_API", mergedIntoId: null, isSpam: false, status: { notIn: ["RESOLVED", "SPAM"] }, OR: [
    { recipientEmail: `wa-account:${connection.id}:${connection.phone}` }, { recipientEmail: { startsWith: `wa-uazapi:${connection.id}:` } },
  ] };
}
export function chooseMerge(tickets: Candidate[], phone: string) {
  const owners = new Set(tickets.map((ticket) => ticket.assignedToId).filter(Boolean));
  const clients = new Set(tickets.map((ticket) => ticket.clientId).filter(Boolean));
  if (owners.size > 1) return { conflict: "Responsáveis diferentes" };
  if (clients.size > 1) return { conflict: "Clientes vinculados diferentes" };
  const ids = new Set<string>();
  for (const ticket of tickets) for (const message of ticket.messages) {
    const account = object(message.providerMetadata).accountPhone;
    if (account && account !== phone) return { conflict: "Histórico de outro número" };
    if (message.externalMessageId) { if (ids.has(message.externalMessageId)) return { conflict: "IDs de mensagem sobrepostos" }; ids.add(message.externalMessageId); }
  }
  const sorted = [...tickets].sort((a, b) => Number(Boolean(b.assignedToId)) - Number(Boolean(a.assignedToId)) || Number(Boolean(b.clientId)) - Number(Boolean(a.clientId)) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return { canonical: sorted[0], sources: sorted.slice(1) };
}
function fingerprint(groups: Array<{ candidates: Candidate[] }>) {
  const state = groups.flatMap((group) => group.candidates.map((ticket) => [ticket.id, ticket.senderEmail, ticket.assignedToId, ticket.clientId, ticket.status])).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}
export async function duplicatePlan(connection: Connection) {
  if (!connection.phone) throw new MergeConflict("Conecte um número antes de identificar os duplicados.");
  const tickets = await prisma.serviceTicket.findMany({ where: scope(connection), include, take: 1001 });
  if (tickets.length > 1000) throw new MergeConflict("Há mais de mil atendimentos ativos. A união precisa ser feita em lotes menores.");
  const byChat = new Map<string, Candidate[]>();
  for (const ticket of tickets) { const rows = byChat.get(ticket.senderEmail) || []; rows.push(ticket); byChat.set(ticket.senderEmail, rows); }
  const groups = [...byChat.values()].filter((candidates) => candidates.length > 1).map((candidates) => ({ candidates, ...chooseMerge(candidates, connection.phone!) }));
  return { groups, fingerprint: fingerprint(groups) };
}
export function planView(plan: Awaited<ReturnType<typeof duplicatePlan>>) {
  return { fingerprint: plan.fingerprint, groups: plan.groups.map((group) => ({ name: group.canonical?.senderName || group.candidates[0].senderName || group.candidates[0].subject, count: group.candidates.length, messages: group.candidates.reduce((sum, item) => sum + item.messages.length, 0), conflict: group.conflict || null, canonicalId: group.canonical?.id || null })) };
}
export function chatLock(connectionId: string, senderEmail: string) {
  const channel = parseWhatsappChannelAddress(senderEmail);
  const chatId = channel.kind === "GROUP" || channel.externalId.endsWith("@lid") ? channel.externalId : channel.externalId + "@s.whatsapp.net";
  return connectionId + chatId;
}
function before(ticket: Candidate) {
  return { id: ticket.id, assignedToId: ticket.assignedToId, clientId: ticket.clientId, status: ticket.status, routingArea: ticket.routingArea, routingSquad: ticket.routingSquad, recipientEmail: ticket.recipientEmail, snippet: ticket.snippet, receivedAt: ticket.receivedAt.toISOString(), lastMessageAt: ticket.lastMessageAt.toISOString(), firstResponseAt: ticket.firstResponseAt?.toISOString() || null, messageIds: ticket.messages.map((item) => item.id), historyIds: ticket.history.map((item) => item.id) };
}
export async function mergeDuplicates(connection: Connection, userId: string, approvedFingerprint: string) {
  const plan = await duplicatePlan(connection);
  if (plan.fingerprint !== approvedFingerprint) throw new MergeConflict("Os atendimentos mudaram desde a prévia. Atualize a prévia antes de confirmar.");
  let merged = 0, messages = 0;
  const skipped: string[] = [];
  for (const group of plan.groups) {
    if (group.conflict) { skipped.push(group.conflict); continue; }
    const result = await prisma.$transaction(async (tx) => {
      const senderEmail = group.candidates[0].senderEmail;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(connection.id, senderEmail)}))`;
      const ids = group.candidates.map((item) => item.id);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ServiceTicket" WHERE "organizationId" = ${connection.organizationId} AND "id" IN (${Prisma.join(ids)}) FOR UPDATE`);
      const current = await tx.serviceTicket.findMany({ where: { ...scope(connection), senderEmail }, include });
      if (current.length !== ids.length || current.some((item) => !ids.includes(item.id))) return { conflict: "Os atendimentos mudaram durante a união" };
      const choice = chooseMerge(current, connection.phone!);
      if (choice.conflict || !choice.canonical || !choice.sources) return { conflict: choice.conflict || "Atendimento indisponível" };
      const canonical = choice.canonical;
      const sources = choice.sources.map((item) => item.id);
      const latest = current.reduce((value, item) => item.lastMessageAt > value.lastMessageAt ? item : value, canonical);
      const receivedAt = new Date(Math.min(...current.map((item) => item.receivedAt.getTime())));
      const firstTimes = current.flatMap((item) => item.firstResponseAt ? [item.firstResponseAt.getTime()] : []);
      const linked = current.find((item) => item.clientId);
      // Audit the original membership before moving any rows. No messages or attachments are deleted.
      await tx.serviceTicketHistory.create({ data: { ticketId: canonical.id, userId, type: "WHATSAPP_DUPLICATES_MERGED", message: `${sources.length + 1} atendimentos reunidos após troca de instância.`, metadata: { canonicalBefore: before(canonical), sourceTickets: choice.sources.map(before) } as Prisma.InputJsonValue } });
      const moved = await tx.serviceMessage.updateMany({ where: { ticketId: { in: sources } }, data: { ticketId: canonical.id } });
      const movedHistory = await tx.serviceTicketHistory.updateMany({ where: { ticketId: { in: sources } }, data: { ticketId: canonical.id } });
      if (moved.count !== choice.sources.reduce((sum, item) => sum + item.messages.length, 0) || movedHistory.count !== choice.sources.reduce((sum, item) => sum + item.history.length, 0)) throw new MergeConflict("Os registros mudaram durante a união. Nenhuma alteração deste grupo foi confirmada.");
      await tx.serviceTicket.updateMany({ where: { id: { in: sources }, organizationId: connection.organizationId, mergedIntoId: null }, data: { mergedIntoId: canonical.id } });
      await tx.serviceTicket.update({ where: { id: canonical.id }, data: { receivedAt, lastMessageAt: latest.lastMessageAt, snippet: latest.snippet, clientId: canonical.clientId || linked?.clientId || null, routingSquad: canonical.routingSquad || linked?.routingSquad || null, firstResponseAt: firstTimes.length ? new Date(Math.min(...firstTimes)) : null, recipientEmail: `wa-account:${connection.id}:${connection.phone}` } });
      return { merged: sources.length, messages: moved.count };
    }, { timeout: 15000 }).catch(() => ({ conflict: "Não foi possível reunir um dos grupos; os registros desse grupo foram preservados." }));
    if ("merged" in result && result.merged !== undefined) { merged += result.merged; messages += result.messages || 0; } else if (result.conflict) skipped.push(result.conflict);
  }
  return { merged, messages, skipped };
}
