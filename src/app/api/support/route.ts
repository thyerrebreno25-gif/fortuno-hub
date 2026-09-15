import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSupportMember,
  SUPPORT_MANAGER_ROLES,
} from "@/modules/support/server/support-auth";
import {
  parseSupportMetadata,
  type SupportAttachment,
} from "@/modules/support/types/support.types";
import { sendNewSupportTicketEmail } from "@/modules/notifications/email/support-email";
import {
  publicSupportAttachment,
  removeSupportAttachments,
  uploadSupportAttachments,
} from "@/modules/support/server/support-attachments";

const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export async function GET(request: Request) {
  try {
    const member = await getSupportMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou ou você não pertence a uma organização." },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";
    const canSeeAll = SUPPORT_MANAGER_ROLES.has(member.role);

    const where = {
      organizationId: member.organizationId,
      ...(canSeeAll ? {} : { userId: member.userId }),
      ...(status && status !== "ALL"
        ? { status: status as "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" }
        : {}),
      ...(search
        ? {
            OR: [
              { subject: { contains: search, mode: "insensitive" as const } },
              { description: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [tickets, open, inProgress, resolved, closed] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 200,
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
      }),
      prisma.supportTicket.count({
        where: {
          organizationId: member.organizationId,
          ...(canSeeAll ? {} : { userId: member.userId }),
          status: "OPEN",
        },
      }),
      prisma.supportTicket.count({
        where: {
          organizationId: member.organizationId,
          ...(canSeeAll ? {} : { userId: member.userId }),
          status: "IN_PROGRESS",
        },
      }),
      prisma.supportTicket.count({
        where: {
          organizationId: member.organizationId,
          ...(canSeeAll ? {} : { userId: member.userId }),
          status: "RESOLVED",
        },
      }),
      prisma.supportTicket.count({
        where: {
          organizationId: member.organizationId,
          ...(canSeeAll ? {} : { userId: member.userId }),
          status: "CLOSED",
        },
      }),
    ]);

    return NextResponse.json({
      currentUser: {
        id: member.user.id,
        name: member.user.name || member.user.email,
        role: member.role,
        canManage: canSeeAll,
      },
      stats: {
        open,
        inProgress,
        resolved,
        closed,
      },
      tickets: tickets.map((ticket) => {
        const metadata = parseSupportMetadata(ticket.metadata);

        return {
          id: ticket.id,
          code: `SUP-${ticket.id.slice(-6).toUpperCase()}`,
          subject: ticket.subject,
          description: ticket.description,
          priority: ticket.priority,
          status: ticket.status,
          category: metadata.category ?? "Outro",
          module: metadata.module ?? "Geral",
          attachments: (metadata.attachments ?? []).map(publicSupportAttachment),
          messageCount: metadata.messages?.length ?? 0,
          requester: {
            id: ticket.user.id,
            name: ticket.user.name || ticket.user.email,
          },
          createdAt: ticket.createdAt.toISOString(),
          updatedAt: ticket.updatedAt.toISOString(),
        };
      }),
    });
  } catch (error) {
    console.error("Erro ao listar chamados:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar os chamados." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const member = await getSupportMember();

    if (!member) {
      return NextResponse.json(
        { error: "Sua sessão expirou ou você não pertence a uma organização." },
        { status: 401 },
      );
    }

    const multipart = request.headers.get("content-type")?.includes("multipart/form-data");
    const formData = multipart ? await request.formData() : null;
    const jsonBody = multipart ? null : await request.json();
    const body = (jsonBody ?? {
      subject: formData?.get("subject"),
      description: formData?.get("description"),
      priority: formData?.get("priority"),
      category: formData?.get("category"),
      module: formData?.get("module"),
      technicalContext: undefined,
    }) as {
      subject?: unknown;
      description?: unknown;
      priority?: unknown;
      category?: unknown;
      module?: unknown;
      attachments?: unknown;
      technicalContext?: unknown;
    };

    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    type SupportPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const priority: SupportPriority =
  typeof body.priority === "string" &&
  VALID_PRIORITIES.has(body.priority)
    ? (body.priority as SupportPriority)
    : "MEDIUM";
    const category =
      typeof body.category === "string" ? body.category.trim() : "Outro";
    const moduleName = typeof body.module === "string" ? body.module.trim() : "Geral";

    if (subject.length < 4) {
      return NextResponse.json(
        { error: "Informe um título com pelo menos 4 caracteres." },
        { status: 400 },
      );
    }

    if (description.length < 10) {
      return NextResponse.json(
        { error: "Descreva o chamado com pelo menos 10 caracteres." },
        { status: 400 },
      );
    }

    const metadataAttachments: SupportAttachment[] = Array.isArray(body.attachments)
      ? body.attachments
          .map((item) => {
            const row = item as {
              name?: unknown;
              size?: unknown;
              type?: unknown;
            };

            return {
              name: typeof row.name === "string" ? row.name.slice(0, 180) : "",
              size:
                typeof row.size === "number" && Number.isFinite(row.size)
                  ? row.size
                  : 0,
              type: typeof row.type === "string" ? row.type.slice(0, 100) : "",
            };
          })
          .filter((item) => item.name)
          .slice(0, 10)
      : [];

    const ticketId = crypto.randomUUID();
    const firstMessageId = crypto.randomUUID();
    const uploaded = formData
      ? await uploadSupportAttachments({
          organizationId: member.organizationId,
          ticketId,
          messageId: firstMessageId,
          files: formData.getAll("files").filter((item): item is File => item instanceof File),
        })
      : { attachments: metadataAttachments, storagePaths: [] as string[] };
    const attachments = uploaded.attachments;

    let created;
    try {
      created = await prisma.$transaction(async (transaction) => {
        const ticket = await transaction.supportTicket.create({
          data: {
            id: ticketId,
            organizationId: member.organizationId,
            userId: member.userId,
            subject,
            description,
            priority,
            status: "OPEN",
            metadata: {
              category,
              module: moduleName,
              attachments,
              technicalContext:
                body.technicalContext &&
                typeof body.technicalContext === "object" &&
                !Array.isArray(body.technicalContext)
                  ? body.technicalContext
                  : undefined,
              messages: [
                {
                  id: firstMessageId,
                  userId: member.userId,
                  userName: member.user.name || member.user.email,
                  senderType: "USER",
                  text: description,
                  createdAt: new Date().toISOString(),
                  attachments,
                },
              ],
            },
          },
        });

        await transaction.auditLog.create({
          data: {
            userId: member.userId,
            action: "SUPPORT_TICKET_CREATED",
            entity: "SupportTicket",
            entityId: ticket.id,
            afterData: {
              subject,
              priority,
              category,
              module: moduleName,
              attachments: attachments.length,
            },
          },
        });

        return ticket;
      });
    } catch (databaseError) {
      await removeSupportAttachments(uploaded.storagePaths);
      throw databaseError;
    }

    const ticketCode = `SUP-${created.id.slice(-6).toUpperCase()}`;

    const emailResult = await sendNewSupportTicketEmail({
      ticketId: created.id,
      ticketCode,
      subject,
      description,
      priority,
      category,
      module: moduleName,
      requesterName: member.user.name || member.user.email,
      requesterEmail: member.user.email,
      createdAt: created.createdAt,
    });

    if (!emailResult.sent) {
  console.error("ERRO RESEND:");
  console.error(emailResult.reason);
}

    return NextResponse.json(
      {
        id: created.id,
        code: ticketCode,
        message: emailResult.sent
          ? "Chamado criado e suporte notificado por e-mail."
          : "Chamado criado com sucesso. A notificação por e-mail ficou pendente.",
        emailNotification: {
          sent: emailResult.sent,
          reason: emailResult.sent ? undefined : emailResult.reason,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Erro ao criar chamado:", error);
    return NextResponse.json(
      { error: "Não foi possível criar o chamado." },
      { status: 500 },
    );
  }
}
