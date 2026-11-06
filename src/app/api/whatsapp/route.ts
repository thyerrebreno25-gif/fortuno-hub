import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { unreadCounts, latestConversationDirections } from "@/modules/whatsapp/read-state";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  getServiceCenterMember,
  getWhatsAppPermission,
} from "@/modules/atendimento/auth";
import {
  average,
  minutesBetween,
  parseWhatsappChannelAddress,
} from "@/modules/whatsapp/core";
import { inboxFacets, inboxWhere, type InboxFilters } from "@/modules/whatsapp/inbox-filters";


export async function GET(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getWhatsAppPermission(
    member.organizationId,
    member.role,
  );
  if (!permission.canView) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "GENERAL";
  const search = url.searchParams.get("search")?.trim() || "";
  const kind = url.searchParams.get("kind") || "ALL";
  const status = url.searchParams.get("status") || "ALL";
  if (!["GENERAL", "MINE", "QUEUE"].includes(view) || !["ALL", "GROUP", "CONTACT"].includes(kind) || !["ALL", "OPEN", "RESOLVED"].includes(status)) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  const filters = { view, kind, status } as InboxFilters;
  const baseWhere: Prisma.ServiceTicketWhereInput = {
    ...(await currentWhatsAppAccount(member.organizationId)).where,
    isSpam: false,
    mergedIntoId: null,
    status: { notIn: ["SPAM"] },
  };
  const where: Prisma.ServiceTicketWhereInput = { ...baseWhere, ...inboxWhere(filters, member.userId) };

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { senderName: { contains: search, mode: "insensitive" } },
      { senderEmail: { contains: search, mode: "insensitive" } },
      { snippet: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  if (url.searchParams.get("light") === "1") {
    const filteredUnread = url.searchParams.get("unread") === "1" ? await unreadCounts(member.organizationId, member.userId) : null;
    if (filteredUnread) where.AND = [{ id: { in: [...filteredUnread.keys()] } }];
    const [rows, metrics, unread] = await Promise.all([
      prisma.serviceTicket.findMany({where,orderBy:[{lastMessageAt:"desc"},{receivedAt:"desc"}],take:251,select:{id:true,subject:true,senderName:true,senderEmail:true,snippet:true,status:true,routingArea:true,routingReason:true,priority:true,assignedAt:true,receivedAt:true,resolvedAt:true,firstResponseAt:true,lastMessageAt:true,updatedAt:true,client:{select:{id:true,name:true}},assignedTo:{select:{id:true,name:true,email:true}}}}),
      prisma.serviceTicket.findMany({where:baseWhere,take:2000,orderBy:{receivedAt:"desc"},select:{assignedToId:true,status:true,senderEmail:true}}),
      filteredUnread || unreadCounts(member.organizationId, member.userId),
    ]);
    const directions = await latestConversationDirections(member.organizationId, rows.slice(0,250).map(ticket => ticket.id));
    const active=metrics.filter(ticket=>!["RESOLVED","SPAM"].includes(ticket.status));
    return NextResponse.json({hasMore:rows.length>250,tickets:rows.slice(0,250).map(ticket=>({...ticket,lastDirection:directions.get(ticket.id)||null,unreadCount:unread.get(ticket.id)||0,channel:parseWhatsappChannelAddress(ticket.senderEmail)})),stats:{facets:inboxFacets(metrics,filters,member.userId),general:metrics.length,active:active.length,mine:active.filter(ticket=>ticket.assignedToId===member.userId).length,queue:active.filter(ticket=>!ticket.assignedToId).length}});
  }

  const [tickets, metricTickets, satisfactionHistory] = await Promise.all([
    prisma.serviceTicket.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { receivedAt: "desc" }],
      take: 251,
      select: {
        id: true,
        subject: true,
        senderName: true,
        senderEmail: true,
        snippet: true,
        status: true,
        routingArea: true,
        routingReason: true,
        priority: true,
        assignedAt: true,
        receivedAt: true,
        resolvedAt: true,
        firstResponseAt: true,
        lastMessageAt: true,
        updatedAt: true,
        client: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
          where: { direction: { not: "INTERNAL" } },
          orderBy: { receivedAt: "desc" },
          take: 1,
          select: { direction: true },
        },
        _count: { select: { messages: true } },
      },
    }),
    prisma.serviceTicket.findMany({
      where: baseWhere,
      take: 2000,
      orderBy: { receivedAt: "desc" },
      select: {
        assignedToId: true,
        assignedAt: true,
        receivedAt: true,
        firstResponseAt: true,
        resolvedAt: true,
        status: true,
        senderEmail: true,
        messages: {
          where: { direction: { not: "INTERNAL" } },
          orderBy: { receivedAt: "desc" },
          take: 1,
          select: { direction: true },
        },
      },
    }),
    prisma.serviceTicketHistory.findMany({
      where: {
        type: "WHATSAPP_SATISFACTION",
        ticket: baseWhere,
      },
      take: 2000,
      select: { metadata: true },
    }),
  ]);

  const active = metricTickets.filter(
    (ticket) => !["RESOLVED", "SPAM"].includes(ticket.status),
  );
  const satisfactionScores = satisfactionHistory
    .map((item) => {
      const metadata = item.metadata as { score?: unknown } | null;
      return typeof metadata?.score === "number" ? metadata.score : null;
    })
    .filter((score): score is number => score !== null);

  return NextResponse.json({
    hasMore: tickets.length > 250,
    tickets: tickets.slice(0, 250).map((ticket) => ({
      ...ticket,
      channel: parseWhatsappChannelAddress(ticket.senderEmail),
      lastDirection: ticket.messages[0]?.direction || null,
      messages: undefined,
    })),
    stats: {
      facets: inboxFacets(metricTickets, filters, member.userId),
      general: metricTickets.length,
      active: active.length,
      mine: active.filter((ticket) => ticket.assignedToId === member.userId)
        .length,
      queue: active.filter((ticket) => !ticket.assignedToId).length,
      waitingResponse: active.filter(
        (ticket) => ticket.messages[0]?.direction === "INBOUND",
      ).length,
      averageQueueMinutes: average(
        metricTickets.map((ticket) =>
          minutesBetween(ticket.receivedAt, ticket.assignedAt),
        ),
      ),
      averageFirstResponseMinutes: average(
        metricTickets.map((ticket) =>
          minutesBetween(ticket.receivedAt, ticket.firstResponseAt),
        ),
      ),
      averageHandlingMinutes: average(
        metricTickets.map((ticket) =>
          minutesBetween(ticket.firstResponseAt, ticket.resolvedAt),
        ),
      ),
      satisfaction:
        satisfactionScores.length > 0
          ? Number(
              (
                satisfactionScores.reduce((sum, score) => sum + score, 0) /
                satisfactionScores.length
              ).toFixed(1),
            )
          : null,
      satisfactionResponses: satisfactionScores.length,
    },
  });
}

export async function POST() {
  return NextResponse.json({error:"A simulação de mensagens foi desativada. A Central utiliza somente dados reais do WhatsApp."},{status:410});
}
