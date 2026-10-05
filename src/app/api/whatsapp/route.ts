import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getServiceCenterPermission,
} from "@/modules/atendimento/auth";
import {
  average,
  minutesBetween,
  parseWhatsappChannelAddress,
  WHATSAPP_SOURCES,
  whatsappChannelAddress,
  type WhatsAppIdentityKind,
  type WhatsAppRoutingArea,
} from "@/modules/whatsapp/core";
import { resolveWhatsappRouting } from "@/modules/whatsapp/server";

const VALID_AREAS = new Set([
  "ACCOUNTS_PAYABLE",
  "ACCOUNTS_RECEIVABLE",
  "GENERAL",
  "UNKNOWN",
]);

export async function GET(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getServiceCenterPermission(
    member.organizationId,
    member.role,
  );
  if (!permission.canView) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "GENERAL";
  const search = url.searchParams.get("search")?.trim() || "";
  const baseWhere = {
    organizationId: member.organizationId,
    source: { in: [...WHATSAPP_SOURCES] },
    isSpam: false,
  };
  const where: Record<string, unknown> = { ...baseWhere };

  if (view === "MINE") {
    where.assignedToId = member.userId;
    where.status = { notIn: ["RESOLVED", "SPAM"] };
  } else if (view === "QUEUE") {
    where.assignedToId = null;
    where.status = { notIn: ["RESOLVED", "SPAM"] };
  }

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { senderName: { contains: search, mode: "insensitive" } },
      { senderEmail: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [tickets, metricTickets, satisfactionHistory] = await Promise.all([
    prisma.serviceTicket.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { receivedAt: "desc" }],
      take: 250,
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
        client: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
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
        messages: {
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
    tickets: tickets.map((ticket) => ({
      ...ticket,
      channel: parseWhatsappChannelAddress(ticket.senderEmail),
      lastDirection: ticket.messages[0]?.direction || null,
      messages: undefined,
    })),
    stats: {
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

export async function POST(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getServiceCenterPermission(
    member.organizationId,
    member.role,
  );
  if (!permission.canCreate) {
    return NextResponse.json(
      { error: "Sem permissão para simular mensagens." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const kind: WhatsAppIdentityKind = body.kind === "GROUP" ? "GROUP" : "CONTACT";
  const displayName = String(body.displayName || "").trim();
  const identifier = String(body.identifier || "").trim();
  const textBody = String(body.message || "").trim();
  const requestedArea = String(body.routingArea || "UNKNOWN");
  const routingArea: WhatsAppRoutingArea = VALID_AREAS.has(requestedArea)
    ? (requestedArea as WhatsAppRoutingArea)
    : "UNKNOWN";
  const requestedClientId =
    typeof body.clientId === "string" && body.clientId ? body.clientId : null;

  if (!displayName || !identifier || !textBody) {
    return NextResponse.json(
      { error: "Nome, contato/grupo e mensagem são obrigatórios." },
      { status: 400 },
    );
  }

  const routing = await resolveWhatsappRouting({
    organizationId: member.organizationId,
    kind,
    identifier,
    routingArea,
    requestedClientId,
  });

  if (!routing.externalId) {
    return NextResponse.json(
      { error: "Informe um telefone ou identificador válido." },
      { status: 400 },
    );
  }

  const address = whatsappChannelAddress(kind, routing.externalId);
  const now = new Date();
  const activeTicket = await prisma.serviceTicket.findFirst({
    where: {
      organizationId: member.organizationId,
      source: { in: [...WHATSAPP_SOURCES] },
      senderEmail: address,
      status: { notIn: ["RESOLVED", "SPAM"] },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const ticket = await prisma.$transaction(async (tx) => {
    if (requestedClientId && routing.clientId) {
      await tx.clientWhatsAppIdentity.upsert({
        where: {
          organizationId_clientId_kind_externalId: {
            organizationId: member.organizationId,
            clientId: routing.clientId,
            kind,
            externalId: routing.externalId,
          },
        },
        create: {
          organizationId: member.organizationId,
          clientId: routing.clientId,
          kind,
          externalId: routing.externalId,
          displayName,
        },
        update: { active: true, displayName },
      });
    }

    if (activeTicket) {
      await tx.serviceMessage.create({
        data: {
          ticketId: activeTicket.id,
          direction: "INBOUND",
          fromName: displayName,
          fromEmail: address,
          textBody,
          receivedAt: now,
        },
      });
      return tx.serviceTicket.update({
        where: { id: activeTicket.id },
        data: {
          senderName: displayName,
          snippet: textBody.slice(0, 220),
          lastMessageAt: now,
          status: activeTicket.assignedToId ? "IN_PROGRESS" : "NEW",
        },
      });
    }

    const created = await tx.serviceTicket.create({
      data: {
        organizationId: member.organizationId,
        clientId: routing.clientId,
        routingArea,
        routingSquad: routing.routingSquad,
        routingConfidence: routing.clientId && !routing.ambiguous ? 100 : 0,
        routingReason: routing.reason,
        assignedToId: routing.assignedToId,
        assignedAt: routing.assignedToId ? now : null,
        externalThreadId: `whatsapp:${routing.externalId}:${now.getTime()}`,
        source: "WHATSAPP_SIMULATOR",
        subject: kind === "GROUP" ? `Grupo ${displayName}` : displayName,
        senderName: displayName,
        senderEmail: address,
        recipientEmail: "Fortuno Hub",
        snippet: textBody.slice(0, 220),
        status: routing.assignedToId ? "IN_PROGRESS" : "NEW",
        receivedAt: now,
        lastMessageAt: now,
      },
    });

    await tx.serviceMessage.create({
      data: {
        ticketId: created.id,
        direction: "INBOUND",
        fromName: displayName,
        fromEmail: address,
        textBody,
        receivedAt: now,
      },
    });
    await tx.serviceTicketHistory.create({
      data: {
        ticketId: created.id,
        userId: member.userId,
        type: "WHATSAPP_INBOUND_CREATED",
        message: routing.assignedToId
          ? "Atendimento recebido e distribuído automaticamente."
          : "Atendimento recebido na fila geral.",
        metadata: {
          kind,
          externalId: routing.externalId,
          routingArea,
          routingReason: routing.reason,
        },
      },
    });
    return created;
  });

  return NextResponse.json({ ticket }, { status: activeTicket ? 200 : 201 });
}
