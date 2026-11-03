import { mailboxScope, mailboxViews } from "@/modules/atendimento/mailbox-scope";
import { emailChannel } from "@/modules/atendimento/email-channel";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activeMailbox, archivedMailbox } from "@/modules/atendimento/mailbox-archive";
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

  if (assignedToId && assignedToId !== member.userId && !canManageTeam) {
    return NextResponse.json(
      { error: "Seu perfil não pode consultar a caixa de outro colaborador." },
      { status: 403 },
    );
  }

  const clientId = url.searchParams.get("clientId")?.trim() || "";
  const page = Number(url.searchParams.get("page") || 1), pageSize = 100;
  if(!mailboxViews.includes(view) || !Number.isSafeInteger(page) || page < 1 || page > 10000 || search.length > 200 || clientId.length > 200) return NextResponse.json({error:"Filtro inválido."},{status:400});
  if(view === "UNASSIGNED" && !canManageTeam) return NextResponse.json({error:"A fila sem responsável é direcionada à gestão."},{status:403});
  const scope = {organizationId:member.organizationId,userId:member.userId,canManage:canManageTeam,view,assignedToId,clientId,search};
  const where = mailboxScope(scope);
  const common = { organizationId: member.organizationId, ...emailChannel, ...activeMailbox, ...(assignedToId ? {assignedToId} : !canManageTeam ? {assignedToId:member.userId} : {}), ...(clientId ? {clientId:clientId === "UNIDENTIFIED" ? null : clientId} : {}) };

  const [tickets, general, mine, unassigned, waiting, resolved, spam, teamCounts, archived, clientGroups, total] =
    await Promise.all([
      prisma.serviceTicket.findMany({
        where,
        orderBy: [
          { lastMessageAt: "desc" },
          { receivedAt: "desc" },
        ],
        take: pageSize,
        skip: (page - 1) * pageSize,
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
        where: { organizationId:member.organizationId,...emailChannel,...activeMailbox, ...(clientId ? {clientId:clientId === "UNIDENTIFIED" ? null : clientId} : {}), status: {not:"SPAM"} },
      }),
      prisma.serviceTicket.count({
        where: {
          ...common,
          assignedToId: member.userId,
          status: { notIn: ["RESOLVED", "SPAM"] },
        },
      }),
      canManageTeam ? prisma.serviceTicket.count({
        where: {
          ...common,
          assignedToId: null,
          status: { notIn: ["RESOLVED", "SPAM"] },
        },
      }) : Promise.resolve(0),
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
      prisma.serviceTicket.count({ where: { ...common, ...archivedMailbox } }),
      prisma.serviceTicket.groupBy({by:["clientId"],where:mailboxScope({...scope,clientId:""}),_count:{_all:true}}),
      prisma.serviceTicket.count({where}),
    ]);

  const byMember = Object.fromEntries(
    teamCounts
      .filter((item) => item.assignedToId)
      .map((item) => [item.assignedToId as string, item._count._all]),
  );

  return NextResponse.json({
    tickets, page, pageSize, total,
    clientCounts: Object.fromEntries(clientGroups.map(item=>[item.clientId || "UNIDENTIFIED",item._count._all])),
    stats: { general, mine, unassigned, waiting, resolved, spam, byMember, archived },
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
