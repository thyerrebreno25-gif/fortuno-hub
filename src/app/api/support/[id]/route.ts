import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSupportMember,
  SUPPORT_MANAGER_ROLES,
} from "@/modules/support/server/support-auth";
import { parseSupportMetadata } from "@/modules/support/types/support.types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const member = await getSupportMember();

    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const { id } = await context.params;
    const canManage = SUPPORT_MANAGER_ROLES.has(member.role);

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        organizationId: member.organizationId,
        ...(canManage ? {} : { userId: member.userId }),
      },
      select: {
        id: true,
        subject: true,
        description: true,
        priority: true,
        status: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json(
        { error: "Chamado não encontrado." },
        { status: 404 },
      );
    }

    const metadata = parseSupportMetadata(ticket.metadata);

    return NextResponse.json({
      id: ticket.id,
      code: `SUP-${ticket.id.slice(-6).toUpperCase()}`,
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      category: metadata.category ?? "Outro",
      module: metadata.module ?? "Geral",
      attachments: metadata.attachments ?? [],
      messages: metadata.messages ?? [],
      technicalContext: metadata.technicalContext ?? null,
      requester: {
        id: ticket.user.id,
        name: ticket.user.name || ticket.user.email,
      },
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      canManage,
    });
  } catch (error) {
    console.error("Erro ao carregar chamado:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar o chamado." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const member = await getSupportMember();

    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    if (!SUPPORT_MANAGER_ROLES.has(member.role)) {
      return NextResponse.json(
        { error: "Você não possui permissão para alterar o chamado." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      status?: unknown;
      priority?: unknown;
    };

    const allowedStatuses = new Set([
      "OPEN",
      "IN_PROGRESS",
      "RESOLVED",
      "CLOSED",
    ]);
    const allowedPriorities = new Set([
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ]);

    const data: {
      status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
      priority?: string;
    } = {};

    if (typeof body.status === "string" && allowedStatuses.has(body.status)) {
      data.status = body.status as typeof data.status;
    }

    if (
      typeof body.priority === "string" &&
      allowedPriorities.has(body.priority)
    ) {
      data.priority = body.priority;
    }

    if (!data.status && !data.priority) {
      return NextResponse.json(
        { error: "Nenhuma alteração válida foi informada." },
        { status: 400 },
      );
    }

    const exists = await prisma.supportTicket.findFirst({
      where: {
        id,
        organizationId: member.organizationId,
      },
      select: { id: true },
    });

    if (!exists) {
      return NextResponse.json(
        { error: "Chamado não encontrado." },
        { status: 404 },
      );
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const ticket = await transaction.supportTicket.update({
        where: { id },
        data,
      });

      await transaction.auditLog.create({
        data: {
          userId: member.userId,
          action: "SUPPORT_TICKET_UPDATED",
          entity: "SupportTicket",
          entityId: id,
          afterData: data,
        },
      });

      return ticket;
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      priority: updated.priority,
    });
  } catch (error) {
    console.error("Erro ao atualizar chamado:", error);
    return NextResponse.json(
      { error: "Não foi possível atualizar o chamado." },
      { status: 500 },
    );
  }
}
