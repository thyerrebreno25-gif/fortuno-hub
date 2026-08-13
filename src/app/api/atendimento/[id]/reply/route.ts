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

type ReplyAttachment = {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
};

const MAX_ATTACHMENT_BYTES =
  15 * 1024 * 1024;

const MAX_TOTAL_ATTACHMENT_BYTES =
  24 * 1024 * 1024;

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
  return value
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainTextToHtml(value: string) {
  return escapeHtml(value)
    .replace(/\r?\n/g, "<br>");
}

function cleanReplyHtml(value: string) {
  // Proteção básica para não aceitar scripts/event handlers
  // vindos do navegador.
  return value
    .replace(
      /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
      "",
    )
    .replace(
      /\son\w+\s*=\s*(['"]).*?\1/gi,
      "",
    )
    .replace(
      /\son\w+\s*=\s*[^\s>]+/gi,
      "",
    )
    .replace(
      /javascript:/gi,
      "",
    )
    .trim();
}

function signatureHtml(
  userName: string,
) {
  return [
    '<div style="margin-top:24px;color:#334155;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px">',
    "<div>Atenciosamente,</div>",
    `<div style="margin-top:6px;font-weight:700;color:#102a56">${escapeHtml(
      userName,
    )}</div>`,
    '<div style="color:#64748b">Fortuno Gestão Financeira</div>',
    "</div>",
  ].join("");
}

function signatureText(
  userName: string,
) {
  return [
    "Atenciosamente,",
    userName,
    "Fortuno Gestão Financeira",
  ].join("\n");
}

function wrapHtmlEmail(
  bodyHtml: string,
  signature: string,
) {
  return [
    '<!doctype html><html><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.6">',
    '<div style="white-space:normal">',
    bodyHtml,
    "</div>",
    signature,
    "</body></html>",
  ].join("");
}

function encodeHeaderFilename(
  filename: string,
) {
  const safe = filename
    .replace(/[\r\n"]/g, "_")
    .slice(0, 180);

  return safe;
}

function buildMime({
  from,
  to,
  subject,
  messageId,
  references,
  text,
  html,
  attachments,
}: {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  references: string;
  text: string;
  html: string;
  attachments: ReplyAttachment[];
}) {
  const mixedBoundary =
    `fortuno_mixed_${crypto.randomUUID()}`;
  const alternativeBoundary =
    `fortuno_alt_${crypto.randomUUID()}`;

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${messageId}`,
    `References: ${references}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${alternativeBoundary}--`,
  ];

  for (const attachment of attachments) {
    const filename =
      encodeHeaderFilename(
        attachment.name,
      );

    lines.push(
      "",
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mimeType}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      attachment.base64.match(/.{1,76}/g)?.join("\r\n") ||
        attachment.base64,
    );
  }

  lines.push(
    "",
    `--${mixedBoundary}--`,
    "",
  );

  return lines.join("\r\n");
}

async function parseAttachments(
  formData: FormData,
) {
  const files =
    formData
      .getAll("attachments")
      .filter(
        (item): item is File =>
          item instanceof File &&
          item.size > 0,
      );

  let totalSize = 0;

  const attachments:
    ReplyAttachment[] = [];

  for (const file of files) {
    if (
      file.size >
      MAX_ATTACHMENT_BYTES
    ) {
      throw new Error(
        `O arquivo "${file.name}" ultrapassa o limite de 15 MB.`,
      );
    }

    totalSize += file.size;

    if (
      totalSize >
      MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      throw new Error(
        "Os anexos ultrapassam o limite total de 24 MB.",
      );
    }

    const bytes =
      Buffer.from(
        await file.arrayBuffer(),
      );

    attachments.push({
      name:
        file.name ||
        "anexo",
      mimeType:
        file.type ||
        "application/octet-stream",
      size:
        file.size,
      base64:
        bytes.toString("base64"),
    });
  }

  return attachments;
}

export async function POST(
  request: Request,
  context: Context,
) {
  const member =
    await getServiceCenterMember();

  if (!member) {
    return NextResponse.json(
      {
        error:
          "Sessão inválida.",
      },
      {
        status: 401,
      },
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
      {
        status: 403,
      },
    );
  }

  const { id } =
    await context.params;

  const formData =
    await request.formData();

  const text =
    String(
      formData.get("text") ||
        "",
    ).trim();

  const rawHtml =
    String(
      formData.get("html") ||
        "",
    ).trim();

  const includeSignature =
    String(
      formData.get(
        "includeSignature",
      ) || "true",
    ) === "true";

  if (!text) {
    return NextResponse.json(
      {
        error:
          "Escreva uma resposta.",
      },
      {
        status: 400,
      },
    );
  }

  if (text.length > 50000) {
    return NextResponse.json(
      {
        error:
          "A resposta é muito longa.",
      },
      {
        status: 400,
      },
    );
  }

  let attachments:
    ReplyAttachment[];

  try {
    attachments =
      await parseAttachments(
        formData,
      );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Anexo inválido.",
      },
      {
        status: 400,
      },
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
            direction:
              "INBOUND",
            externalMessageId: {
              not: null,
            },
          },
          orderBy: {
            receivedAt:
              "desc",
          },
          take: 1,
        },
      },
    });

  if (!ticket) {
    return NextResponse.json(
      {
        error:
          "Chamado não encontrado.",
      },
      {
        status: 404,
      },
    );
  }

  if (
    ticket.source !==
      "GMAIL" ||
    !ticket.externalThreadId
  ) {
    return NextResponse.json(
      {
        error:
          "Este chamado não veio do Gmail e não pode ser respondido por esta integração.",
      },
      {
        status: 400,
      },
    );
  }

  const latestInbound =
    ticket.messages[0];

  if (
    !latestInbound
      ?.externalMessageId
  ) {
    return NextResponse.json(
      {
        error:
          "Não foi possível localizar a mensagem original no Gmail.",
      },
      {
        status: 400,
      },
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
      {
        status: 403,
      },
    );
  }

  const connection =
    await prisma.emailConnection.findFirst({
      where: {
        organizationId:
          member.organizationId,
        provider:
          "GMAIL",
        active:
          true,
      },
      orderBy: {
        updatedAt:
          "desc",
      },
    });

  if (!connection) {
    return NextResponse.json(
      {
        error:
          "Nenhuma conta Gmail ativa está conectada à Central.",
      },
      {
        status: 400,
      },
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
        ?.headers as
        | GmailHeader[]
        | undefined;

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
        {
          status: 502,
        },
      );
    }

    const subject =
      sanitizeHeader(
        headerValue(
          headers,
          "Subject",
        ) ||
          ticket.subject,
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

    const userName =
      member.user.name ||
      member.user.email ||
      "Equipe Fortuno";

    const bodyHtml =
      cleanReplyHtml(
        rawHtml ||
          plainTextToHtml(
            text,
          ),
      );

    const finalHtml =
      wrapHtmlEmail(
        bodyHtml,
        includeSignature
          ? signatureHtml(
              userName,
            )
          : "",
      );

    const finalText = [
      text,
      includeSignature
        ? signatureText(
            userName,
          )
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const mime =
      buildMime({
        from,
        to,
        subject,
        messageId:
          originalMessageId,
        references,
        text:
          finalText,
        html:
          finalHtml,
        attachments,
      });

    const sent =
      await gmailFetch(
        accessToken,
        "/messages/send",
        {
          method: "POST",
          body: JSON.stringify({
            raw:
              base64Url(
                mime,
              ),
            threadId:
              ticket.externalThreadId,
          }),
        },
      );

    const now =
      new Date();

    await prisma.$transaction(
      async (tx) => {
        const serviceMessage =
          await tx.serviceMessage.create({
            data: {
              ticketId:
                ticket.id,
              externalMessageId:
                sent.id ||
                null,
              direction:
                "OUTBOUND",
              fromName:
                userName,
              fromEmail:
                connection.email,
              toEmails: [
                ticket.senderEmail,
              ],
              subject:
                ticket.subject,
              textBody:
                finalText,
              htmlBody:
                finalHtml,
              receivedAt:
                now,
            },
          });

        for (
          let index = 0;
          index <
          attachments.length;
          index += 1
        ) {
          const attachment =
            attachments[index];

          await tx.serviceAttachment.create({
            data: {
              id: `sent_${sent.id || serviceMessage.id}_${index}`,
              messageId:
                serviceMessage.id,
              name:
                attachment.name,
              mimeType:
                attachment.mimeType,
              size:
                attachment.size,
            },
          });
        }

        await tx.serviceTicket.update({
          where: {
            id:
              ticket.id,
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
            lastMessageAt:
              now,
            status:
              "WAITING_CUSTOMER",
            resolvedAt:
              null,
          },
        });

        await tx.serviceTicketHistory.create({
          data: {
            ticketId:
              ticket.id,
            userId:
              member.userId,
            type:
              "GMAIL_REPLY_SENT",
            message:
              attachments.length
                ? `Resposta enviada pelo Gmail com ${attachments.length} anexo(s).`
                : "Resposta enviada ao cliente pelo Gmail.",
            metadata: {
              gmailMessageId:
                sent.id ||
                null,
              gmailThreadId:
                sent.threadId ||
                ticket.externalThreadId,
              attachments:
                attachments.map(
                  (attachment) => ({
                    name:
                      attachment.name,
                    size:
                      attachment.size,
                    mimeType:
                      attachment.mimeType,
                  }),
                ),
            },
          },
        });
      },
    );

    return NextResponse.json({
      message:
        "Resposta enviada com sucesso.",
      gmailMessageId:
        sent.id ||
        null,
      status:
        "WAITING_CUSTOMER",
      attachmentCount:
        attachments.length,
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
      {
        status: 500,
      },
    );
  }
}
