import { prisma } from "@/lib/prisma";
import {
  getValidAccessToken,
  gmailFetch,
} from "./client";
import { classifyAndRouteEmail } from "../routing/classifier";

type GmailHeader = {
  name: string;
  value: string;
};

type GmailBody = {
  size?: number;
  data?: string;
  attachmentId?: string;
};

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
};

type ParsedAddress = {
  name: string | null;
  email: string;
};

type ParsedAttachment = {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
};

type GmailConnectionLike = {
  id: string;
  organizationId: string;
  email: string;
  externalId: string | null;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function getHeader(part: GmailPart, name: string) {
  return (
    part.headers?.find(
      (header) =>
        header.name.toLowerCase() ===
        name.toLowerCase(),
    )?.value || ""
  );
}

function decodeBase64Url(value?: string) {
  if (!value) return "";

  try {
    return Buffer.from(
      value.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch {
    return "";
  }
}

function parseAddress(value: string): ParsedAddress {
  const match = value.match(/^(.*)<([^>]+)>$/);

  if (match) {
    return {
      name:
        match[1]
          .replace(/^\s*["']|["']\s*$/g, "")
          .trim() || null,
      email: normalizeEmail(match[2]),
    };
  }

  return {
    name: null,
    email: normalizeEmail(value.split(",")[0] || ""),
  };
}

function parseEmailList(value: string) {
  return value
    .split(",")
    .map((item) => parseAddress(item).email)
    .filter(Boolean);
}

function parseMessageBodies(root: GmailPart) {
  let text = "";
  let html = "";

  const attachments: ParsedAttachment[] = [];

  function walk(part: GmailPart) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        name: part.filename,
        mimeType: part.mimeType || null,
        size: part.body.size || null,
      });
    }

    if (
      part.mimeType === "text/plain" &&
      part.body?.data
    ) {
      text += decodeBase64Url(part.body.data);
    }

    if (
      part.mimeType === "text/html" &&
      part.body?.data
    ) {
      html += decodeBase64Url(part.body.data);
    }

    part.parts?.forEach(walk);
  }

  walk(root);

  return {
    text,
    html,
    attachments,
  };
}

async function ingestGmailMessage(
  connection: GmailConnectionLike,
  token: string,
  messageId: string,
) {
  const message = await gmailFetch(
    token,
    `/messages/${encodeURIComponent(messageId)}?format=full`,
  );

  if (!message.id || !message.threadId) {
    return;
  }

  const payload = message.payload as GmailPart;

  const from = parseAddress(
    getHeader(payload, "From"),
  );

  if (!from.email) return;

  const subject =
    getHeader(payload, "Subject") || "(Sem assunto)";

  const to = parseEmailList(
    getHeader(payload, "To"),
  );

  const cc = parseEmailList(
    getHeader(payload, "Cc"),
  );

  const parsed = parseMessageBodies(payload);

  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate))
    : new Date();

  const routing = await classifyAndRouteEmail({
    organizationId: connection.organizationId,
    senderEmail: from.email,
    subject,
    textBody: parsed.text || "",
    htmlBody: parsed.html || "",
    attachmentNames: parsed.attachments.map(
      (item) => item.name
    ),
    recipientEmails: [...to, ...cc],
  });

  const existingTicket =
    await prisma.serviceTicket.findUnique({
      where: {
        organizationId_externalThreadId: {
          organizationId:
            connection.organizationId,
          externalThreadId:
            message.threadId,
        },
      },
    });

  await prisma.$transaction(async (tx) => {
    let ticket = existingTicket;

    if (!ticket) {
      ticket = await tx.serviceTicket.create({
        data: {
          organizationId:
            connection.organizationId,
          clientId: routing.clientId,
          routingArea: routing.area,
          routingSquad: routing.squad,
          routingConfidence: routing.confidence,
          routingReason: routing.reason,
          isSpam: routing.isSpam,
          spamScore: routing.spamScore,
          assignedToId: routing.assignedToId,
          assignedAt:
            routing.assignedToId
              ? receivedAt
              : null,
          externalThreadId:
            message.threadId,
          source: "GMAIL",
          subject,
          senderName: from.name,
          senderEmail: from.email,
          recipientEmail:
            to[0] || connection.email,
          snippet: (
            message.snippet ||
            parsed.text ||
            ""
          ).slice(0, 220),
          status:
            routing.isSpam
              ? "SPAM"
              : routing.assignedToId
              ? "IN_PROGRESS"
              : "NEW",
          receivedAt,
          lastMessageAt: receivedAt,
        },
      });

      await tx.serviceTicketHistory.create({
        data: {
          ticketId: ticket.id,
          type: "GMAIL_IMPORTED",
          message: routing.isSpam
            ? `E-mail recebido de ${from.email} e movido para Spam (${routing.spamScore}%): ${routing.reason}`
            : `E-mail recebido de ${from.email}. Classificação: ${routing.area} · ${routing.confidence}% · ${routing.reason}`,
          metadata: {
            routingArea: routing.area,
            routingSquad: routing.squad,
            routingConfidence: routing.confidence,
            routingReason: routing.reason,
            isSpam: routing.isSpam,
            spamScore: routing.spamScore,
          },
        },
      });
    } else {
  const shouldReopen =
    ticket.status === "RESOLVED";

  await tx.serviceTicket.update({
    where: {
      id: ticket.id,
    },
    data: {
      lastMessageAt: receivedAt,
      snippet: (
        message.snippet ||
        parsed.text ||
        ""
      ).slice(0, 220),
      ...(shouldReopen
        ? {
            status: "IN_PROGRESS",
            resolvedAt: null,
          }
        : {}),
    },
  });

      if (shouldReopen) {
        await tx.serviceTicketHistory.create({
          data: {
            ticketId: ticket.id,
            type: "GMAIL_REOPENED",
            message:
              "Chamado reaberto automaticamente após nova mensagem recebida pelo Gmail.",
          },
        });
      }
    }

    const serviceMessage =
      await tx.serviceMessage.upsert({
        where: {
          ticketId_externalMessageId: {
            ticketId: ticket.id,
            externalMessageId: message.id,
          },
        },
        update: {},
        create: {
          ticketId: ticket.id,
          externalMessageId: message.id,
          direction: "INBOUND",
          fromName: from.name,
          fromEmail: from.email,
          toEmails: to,
          ccEmails: cc,
          subject,
          textBody: parsed.text || null,
          htmlBody: parsed.html || null,
          receivedAt,
        },
      });

    for (const attachment of parsed.attachments) {
      await tx.serviceAttachment
        .upsert({
          where: {
            id: `gmail_${message.id}_${attachment.id}`,
          },
          update: {},
          create: {
            id: `gmail_${message.id}_${attachment.id}`,
            messageId: serviceMessage.id,
            externalAttachmentId:
              attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
          },
        })
        .catch(() => undefined);
    }
  });
}

export async function syncGmailConnection(
  connection: GmailConnectionLike,
  notificationHistoryId?: string,
) {
  const token =
    await getValidAccessToken(connection);

  const startHistoryId =
    connection.externalId;

  if (!startHistoryId) {
    if (notificationHistoryId) {
      await prisma.emailConnection.update({
        where: {
          id: connection.id,
        },
        data: {
          externalId:
            notificationHistoryId,
          lastSyncAt: new Date(),
        },
      });
    }

    return {
      processed: 0,
    };
  }

  let pageToken:
    | string
    | undefined;

  const messageIds =
    new Set<string>();

  let newestHistoryId =
    notificationHistoryId ||
    startHistoryId;

  do {
    const query = new URLSearchParams({
      startHistoryId,
      historyTypes:
        "messageAdded",
    });

    if (pageToken) {
      query.set(
        "pageToken",
        pageToken,
      );
    }

    const history = await gmailFetch(
      token,
      `/history?${query.toString()}`,
    );

    for (const item of history.history || []) {
      for (const added of
        item.messagesAdded || []) {
        if (added.message?.id) {
          messageIds.add(
            added.message.id,
          );
        }
      }
    }

    pageToken =
      history.nextPageToken;

    newestHistoryId =
      history.historyId ||
      newestHistoryId;
  } while (pageToken);

  for (const id of messageIds) {
    await ingestGmailMessage(
      connection,
      token,
      id,
    );
  }

  await prisma.emailConnection.update({
    where: {
      id: connection.id,
    },
    data: {
      externalId:
        newestHistoryId,
      lastSyncAt: new Date(),
    },
  });

  return {
    processed: messageIds.size,
    historyId:
      newestHistoryId,
  };
}
