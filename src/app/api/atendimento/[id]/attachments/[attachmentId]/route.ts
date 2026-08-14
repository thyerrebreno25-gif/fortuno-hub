import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getServiceCenterPermission,
} from "@/modules/atendimento/auth";
import {
  getValidAccessToken,
  gmailFetch,
} from "@/modules/atendimento/gmail/client";

type Context = {
  params: Promise<{ id: string; attachmentId: string }>;
};

type GmailPart = {
  filename?: string;
  body?: {
    attachmentId?: string;
    data?: string;
    size?: number;
  };
  parts?: GmailPart[];
};

function findAttachmentPart(
  part: GmailPart | undefined,
  name: string,
  externalAttachmentId?: string | null,
): GmailPart | null {
  if (!part) return null;

  if (
    (externalAttachmentId && part.body?.attachmentId === externalAttachmentId) ||
    (part.filename && part.filename === name)
  ) {
    return part;
  }

  for (const child of part.parts || []) {
    const found = findAttachmentPart(child, name, externalAttachmentId);
    if (found) return found;
  }

  return null;
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function safeAsciiFileName(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\r\n"\\/]+/g, "-")
      .trim() || "anexo"
  );
}

export async function GET(_request: Request, context: Context) {
  try {
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

    const { id, attachmentId } = await context.params;
    const attachment = await prisma.serviceAttachment.findFirst({
      where: {
        id: attachmentId,
        message: {
          ticketId: id,
          ticket: { organizationId: member.organizationId },
        },
      },
      select: {
        name: true,
        mimeType: true,
        externalAttachmentId: true,
        message: {
          select: {
            externalMessageId: true,
            ticket: {
              select: { recipientEmail: true, organizationId: true },
            },
          },
        },
      },
    });

    if (!attachment || !attachment.message.externalMessageId) {
      return NextResponse.json(
        { error: "O arquivo não está disponível no Gmail." },
        { status: 404 },
      );
    }

    const recipientEmail = attachment.message.ticket.recipientEmail
      ?.trim()
      .toLowerCase();
    const connection = await prisma.emailConnection.findFirst({
      where: {
        organizationId: member.organizationId,
        provider: "GMAIL",
        active: true,
        ...(recipientEmail ? { email: recipientEmail } : {}),
      },
      orderBy: { updatedAt: "desc" },
    }) || await prisma.emailConnection.findFirst({
      where: {
        organizationId: member.organizationId,
        provider: "GMAIL",
        active: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!connection) {
      return NextResponse.json(
        { error: "A conta Gmail deste e-mail não está conectada." },
        { status: 503 },
      );
    }

    const token = await getValidAccessToken(connection);
    const messageId = attachment.message.externalMessageId;
    let externalAttachmentId = attachment.externalAttachmentId;
    let encodedData = "";

    if (!externalAttachmentId) {
      const gmailMessage = await gmailFetch(
        token,
        `/messages/${encodeURIComponent(messageId)}?format=full`,
      );
      const part = findAttachmentPart(
        gmailMessage.payload as GmailPart,
        attachment.name,
        null,
      );
      externalAttachmentId = part?.body?.attachmentId || null;
      encodedData = part?.body?.data || "";
    }

    if (externalAttachmentId) {
      const gmailAttachment = await gmailFetch(
        token,
        `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(externalAttachmentId)}`,
      );
      encodedData = String(gmailAttachment.data || "");
    }

    if (!encodedData) {
      return NextResponse.json(
        { error: "O Gmail não retornou o conteúdo deste anexo." },
        { status: 404 },
      );
    }

    const bytes = decodeBase64Url(encodedData);
    const asciiName = safeAsciiFileName(attachment.name);
    const encodedName = encodeURIComponent(attachment.name);

    return new Response(bytes, {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Erro ao abrir anexo do Gmail:", error);
    return NextResponse.json(
      { error: "Não foi possível abrir o anexo do Gmail." },
      { status: 500 },
    );
  }
}
