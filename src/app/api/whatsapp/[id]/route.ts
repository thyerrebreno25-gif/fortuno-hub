import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getServiceCenterPermission,
  SERVICE_CENTER_MANAGER_ROLES,
} from "@/modules/atendimento/auth";
import {
  parseWhatsappChannelAddress,
  responsibleForRoutingArea,
  type WhatsAppRoutingArea,
} from "@/modules/whatsapp/core";
import { getWhatsappTicket } from "@/modules/whatsapp/server";

type Context = { params: Promise<{ id: string }> };

const VALID_AREAS = new Set([
  "ACCOUNTS_PAYABLE",
  "ACCOUNTS_RECEIVABLE",
  "GENERAL",
  "UNKNOWN",
]);

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
  const ticket = await getWhatsappTicket(id, member.organizationId);
  return ticket
    ? NextResponse.json({ ticket })
    : NextResponse.json(
        { error: "Atendimento não encontrado." },
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
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id } = await context.params;
  const current = await getWhatsappTicket(id, member.organizationId);
  if (!current) {
    return NextResponse.json(
      { error: "Atendimento não encontrado." },
      { status: 404 },
    );
  }

  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action || "");
  const canManage =
    permission.canManage || SERVICE_CENTER_MANAGER_ROLES.has(member.role);
  const occupiedByAnother =
    current.assignedToId && current.assignedToId !== member.userId;

  if (action === "assign") {
    let assignedToId =
      typeof body.assignedToId === "string" && body.assignedToId
        ? body.assignedToId
        : member.userId;

    if (!canManage) assignedToId = member.userId;

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: member.organizationId, userId: assignedToId },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "Colaborador inválido." },
        { status: 400 },
      );
    }

    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id },
        data: {
          assignedToId,
          assignedAt: new Date(),
          status: current.status === "NEW" ? "IN_PROGRESS" : current.status,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_ASSIGNED",
          message:
            assignedToId === member.userId
              ? "Atendimento assumido pelo colaborador."
              : "Atendimento direcionado a outro colaborador.",
          metadata: { assignedToId },
        },
      }),
    ]);
  } else if (action === "client") {
    const clientId = String(body.clientId || "");
    if (!clientId) {
      return NextResponse.json(
        { error: "Selecione um cliente." },
        { status: 400 },
      );
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: member.organizationId, active: true },
      select: {
        id: true,
        serviceSquad: true,
        operationLeaderId: true,
        payableResponsibleId: true,
        receivableResponsibleId: true,
        generalResponsibleId: true,
      },
    });
    if (!client) {
      return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
    }

    const channel = parseWhatsappChannelAddress(current.senderEmail);
    const automaticAssignee = responsibleForRoutingArea(
      client,
      current.routingArea,
    );
    const assignedToId = current.assignedToId || automaticAssignee;

    await prisma.$transaction([
      prisma.clientWhatsAppIdentity.upsert({
        where: {
          organizationId_clientId_kind_externalId: {
            organizationId: member.organizationId,
            clientId,
            kind: channel.kind,
            externalId: channel.externalId,
          },
        },
        create: {
          organizationId: member.organizationId,
          clientId,
          kind: channel.kind,
          externalId: channel.externalId,
          displayName: current.senderName,
        },
        update: { active: true, displayName: current.senderName },
      }),
      prisma.serviceTicket.update({
        where: { id },
        data: {
          clientId,
          routingSquad: client.serviceSquad,
          routingReason: "Cliente vinculado manualmente ao WhatsApp.",
          routingConfidence: 100,
          assignedToId,
          assignedAt: assignedToId ? current.assignedAt || new Date() : null,
          status: assignedToId && current.status === "NEW" ? "IN_PROGRESS" : current.status,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_CLIENT_LINKED",
          message: "Contato do WhatsApp vinculado ao cliente.",
          metadata: { clientId, channel },
        },
      }),
    ]);
  } else if (action === "routingArea") {
    const requestedArea = String(body.routingArea || "UNKNOWN");
    if (!VALID_AREAS.has(requestedArea)) {
      return NextResponse.json({ error: "Área inválida." }, { status: 400 });
    }
    const routingArea = requestedArea as WhatsAppRoutingArea;
    let automaticAssignee: string | null = null;

    if (current.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: current.clientId },
        select: {
          operationLeaderId: true,
          payableResponsibleId: true,
          receivableResponsibleId: true,
          generalResponsibleId: true,
        },
      });
      if (client) automaticAssignee = responsibleForRoutingArea(client, routingArea);
    }

    const assignedToId = current.assignedToId || automaticAssignee;
    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id },
        data: {
          routingArea,
          assignedToId,
          assignedAt: assignedToId ? current.assignedAt || new Date() : null,
          status: assignedToId && current.status === "NEW" ? "IN_PROGRESS" : current.status,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_AREA_CHANGED",
          message: "Área do atendimento atualizada.",
          metadata: { routingArea, automaticAssignee },
        },
      }),
    ]);
  } else if (action === "reply") {
    if (occupiedByAnother && !canManage) {
      return NextResponse.json(
        { error: "Este atendimento está com outro colaborador." },
        { status: 403 },
      );
    }
    const content = String(body.content || "").trim();
    if (!content) {
      return NextResponse.json({ error: "Escreva uma resposta." }, { status: 400 });
    }
    if (current.status === "RESOLVED") {
      return NextResponse.json(
        { error: "O atendimento foi finalizado. Aguarde uma nova mensagem do cliente." },
        { status: 400 },
      );
    }

    const now = new Date();
    const assignedToId = current.assignedToId || member.userId;
    await prisma.$transaction([
      prisma.serviceMessage.create({
        data: {
          ticketId: id,
          direction: "OUTBOUND",
          fromName: member.user.name || member.user.email,
          fromEmail: member.user.email,
          toEmails: [current.senderEmail],
          textBody: content,
          receivedAt: now,
        },
      }),
      prisma.serviceTicket.update({
        where: { id },
        data: {
          assignedToId,
          assignedAt: current.assignedAt || now,
          firstResponseAt: current.firstResponseAt || now,
          lastMessageAt: now,
          snippet: content.slice(0, 220),
          status: "IN_PROGRESS",
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_REPLIED",
          message: "Resposta enviada no ambiente de teste.",
        },
      }),
    ]);
  } else if (action === "finalize") {
    if (occupiedByAnother && !canManage) {
      return NextResponse.json(
        { error: "Este atendimento está com outro colaborador." },
        { status: 403 },
      );
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id },
        data: { status: "RESOLVED", resolvedAt: now },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_RESOLVED",
          message: "Atendimento finalizado.",
        },
      }),
    ]);
  } else if (action === "satisfaction") {
    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json(
        { error: "A nota deve estar entre 1 e 5." },
        { status: 400 },
      );
    }
    await prisma.serviceTicketHistory.create({
      data: {
        ticketId: id,
        userId: member.userId,
        type: "WHATSAPP_SATISFACTION",
        message: `Satisfação registrada: ${score}/5.`,
        metadata: { score, comment: String(body.comment || "").trim() || null },
      },
    });
  } else {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  return NextResponse.json({
    ticket: await getWhatsappTicket(id, member.organizationId),
  });
}
