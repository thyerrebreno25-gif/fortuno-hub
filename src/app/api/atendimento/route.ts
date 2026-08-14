import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getServiceCenterPermission,
  SERVICE_CENTER_MANAGER_ROLES,
} from "@/modules/atendimento/auth";

const WAITING = ["WAITING_CUSTOMER", "WAITING_INTERNAL"] as const;
const normalizeEmail = (value: string) => value.trim().toLowerCase();

async function resolveRouting(
  organizationId: string,
  senderEmail: string,
  requestedClientId?: string | null,
  requestedAssigneeId?: string | null,
) {
  if (requestedClientId) {
    const client = await prisma.client.findFirst({
      where: {
        id: requestedClientId,
        organizationId,
        active: true,
      },
      select: {
        id: true,
        operationLeaderId: true,
      },
    });

    return {
      clientId: client?.id ?? null,
      assignedToId:
        requestedAssigneeId || client?.operationLeaderId || null,
    };
  }

  const normalizedEmail = normalizeEmail(senderEmail);

  const identity = await prisma.clientEmailIdentity.findFirst({
    where: {
      normalizedEmail,
      active: true,
      client: {
        organizationId,
        active: true,
      },
    },
    select: {
      clientId: true,
      client: {
        select: { operationLeaderId: true },
      },
    },
  });

  if (identity) {
    return {
      clientId: identity.clientId,
      assignedToId:
        requestedAssigneeId ||
        identity.client.operationLeaderId ||
        null,
    };
  }

  const clients = await prisma.client.findMany({
    where: {
      organizationId,
      active: true,
    },
    select: {
      id: true,
      operationalEmail: true,
      operationalEmailCc: true,
      operationLeaderId: true,
    },
  });

  const client = clients.find((item) => {
    const candidates = [
      item.operationalEmail || "",
      ...(item.operationalEmailCc || "").split(","),
    ]
      .map(normalizeEmail)
      .filter(Boolean);

    return candidates.includes(normalizedEmail);
  });

  return {
    clientId: client?.id ?? null,
    assignedToId:
      requestedAssigneeId || client?.operationLeaderId || null,
  };
}

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
  const assignedToId = url.searchParams.get("assignedToId")?.trim() || "";
  const canManageTeam =
    permission.canManage || SERVICE_CENTER_MANAGER_ROLES.has(member.role);

  if (assignedToId && !canManageTeam) {
    return NextResponse.json(
      { error: "Seu perfil não pode consultar a caixa de outro colaborador." },
      { status: 403 },
    );
  }

  const where: any = {
    organizationId: member.organizationId,
  };

  if (view === "MINE") {
    where.assignedToId = member.userId;
    where.status = { notIn: ["RESOLVED", "SPAM"] };
  } else if (view === "UNASSIGNED") {
    where.assignedToId = null;
    where.status = { notIn: ["RESOLVED", "SPAM"] };
  } else if (view === "WAITING") {
    where.status = { in: [...WAITING] };
  } else if (view === "RESOLVED") {
    where.status = "RESOLVED";
  } else if (view === "SPAM") {
    where.status = "SPAM";
  } else {
    where.status = { not: "SPAM" };
  }

  if (assignedToId) {
    where.assignedToId = assignedToId;
    where.status = { not: "SPAM" };
  }

  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { senderEmail: { contains: search, mode: "insensitive" } },
      { senderName: { contains: search, mode: "insensitive" } },
      {
        client: {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
      },
    ];
  }

  const common = { organizationId: member.organizationId };

  const [tickets, general, mine, unassigned, waiting, resolved, spam, teamCounts] =
    await Promise.all([
      prisma.serviceTicket.findMany({
        where,
        orderBy: [
          { lastMessageAt: "desc" },
          { receivedAt: "desc" },
        ],
        take: 250,
        select: {
          id: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          snippet: true,
          status: true,
          priority: true,
          receivedAt: true,
          lastMessageAt: true,
          client: { select: { id: true, name: true } },
          assignedTo: {
            select: { id: true, name: true, email: true },
          },
          _count: { select: { messages: true } },
        },
      }),
      prisma.serviceTicket.count({
        where: { ...common, status: { not: "SPAM" } },
      }),
      prisma.serviceTicket.count({
        where: {
          ...common,
          assignedToId: member.userId,
          status: { notIn: ["RESOLVED", "SPAM"] },
        },
      }),
      prisma.serviceTicket.count({
        where: {
          ...common,
          assignedToId: null,
          status: { notIn: ["RESOLVED", "SPAM"] },
        },
      }),
      prisma.serviceTicket.count({
        where: { ...common, status: { in: [...WAITING] } },
      }),
      prisma.serviceTicket.count({
        where: { ...common, status: "RESOLVED" },
      }),
      prisma.serviceTicket.count({
        where: { ...common, status: "SPAM" },
      }),
      canManageTeam
        ? prisma.serviceTicket.groupBy({
            by: ["assignedToId"],
            where: {
              ...common,
              assignedToId: { not: null },
              status: { not: "SPAM" },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

  const byMember = Object.fromEntries(
    teamCounts
      .filter((item) => item.assignedToId)
      .map((item) => [item.assignedToId as string, item._count._all]),
  );

  return NextResponse.json({
    tickets,
    stats: { general, mine, unassigned, waiting, resolved, spam, byMember },
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
      { error: "Sem permissão para criar chamados." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const subject = String(body.subject || "").trim();
  const senderEmail = normalizeEmail(String(body.senderEmail || ""));
  const senderName = String(body.senderName || "").trim() || null;
  const textBody = String(body.textBody || "").trim();
  const priority = String(body.priority || "MEDIUM");

  if (!subject || !senderEmail || !textBody) {
    return NextResponse.json(
      {
        error:
          "Assunto, e-mail do remetente e mensagem são obrigatórios.",
      },
      { status: 400 },
    );
  }

  const routing = await resolveRouting(
    member.organizationId,
    senderEmail,
    typeof body.clientId === "string" ? body.clientId : null,
    typeof body.assignedToId === "string" ? body.assignedToId : null,
  );

  const now = new Date();

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.serviceTicket.create({
      data: {
        organizationId: member.organizationId,
        clientId: routing.clientId,
        assignedToId: routing.assignedToId,
        assignedAt: routing.assignedToId ? now : null,
        source: "MANUAL",
        subject,
        senderName,
        senderEmail,
        recipientEmail:
          typeof body.recipientEmail === "string"
            ? body.recipientEmail.trim()
            : null,
        snippet: textBody.slice(0, 220),
        priority: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priority)
          ? (priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")
          : "MEDIUM",
        receivedAt: now,
        lastMessageAt: now,
      },
    });

    await tx.serviceMessage.create({
      data: {
        ticketId: created.id,
        direction: "INBOUND",
        fromName: senderName,
        fromEmail: senderEmail,
        toEmails:
          typeof body.recipientEmail === "string"
            ? [body.recipientEmail.trim()]
            : [],
        subject,
        textBody,
        receivedAt: now,
      },
    });

    await tx.serviceTicketHistory.create({
      data: {
        ticketId: created.id,
        userId: member.userId,
        type: "CREATED",
        message: routing.assignedToId
          ? "Chamado criado e direcionado automaticamente."
          : "Chamado criado sem responsável.",
        metadata: {
          source: "MANUAL",
          routedClientId: routing.clientId,
          routedAssigneeId: routing.assignedToId,
        },
      },
    });

    return created;
  });

  return NextResponse.json(
    { message: "Chamado criado.", ticket },
    { status: 201 },
  );
}
