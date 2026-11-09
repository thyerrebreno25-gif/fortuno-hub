import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
import { summarizeAssignments } from "@/modules/whatsapp/management-types";
export async function GET(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!canViewWhatsAppManagement(member.role, permission.canView)) return NextResponse.json({ error: "Acesso restrito à gestão." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const status = params.get("status") || "OPEN";
  const assignee = params.get("assignee") || "ALL";
  const page = Number(params.get("page") || "1");
  const search = (params.get("search") || "").trim();
  if (!["OPEN", "RESOLVED", "ALL"].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || assignee.length > 200 || search.length > 200) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  const account = await currentWhatsAppAccount(member.organizationId);
  const base: Prisma.ServiceTicketWhereInput = { ...account.where, mergedIntoId: null, isSpam: false, status: { not: "SPAM" } };
  const where: Prisma.ServiceTicketWhereInput = { ...base, ...(status === "OPEN" ? { status: { notIn: ["SPAM", "RESOLVED"] } } : status === "RESOLVED" ? { status: "RESOLVED" } : {}), ...(assignee !== "ALL" ? { assignedToId: assignee === "QUEUE" ? null : assignee } : {}) };
  if (search) where.OR = [{ senderName: { contains: search, mode: "insensitive" } }, { subject: { contains: search, mode: "insensitive" } }, { client: { name: { contains: search, mode: "insensitive" } } }, { senderEmail: { contains: search, mode: "insensitive" } }];
  const pageSize = 50;
  const [groups, members, tickets, total] = await Promise.all([
    prisma.serviceTicket.groupBy({ by: ["assignedToId", "status"], where: base, _count: { _all: true } }),
    prisma.organizationMember.findMany({ where: { organizationId: member.organizationId, role: { not: "CLIENT" } }, select: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.serviceTicket.findMany({ where, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, subject: true, senderName: true, senderEmail: true, snippet: true, status: true, lastMessageAt: true, receivedAt: true, client: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true, email: true } } } }),
    prisma.serviceTicket.count({ where }),
  ]);
  const people = members.map(item => item.user);
  const known = new Set(people.map(person => person.id));
  const formerIds = [...new Set(groups.map(group => group.assignedToId).filter((id): id is string => Boolean(id && !known.has(id))))];
  if (formerIds.length) people.push(...await prisma.user.findMany({ where: { id: { in: formerIds } }, select: { id: true, name: true, email: true } }));
  const scope = Prisma.sql`t."organizationId"=${member.organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${account.recipient || "disconnected"} AND t."mergedIntoId" IS NULL AND t."isSpam"=false AND t.status::text <> 'SPAM'`;
  const [cardIds, areaGroups, clientGroups, presence, averages] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM (SELECT t.id, ROW_NUMBER() OVER (PARTITION BY t."assignedToId", CASE WHEN t."assignedToId" IS NULL THEN t."routingArea"::text ELSE 'ASSIGNED' END ORDER BY t."lastMessageAt" DESC,t.id DESC) AS position FROM "ServiceTicket" t WHERE ${scope} AND t.status::text <> 'RESOLVED') ranked WHERE position <= 20`),
    prisma.serviceTicket.groupBy({ by: ["routingArea", "status", "assignedToId"], where: base, _count: { _all: true } }),
    prisma.serviceTicket.groupBy({ by: ["clientId", "status"], where: base, _count: { _all: true } }),
    prisma.whatsAppOperatorPreference.findMany({ where: { organizationId: member.organizationId, userId: { in: people.map(p => p.id) } }, select: { userId: true, lastSeenAt: true } }),
    prisma.$queryRaw<Array<{ averageFirstResponseSeconds: number | null; averageResolutionSeconds: number | null; firstResponseSample: number; resolutionSample: number }>>(Prisma.sql`SELECT AVG(EXTRACT(EPOCH FROM (t."firstResponseAt"-t."receivedAt"))) FILTER(WHERE t."firstResponseAt">=t."receivedAt")::float8 AS "averageFirstResponseSeconds", AVG(EXTRACT(EPOCH FROM (t."resolvedAt"-t."receivedAt"))) FILTER(WHERE t."resolvedAt">=t."receivedAt")::float8 AS "averageResolutionSeconds", COUNT(*) FILTER(WHERE t."firstResponseAt">=t."receivedAt")::int AS "firstResponseSample", COUNT(*) FILTER(WHERE t."resolvedAt">=t."receivedAt")::int AS "resolutionSample" FROM "ServiceTicket" t WHERE ${scope}`),
  ]);
  const ids = cardIds.map(c => c.id);
  const [cards, clientNames, unread] = await Promise.all([
    prisma.serviceTicket.findMany({ where: { ...base, id: { in: ids } }, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], select: { id: true, subject: true, senderName: true, senderEmail: true, snippet: true, status: true, routingArea: true, assignedToId: true, lastMessageAt: true, receivedAt: true, client: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true, email: true } } } }),
    prisma.client.findMany({ where: { organizationId: member.organizationId, id: { in: clientGroups.map(c => c.clientId).filter((id): id is string => !!id) } }, select: { id: true, name: true } }),
    ids.length ? prisma.$queryRaw<Array<{ ticketId: string; count: number }>>(Prisma.sql`SELECT t.id AS "ticketId", COUNT(m.id)::int AS count FROM "ServiceTicket" t JOIN "ServiceMessage" m ON m."ticketId"=t.id LEFT JOIN "WhatsAppOperationStart" baseline ON baseline."organizationId"=t."organizationId" AND baseline."accountRecipient"=t."recipientEmail" LEFT JOIN "WhatsAppReadState" r ON r."ticketId"=t.id AND r."organizationId"=t."organizationId" AND r."userId"=COALESCE(t."assignedToId",${member.userId}) WHERE ${scope} AND t.id IN (${Prisma.join(ids)}) AND m.direction::text='INBOUND' AND (baseline."startedAt" IS NULL OR m."receivedAt">baseline."startedAt") AND (m."providerMetadata"->>'accountPhone'=${account.connection?.phone || "disconnected"} OR m."externalMessageId" LIKE ${`uazapi:${account.connection?.phone}:%`}) AND (r."ticketId" IS NULL OR (m."receivedAt",m.id)>(r."readAt",r."lastMessageId")) GROUP BY t.id`) : [],
  ]);
  const portraits=people.map(p=>({id:p.id,avatar:`/api/whatsapp/team/${encodeURIComponent(p.id)}/avatar`}));
  const areaTotals = new Map<string, { area: string; total: number; open: number; resolved: number; queue: number }>();
  for (const g of areaGroups) { const row = areaTotals.get(g.routingArea) || { area: g.routingArea, total: 0, open: 0, resolved: 0, queue: 0 }; row.total += g._count._all; row[g.status === "RESOLVED" ? "resolved" : "open"] += g._count._all; if(g.status!=="RESOLVED"&&!g.assignedToId)row.queue+=g._count._all;areaTotals.set(g.routingArea, row); }
  const clientTotals = new Map<string, { id: string | null; name: string; total: number; open: number; resolved: number }>();
  for (const g of clientGroups) { const key = g.clientId || "NONE", row = clientTotals.get(key) || { id: g.clientId, name: clientNames.find(c => c.id === g.clientId)?.name || "Sem cliente vinculado", total: 0, open: 0, resolved: 0 }; row.total += g._count._all; row[g.status === "RESOLVED" ? "resolved" : "open"] += g._count._all; clientTotals.set(key, row); }
  const unreadMap = new Map(unread.map(r => [r.ticketId, r.count]));
  return NextResponse.json({ ...summarizeAssignments(groups, people), cards: cards.map(c => ({ ...c, unreadCount: unreadMap.get(c.id) || 0 })), areas: [...areaTotals.values()], clients: [...clientTotals.values()].sort((a,b) => b.open-a.open || a.name.localeCompare(b.name,"pt-BR")), presence, portraits, metrics: averages[0] || { averageFirstResponseSeconds: null, averageResolutionSeconds: null, firstResponseSample: 0, resolutionSample: 0 }, tickets, total, page, pageSize, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
