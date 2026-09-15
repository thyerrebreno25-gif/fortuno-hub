import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSupportMember,
  SUPPORT_MANAGER_ROLES,
} from "@/modules/support/server/support-auth";
import {
  parseSupportMetadata,
  type SupportAttachment,
  type SupportMessage,
} from "@/modules/support/types/support.types";
import {
  publicSupportAttachment,
  removeSupportAttachments,
  uploadSupportAttachments,
} from "@/modules/support/server/support-attachments";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const member = await getSupportMember();

    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const { id } = await context.params;
    const canManage = SUPPORT_MANAGER_ROLES.has(member.role);
    const multipart = request.headers.get("content-type")?.includes("multipart/form-data");
    const formData = multipart ? await request.formData() : null;
    const jsonBody = multipart ? null : await request.json();
    const body = (jsonBody ?? { text: formData?.get("text") }) as {
      text?: unknown;
      attachments?: unknown;
    };

    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (text.length < 1) {
      return NextResponse.json(
        { error: "Digite uma mensagem." },
        { status: 400 },
      );
    }

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        organizationId: member.organizationId,
        ...(canManage ? {} : { userId: member.userId }),
      },
      select: {
        id: true,
        userId: true,
        status: true,
        metadata: true,
      },
    });

    if (!ticket) {
      return NextResponse.json(
        { error: "Chamado não encontrado." },
        { status: 404 },
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

    const metadata = parseSupportMetadata(ticket.metadata);
    const messageId = crypto.randomUUID();
    const uploaded = formData
      ? await uploadSupportAttachments({
          organizationId: member.organizationId,
          ticketId: id,
          messageId,
          files: formData.getAll("files").filter((item): item is File => item instanceof File),
        })
      : { attachments: metadataAttachments, storagePaths: [] as string[] };
    const attachments = uploaded.attachments;
    const message: SupportMessage = {
      id: messageId,
      userId: member.userId,
      userName: member.user.name || member.user.email,
      senderType: canManage ? "SUPPORT" : "USER",
      text,
      createdAt: new Date().toISOString(),
      attachments,
    };

    const messages = [...(metadata.messages ?? []), message].slice(-500);

    const updatedMetadata = {
  ...metadata,
  messages,
} as Prisma.InputJsonValue;

    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.supportTicket.update({
          where: { id },
          data: {
            metadata: updatedMetadata,
            ...(ticket.status === "CLOSED" || ticket.status === "RESOLVED"
              ? { status: "OPEN" }
              : {}),
          },
        });

        await transaction.auditLog.create({
          data: {
            userId: member.userId,
            action: "SUPPORT_MESSAGE_SENT",
            entity: "SupportTicket",
            entityId: id,
            afterData: {
              senderType: message.senderType,
              hasAttachments: attachments.length > 0,
            },
          },
        });
      });
    } catch (databaseError) {
      await removeSupportAttachments(uploaded.storagePaths);
      throw databaseError;
    }

    return NextResponse.json({
      message: {
        ...message,
        attachments: message.attachments?.map(publicSupportAttachment),
      },
    });
  } catch (error) {
    console.error("Erro ao enviar mensagem de suporte:", error);
    return NextResponse.json(
      { error: "Não foi possível enviar a mensagem." },
      { status: 500 },
    );
  }
}
