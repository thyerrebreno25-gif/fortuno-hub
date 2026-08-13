import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getServiceCenterPermission,
  SERVICE_CENTER_MANAGER_ROLES,
} from "@/modules/atendimento/auth";
import {
  getValidAccessToken,
  gmailFetch,
} from "@/modules/atendimento/gmail/client";

type Context = {
  params: Promise<{ id: string }>;
};

type GmailHeader = {
  name?: string;
  value?: string;
};

function base64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function headerValue(
  headers: GmailHeader[] | undefined,
  name: string,
) {
  return (
    headers?.find(
      (header) =>
        header.name?.toLowerCase() ===
        name.toLowerCase(),
    )?.value || ""
  );
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function POST(
  request: Request,
  context: Context,
) {
  const member = await getServiceCenterMember();

  if (!member) {
    return NextResponse.json(
      { error: "Sessão inválida." },
      { status: 401 },
    );
  }

  const permission =
    await getServiceCenterPermission(
      member.organizationId,
      member.role,
    );

  if (!permission.canEdit) {
    return NextResponse.json(
      {
        error:
          "Seu perfil não possui permissão para responder chamados.",
      },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const body =
    (await request.json().catch(() => ({}))) as {
      text?: unknown;
    };

  const text = String(body.text || "").trim();

  if (!text) {
    return NextResponse.json(
      { error: "Escreva uma resposta." },
      { status: 400 },
    );
  }

  if (text.length > 50000) {
    return NextResponse.json(
      { error: "A resposta é muito longa." },
      { status: 400 },
    );
  }

  const ticket =
    await prisma.serviceTicket.findFirst({
      where: {
        id,
        organizationId:
          member.organizationId,
      },
      include: {
        messages: {
          where: {
            direction: "INBOUND",
            externalMessageId: {
              not: null,
            },
          },
          orderBy: {
            receivedAt: "desc",
          },
          take: 1,
        },
      },
    });

  if (!ticket) {
    return NextResponse.json(
      { error: "Chamado não encontrado." },
      { status: 404 },
    );
  }

  if (
    ticket.source !== "GMAIL" ||
    !ticket.externalThreadId
  ) {
    return NextResponse.json(
      {
        error:
          "Este chamado não veio do Gmail e não pode ser respondido por esta integração.",
      },
      { status: 400 },
    );
  }

  const latestInbound =
    ticket.messages[0];

  if (
    !latestInbound?.externalMessageId
  ) {
    return NextResponse.json(
      {
        error:
          "Não foi possível localizar a mensagem original no Gmail.",
      },
      { status: 400 },
    );
  }

  if (
    ticket.assignedToId &&
    ticket.assignedToId !==
      member.userId &&
    !permission.canManage &&
    !SERVICE_CENTER_MANAGER_ROLES.has(
      member.role,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Este chamado está atribuído a outro colaborador.",
      },
      { status: 403 },
    );
  }

  const connection =
    await prisma.emailConnection.findFirst({
      where: {
        organizationId:
          member.organizationId,
        provider: "GMAIL",
        active: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

  if (!connection) {
    return NextResponse.json(
      {
        error:
          "Nenhuma conta Gmail ativa está conectada à Central.",
      },
      { status: 400 },
    );
  }

  try {
    const accessToken =
      await getValidAccessToken(
        connection,
      );

    const sourceMessage =
      await gmailFetch(
        accessToken,
        `/messages/${encodeURIComponent(
          latestInbound.externalMessageId,
        )}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
      );

    const headers =
      sourceMessage.payload
        ?.headers as GmailHeader[] | undefined;

    const originalMessageId =
      headerValue(
        headers,
        "Message-ID",
      );

    const previousReferences =
      headerValue(
        headers,
        "References",
      );

    if (!originalMessageId) {
      return NextResponse.json(
        {
          error:
            "O Gmail não retornou o Message-ID necessário para manter a resposta na mesma conversa.",
        },
        { status: 502 },
      );
    }

    const subject =
      sanitizeHeader(
        headerValue(
          headers,
          "Subject",
        ) || ticket.subject,
      );

    const to =
      sanitizeHeader(
        ticket.senderEmail,
      );

    const from =
      sanitizeHeader(
        connection.email,
      );

    const references = [
      previousReferences,
      originalMessageId,
    ]
      .filter(Boolean)
      .join(" ");

    const mime = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `In-Reply-To: ${originalMessageId}`,
      `References: ${references}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      text,
    ].join("\r\n");

    const sent =
      await gmailFetch(
        accessToken,
        "/messages/send",
        {
          method: "POST",
          body: JSON.stringify({
            raw: base64Url(mime),
            threadId:
              ticket.externalThreadId,
          }),
        },
      );

    const now = new Date();

    await prisma.$transaction(
      async (tx) => {
        await tx.serviceMessage.create({
          data: {
            ticketId: ticket.id,
            externalMessageId:
              sent.id || null,
            direction: "OUTBOUND",
            fromName:
              member.user.name ||
              "Fortuno",
            fromEmail:
              connection.email,
            toEmails: [
              ticket.senderEmail,
            ],
            subject:
              ticket.subject,
            textBody: text,
            receivedAt: now,
          },
        });

        await tx.serviceTicket.update({
          where: {
            id: ticket.id,
          },
          data: {
            assignedToId:
              ticket.assignedToId ||
              member.userId,
            assignedAt:
              ticket.assignedAt ||
              now,
            firstResponseAt:
              ticket.firstResponseAt ||
              now,
            lastMessageAt: now,
            status:
              "WAITING_CUSTOMER",
            resolvedAt: null,
          },
        });

        await tx.serviceTicketHistory.create({
          data: {
            ticketId:
              ticket.id,
            userId:
              member.userId,
            type: "GMAIL_REPLY_SENT",
            message:
              "Resposta enviada ao cliente pelo Gmail.",
            metadata: {
              gmailMessageId:
                sent.id || null,
              gmailThreadId:
                sent.threadId ||
                ticket.externalThreadId,
            },
          },
        });
      },
    );

    return NextResponse.json({
      message:
        "Resposta enviada com sucesso.",
      gmailMessageId:
        sent.id || null,
      status:
        "WAITING_CUSTOMER",
    });
  } catch (error) {
    console.error(
      "Erro ao responder chamado pelo Gmail:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar a resposta pelo Gmail.",
      },
      { status: 500 },
    );
  }
}
