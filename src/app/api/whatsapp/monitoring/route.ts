import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getWhatsAppPermission,
} from "@/modules/atendimento/auth";
import {
  average,
  minutesBetween,
  WHATSAPP_SOURCES,
} from "@/modules/whatsapp/core";

const TIME_ZONE = "America/Sao_Paulo";
const areaLabels: Record<string, string> = {
  ACCOUNTS_PAYABLE: "Contas a pagar",
  ACCOUNTS_RECEIVABLE: "Contas a receber",
  GENERAL: "Atendimento geral",
  UNKNOWN: "Não identificado",
};

function parseStart(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00-03:00`);
  }
  const date = new Date();
  date.setDate(date.getDate() - 29);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseEnd(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999-03:00`);
  }
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shortDate(key: string) {
  const [, month, day] = key.split("-");
  return `${day}/${month}`;
}

function scoreFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const score = (metadata as { score?: unknown }).score;
  return typeof score === "number" && score >= 1 && score <= 5
    ? score
    : null;
}

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
  const start = parseStart(url.searchParams.get("from"));
  const end = parseEnd(url.searchParams.get("to"));
  const clientId = url.searchParams.get("clientId") || "";
  const assigneeId = url.searchParams.get("assigneeId") || "";

  if (start > end) {
    return NextResponse.json(
      { error: "A data inicial deve ser anterior à data final." },
      { status: 400 },
    );
  }

  const periodDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
  if (periodDays > 370) {
    return NextResponse.json(
      { error: "Selecione um período de no máximo 12 meses." },
      { status: 400 },
    );
  }

  const organizationMembers = await prisma.organizationMember.findMany({
    where: {
      organizationId: member.organizationId,
      role: { not: "CLIENT" },
    },
    select: {
      user: { select: { id: true, name: true, email: true } },
    },
  });
  const selectedAssignee = assigneeId
    ? organizationMembers.find((item) => item.user.id === assigneeId)?.user
    : null;

  const where = {
    organizationId: member.organizationId,
    source: { in: [...WHATSAPP_SOURCES] },
    isSpam: false,
    mergedIntoId: null,
    receivedAt: { gte: start, lte: end },
    ...(clientId ? { clientId } : {}),
    ...(selectedAssignee
      ? {
          OR: [
            { assignedToId: selectedAssignee.id },
            {
              messages: {
                some: {
                  direction: "OUTBOUND" as const,
                  fromEmail: {
                    equals: selectedAssignee.email,
                    mode: "insensitive" as const,
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [tickets, satisfactionHistory] = await Promise.all([
    prisma.serviceTicket.findMany({
      where,
      orderBy: { receivedAt: "asc" },
      take: 10000,
      select: {
        id: true,
        subject: true,
        senderName: true,
        status: true,
        routingArea: true,
        receivedAt: true,
        assignedAt: true,
        firstResponseAt: true,
        resolvedAt: true,
        lastMessageAt: true,
        client: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
          orderBy: { receivedAt: "asc" },
          select: {
            direction: true,
            fromEmail: true,
            receivedAt: true,
          },
        },
      },
    }),
    prisma.serviceTicketHistory.findMany({
      where: {
        type: "WHATSAPP_SATISFACTION",
        ticket: where,
      },
      orderBy: { createdAt: "desc" },
      take: 10000,
      select: { ticketId: true, metadata: true },
    }),
  ]);

  const latestScoreByTicket = new Map<string, number>();
  for (const item of satisfactionHistory) {
    if (latestScoreByTicket.has(item.ticketId)) continue;
    const score = scoreFromMetadata(item.metadata);
    if (score !== null) latestScoreByTicket.set(item.ticketId, score);
  }

  const now = new Date();
  const active = tickets.filter(
    (ticket) => !["RESOLVED", "SPAM"].includes(ticket.status),
  );
  const queue = active.filter((ticket) => !ticket.assignedTo);
  const completed = tickets.filter((ticket) => ticket.status === "RESOLVED");
  const firstResponseValues = tickets.map((ticket) =>
    minutesBetween(ticket.receivedAt, ticket.firstResponseAt),
  );
  const handlingValues = tickets.map((ticket) =>
    minutesBetween(ticket.firstResponseAt, ticket.resolvedAt),
  );
  const queueValues = tickets.map((ticket) =>
    minutesBetween(ticket.receivedAt, ticket.assignedAt),
  );
  const responseWaits: number[] = [];

  for (const ticket of tickets) {
    ticket.messages.forEach((message, index) => {
      if (message.direction !== "INBOUND") return;
      const response = ticket.messages
        .slice(index + 1)
        .find((next) => next.direction === "OUTBOUND");
      if (response) {
        const wait = minutesBetween(message.receivedAt, response.receivedAt);
        if (wait !== null) responseWaits.push(wait);
      }
    });
  }

  const currentWaits = active
    .map((ticket) => {
      const last = ticket.messages.at(-1);
      return last?.direction === "INBOUND"
        ? minutesBetween(last.receivedAt, now) || 0
        : 0;
    })
    .filter((value) => value > 0);

  const timelineMap = new Map<
    string,
    { date: string; label: string; received: number; resolved: number; responseValues: number[] }
  >();
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = dateKey(cursor);
    timelineMap.set(key, {
      date: key,
      label: shortDate(key),
      received: 0,
      resolved: 0,
      responseValues: [],
    });
  }
  for (const ticket of tickets) {
    const receivedKey = dateKey(ticket.receivedAt);
    const receivedPoint = timelineMap.get(receivedKey);
    if (receivedPoint) {
      receivedPoint.received += 1;
      const response = minutesBetween(ticket.receivedAt, ticket.firstResponseAt);
      if (response !== null) receivedPoint.responseValues.push(response);
    }
    if (ticket.resolvedAt) {
      const resolvedPoint = timelineMap.get(dateKey(ticket.resolvedAt));
      if (resolvedPoint) resolvedPoint.resolved += 1;
    }
  }
  const timeline = [...timelineMap.values()].map(({ responseValues, ...point }) => ({
    ...point,
    averageResponseMinutes: average(responseValues),
  }));

  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}h`,
    conversations: 0,
  }));
  for (const ticket of tickets) {
    const hour = Number(
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: TIME_ZONE,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(ticket.receivedAt),
    );
    if (hourly[hour]) hourly[hour].conversations += 1;
  }

  const areaMap = new Map<string, number>();
  for (const ticket of tickets) {
    const label = areaLabels[ticket.routingArea] || ticket.routingArea;
    areaMap.set(label, (areaMap.get(label) || 0) + 1);
  }
  const areas = [...areaMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  type Breakdown = {
    id: string;
    name: string;
    conversations: number;
    active: number;
    resolved: number;
    messages: number;
    firstResponses: number[];
    handling: number[];
    scores: number[];
  };
  const clients = new Map<string, Breakdown>();
  const agents = new Map<string, Breakdown>();

  function accumulate(
    map: Map<string, Breakdown>,
    id: string,
    name: string,
    ticket: (typeof tickets)[number],
    outboundMessages = ticket.messages.filter((item) => item.direction === "OUTBOUND").length,
  ) {
    const current = map.get(id) || {
      id,
      name,
      conversations: 0,
      active: 0,
      resolved: 0,
      messages: 0,
      firstResponses: [],
      handling: [],
      scores: [],
    };
    current.conversations += 1;
    current.active += ticket.status === "RESOLVED" ? 0 : 1;
    current.resolved += ticket.status === "RESOLVED" ? 1 : 0;
    current.messages += outboundMessages;
    const first = minutesBetween(ticket.receivedAt, ticket.firstResponseAt);
    const handling = minutesBetween(ticket.firstResponseAt, ticket.resolvedAt);
    const score = latestScoreByTicket.get(ticket.id);
    if (first !== null) current.firstResponses.push(first);
    if (handling !== null) current.handling.push(handling);
    if (score !== undefined) current.scores.push(score);
    map.set(id, current);
  }

  const membersByEmail = new Map(
    organizationMembers.map(({ user }) => [user.email.toLowerCase(), user]),
  );

  for (const ticket of tickets) {
    accumulate(
      clients,
      ticket.client?.id || "unlinked",
      ticket.client?.name || "Sem cliente vinculado",
      ticket,
    );
    const participants = new Map<
      string,
      { id: string; name: string; messages: number }
    >();
    for (const message of ticket.messages) {
      if (message.direction !== "OUTBOUND") continue;
      const user = membersByEmail.get(message.fromEmail.toLowerCase());
      if (!user) continue;
      const participant = participants.get(user.id) || {
        id: user.id,
        name: user.name || user.email,
        messages: 0,
      };
      participant.messages += 1;
      participants.set(user.id, participant);
    }
    if (!participants.size) {
      participants.set(ticket.assignedTo?.id || "queue", {
        id: ticket.assignedTo?.id || "queue",
        name:
          ticket.assignedTo?.name ||
          ticket.assignedTo?.email ||
          "Fila de atendimento",
        messages: 0,
      });
    }
    for (const participant of participants.values()) {
      accumulate(
        agents,
        participant.id,
        participant.name,
        ticket,
        participant.messages,
      );
    }
  }

  const finishBreakdown = (items: Map<string, Breakdown>) =>
    [...items.values()]
      .map(({ firstResponses, handling, scores, ...item }) => ({
        ...item,
        averageFirstResponseMinutes: average(firstResponses),
        averageHandlingMinutes: average(handling),
        satisfaction: scores.length
          ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
          : null,
      }))
      .sort((a, b) => b.conversations - a.conversations);

  const attention = active
    .map((ticket) => {
      const last = ticket.messages.at(-1);
      return {
        id: ticket.id,
        contact: ticket.senderName || ticket.subject,
        client: ticket.client?.name || "Sem cliente",
        assignee:
          ticket.assignedTo?.name || ticket.assignedTo?.email || "Na fila",
        status: ticket.status,
        waitingMinutes:
          last?.direction === "INBOUND"
            ? minutesBetween(last.receivedAt, now) || 0
            : 0,
        lastMessageAt: ticket.lastMessageAt,
      };
    })
    .filter((item) => item.waitingMinutes > 0)
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes)
    .slice(0, 50);

  const scores = [...latestScoreByTicket.values()];
  return NextResponse.json({
    period: { from: start.toISOString(), to: end.toISOString(), days: periodDays },
    summary: {
      conversations: tickets.length,
      active: active.length,
      queue: queue.length,
      completed: completed.length,
      resolutionRate: tickets.length
        ? Math.round((completed.length / tickets.length) * 100)
        : 0,
      averageQueueMinutes: average(queueValues),
      averageFirstResponseMinutes: average(firstResponseValues),
      averageHandlingMinutes: average(handlingValues),
      averageCustomerWaitMinutes: average(responseWaits),
      longestCurrentWaitMinutes: currentWaits.length ? Math.max(...currentWaits) : 0,
      satisfaction: scores.length
        ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
        : null,
      satisfactionResponses: scores.length,
    },
    timeline,
    hourly,
    areas,
    clients: finishBreakdown(clients),
    agents: finishBreakdown(agents),
    attention,
  });
}
