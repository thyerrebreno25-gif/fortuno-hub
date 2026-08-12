import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getServiceCenterPermission,
  SERVICE_CENTER_MANAGER_ROLES,
} from "@/modules/atendimento/auth";

type Context = { params: Promise<{ id: string }> };

async function getTicket(id: string, organizationId: string) {
  return prisma.serviceTicket.findFirst({
    where: { id, organizationId },
    include: {
      client: { select: { id: true, name: true } },
      assignedTo: {
        select: { id: true, name: true, email: true },
      },
      messages: {
        orderBy: { receivedAt: "asc" },
        include: { attachments: true },
      },
      history: {
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

export async function GET(_request: Request, context: Context) {
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

  const { id } = await context.params;
  const ticket = await getTicket(id, member.organizationId);

  return ticket
    ? NextResponse.json({ ticket })
    : NextResponse.json(
        { error: "Chamado não encontrado." },
        { status: 404 },
      );
}

export async function PATCH(request: Request, context: Context) {
  const member = await getServiceCenterMember();

  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getServiceCenterPermission(
    member.organizationId,
    member.role,
  );

  if (!permission.canEdit) {
    return NextResponse.json(
      { error: "Sem permissão para atualizar chamados." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const current = await prisma.serviceTicket.findFirst({
    where: { id, organizationId: member.organizationId },
  });

  if (!current) {
    return NextResponse.json(
      { error: "Chamado não encontrado." },
      { status: 404 },
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action || "");
  const canManage =
    permission.canManage ||
    SERVICE_CENTER_MANAGER_ROLES.has(member.role);

  if (action === "assign") {
    let assignedToId =
      typeof body.assignedToId === "string" && body.assignedToId
        ? body.assignedToId
        : null;

    if (!canManage) assignedToId = member.userId;

    if (assignedToId) {
      const membership = await prisma.organizationMember.findFirst({
        where: {
          organizationId: member.organizationId,
          userId: assignedToId,
        },
      });

      if (!membership) {
        return NextResponse.json(
          { error: "Responsável inválido." },
          { status: 400 },
        );
      }
    }

    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id },
        data: {
          assignedToId,
          assignedAt: assignedToId ? new Date() : null,
          status:
            assignedToId && current.status === "NEW"
              ? "IN_PROGRESS"
              : current.status,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "ASSIGNED",
          message: assignedToId
            ? assignedToId === member.userId
              ? "Chamado assumido pelo colaborador."
              : "Chamado reatribuído."
            : "Responsável removido do chamado.",
          metadata: { assignedToId },
        },
      }),
    ]);
  } else if (action === "client") {
    if (!canManage) {
      return NextResponse.json(
        { error: "Apenas gestão pode alterar o cliente." },
        { status: 403 },
      );
    }

    const clientId =
      typeof body.clientId === "string" && body.clientId
        ? body.clientId
        : null;

    let leaderId: string | null = null;

    if (clientId) {
      const client = await prisma.client.findFirst({
        where: {
          id: clientId,
          organizationId: member.organizationId,
        },
        select: { operationLeaderId: true },
      });

      if (!client) {
        return NextResponse.json(
          { error: "Cliente inválido." },
          { status: 400 },
        );
      }

      leaderId = client.operationLeaderId;
    }

    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id },
        data: {
          clientId,
          assignedToId: current.assignedToId || leaderId,
          assignedAt:
            current.assignedToId || leaderId
              ? new Date()
              : current.assignedAt,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "CLIENT_CHANGED",
          message: "Cliente do chamado atualizado.",
          metadata: { clientId, automaticAssignee: leaderId },
        },
      }),
    ]);
  } else if (action === "status") {
    const status = String(body.status || "");
    const valid = [
      "NEW",
      "IN_PROGRESS",
      "WAITING_CUSTOMER",
      "WAITING_INTERNAL",
      "RESOLVED",
      "SPAM",
    ];

    if (!valid.includes(status)) {
      return NextResponse.json(
        { error: "Status inválido." },
        { status: 400 },
      );
    }

    if (
      current.assignedToId &&
      current.assignedToId !== member.userId &&
      !canManage
    ) {
      return NextResponse.json(
        { error: "Este chamado está atribuído a outro colaborador." },
        { status: 403 },
      );
    }

    const selfAssign =
      !current.assignedToId && status !== "SPAM";

    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id },
        data: {
          status: status as
            | "NEW"
            | "IN_PROGRESS"
            | "WAITING_CUSTOMER"
            | "WAITING_INTERNAL"
            | "RESOLVED"
            | "SPAM",
          isSpam: status === "SPAM",
          resolvedAt: status === "RESOLVED" ? new Date() : null,
          assignedToId: selfAssign
            ? member.userId
            : current.assignedToId,
          assignedAt: selfAssign
            ? new Date()
            : current.assignedAt,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "STATUS_CHANGED",
          message: `Status alterado para ${status}.`,
          metadata: { previousStatus: current.status, status },
        },
      }),
    ]);
  } else if (action === "priority") {
    const priority = String(body.priority || "");

    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priority)) {
      return NextResponse.json(
        { error: "Prioridade inválida." },
        { status: 400 },
      );
    }

    await prisma.serviceTicket.update({
      where: { id },
      data: {
        priority: priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      },
    });
  } else if (action === "note") {
    const content = String(body.content || "").trim();

    if (!content) {
      return NextResponse.json(
        { error: "Escreva uma observação." },
        { status: 400 },
      );
    }

    const now = new Date();

    await prisma.$transaction([
      prisma.serviceMessage.create({
        data: {
          ticketId: id,
          direction: "INTERNAL",
          fromName: member.user.name || member.user.email,
          fromEmail: member.user.email,
          textBody: content,
          receivedAt: now,
        },
      }),
      prisma.serviceTicket.update({
        where: { id },
        data: { lastMessageAt: now },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "INTERNAL_NOTE",
          message: "Observação interna adicionada.",
        },
      }),
    ]);
  } else {
    return NextResponse.json(
      { error: "Ação inválida." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ticket: await getTicket(id, member.organizationId),
  });
}
