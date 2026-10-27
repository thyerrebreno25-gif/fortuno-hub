import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getValidAccessToken,
  gmailFetch,
  GmailApiError,
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
  externalId: string | null;
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
  metadata?: unknown;
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
    if (
      part.filename &&
      (part.body?.attachmentId || part.body?.data)
    ) {
      const externalId = part.body.attachmentId || null;

      attachments.push({
        id:
          externalId ||
          `inline_${part.partId || attachments.length}`,
        externalId,
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
  if (await prisma.serviceMessage.findFirst({ where: { externalMessageId: messageId, ticket: { organizationId: connection.organizationId } }, select: { id: true } })) return;
  const message = await gmailFetch(
    token,
    `/messages/${encodeURIComponent(messageId)}?format=full`,
  );

  if (!message.id || !message.threadId) {
    return;
  }
  const gmailMessageId = message.id, gmailThreadId = message.threadId;
  if ((message.labelIds || []).some((label: string) => ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label))) return;

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
            gmailThreadId,
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
            gmailThreadId,
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
    ticket.status === "RESOLVED" && receivedAt > (ticket.resolvedAt || ticket.lastMessageAt);

  await tx.serviceTicket.update({
    where: {
      id: ticket.id,
    },
    data: {
      lastMessageAt: receivedAt > ticket.lastMessageAt ? receivedAt : ticket.lastMessageAt,
      snippet: receivedAt >= ticket.lastMessageAt ? (
        message.snippet ||
        parsed.text ||
        ""
      ).slice(0, 220) : ticket.snippet,
      ...(shouldReopen
        ? {
            status: "IN_PROGRESS",
            resolvedAt: null,
          }
        : {}),
    },
  });

      await tx.serviceTicketHistory.updateMany({
        where: { ticketId: ticket.id, type: "MAILBOX_ARCHIVED", createdAt: { lt: receivedAt } },
        data: { type: "MAILBOX_RESTORED", message: "Atendimento voltou à caixa após novo e-mail." },
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
            externalMessageId: gmailMessageId,
          },
        },
        update: {},
        create: {
          ticketId: ticket.id,
          externalMessageId: gmailMessageId,
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
            id: `gmail_${gmailMessageId}_${attachment.id}`,
          },
          update: {},
          create: {
            id: `gmail_${gmailMessageId}_${attachment.id}`,
            messageId: serviceMessage.id,
            externalAttachmentId:
              attachment.externalId,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
          },
        })
        .catch(() => undefined);
    }
  });
}

// A database lease serializes webhook, browser and scheduled polling across instances.
export async function syncGmailConnection(connection: GmailConnectionLike, _notificationHistoryId?: string) {
  void _notificationHistoryId;
  const id = 'gmail-' + connection.id, now = new Date();
  await prisma.managementSyncState.upsert({ where: { id }, create: { id, origin: 'gmail' }, update: {} });
  const lease = await prisma.managementSyncState.updateMany({ where: { id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseUntil: new Date(+now + 300000), lastStartedAt: now } });
  if (!lease.count) return { processed: 0, alreadyRunning: true };
  try {
    const current = await prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
    if (!current.active) return { processed: 0 };
    const result = await syncMailbox(current);
    await prisma.managementSyncState.update({ where: { id }, data: { lastFinishedAt: new Date(), lastError: null } });
    return result;
  } catch (error) {
    const message = error instanceof GmailApiError && [401, 403].includes(error.status) ? 'O Google recusou a autorização da caixa. Reconecte o Gmail para retomar o recebimento.' : 'Não foi possível consultar o Gmail. Nova tentativa automática em até 5 minutos.';
    await prisma.managementSyncState.update({ where: { id }, data: { lastFinishedAt: new Date(), lastError: message } });
    throw new Error(message);
  } finally {
    await prisma.managementSyncState.update({ where: { id }, data: { leaseUntil: null } });
  }
}

async function syncMailbox(connection: GmailConnectionLike) {
  const deadline = Date.now() + 130000;
  const token = await getValidAccessToken(connection);
  const metadata = connection.metadata && typeof connection.metadata === 'object' && !Array.isArray(connection.metadata) ? connection.metadata as Prisma.JsonObject : {};
  let historyId = connection.externalId;
  let recovery = metadata.inboxBackfillComplete !== true || !historyId;
  const ids = new Set<string>();
  if (!recovery) {
    try {
      const startHistoryId = historyId!;
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', ...(pageToken ? { pageToken } : {}) });
        const history = await gmailFetch(token, '/history?' + query);
        for (const item of history.history || []) for (const added of item.messagesAdded || []) if (added.message?.id) ids.add(added.message.id);
        pageToken = history.nextPageToken;
        historyId = history.historyId || historyId;
      } while (pageToken);
    } catch (error) {
      if (!(error instanceof GmailApiError) || error.status !== 404) throw error;
      recovery = true;
    }
  }
  if (recovery) {
    // Capture the baseline BEFORE listing, so mail received during recovery is not lost.
    const baseline = typeof metadata.inboxBackfillHistoryId === 'string' ? metadata.inboxBackfillHistoryId : String((await gmailFetch(token, '/profile')).historyId);
    const query = new URLSearchParams({ q: 'in:inbox newer_than:30d', maxResults: '50', ...(typeof metadata.inboxBackfillPageToken === 'string' ? { pageToken: metadata.inboxBackfillPageToken } : {}) });
    let page;
    try { page = await gmailFetch(token, '/messages?' + query); }
    catch (error) {
      if (!(error instanceof GmailApiError) || error.status !== 400 || !metadata.inboxBackfillPageToken) throw error;
      await prisma.emailConnection.update({ where: { id: connection.id }, data: { metadata: { ...metadata, inboxBackfillPageToken: null, inboxBackfillHistoryId: null } } });
      return { processed: 0, recovering: true };
    }
    if (!/^\d+$/.test(baseline)) throw new Error('Histórico Gmail inválido.');
    await prisma.emailConnection.update({ where: { id: connection.id }, data: { metadata: { ...metadata, inboxBackfillComplete: false, inboxBackfillHistoryId: baseline } } });
    let processed = 0;
    for (const item of page.messages || []) {
      if (Date.now() > deadline) return { processed, recovering: true };
      if (item.id) {
        try { await ingestGmailMessage(connection, token, item.id); }
        catch (error) { if (!(error instanceof GmailApiError) || error.status !== 404) throw error; }
        processed++;
      }
    }
    const more = Boolean(page.nextPageToken);
    await prisma.emailConnection.update({ where: { id: connection.id }, data: {
      ...(more ? {} : { externalId: baseline, lastSyncAt: new Date() }),
      metadata: { ...metadata, inboxBackfillComplete: !more, inboxBackfillHistoryId: more ? baseline : null, inboxBackfillPageToken: page.nextPageToken || null },
    } });
    return { processed: (page.messages || []).length, recovering: more };
  }
  let processed = 0;
  for (const messageId of ids) {
    if (Date.now() > deadline) return { processed, recovering: true };
    try { await ingestGmailMessage(connection, token, messageId); }
    catch (error) { if (!(error instanceof GmailApiError) || error.status !== 404) throw error; }
    processed++;
  }
  await prisma.emailConnection.update({ where: { id: connection.id }, data: { externalId: historyId, lastSyncAt: new Date() } });
  return { processed: ids.size, historyId };
}

export async function pollGmailConnections(organizationId?: string, force = false) {
  const cutoff = new Date(Date.now() - 5 * 60000);
  const connections = await prisma.emailConnection.findMany({ where: { provider: 'GMAIL', active: true, ...(organizationId ? { organizationId } : {}) }, orderBy: { lastSyncAt: { sort: 'asc', nulls: 'first' } } });
  const deadline = Date.now() + 150000;
  let processed = 0, failed = 0;
  for (const connection of connections) {
    if (Date.now() > deadline) break;
    const state = await prisma.managementSyncState.findUnique({ where: { id: 'gmail-' + connection.id } });
    if (!force && state?.lastFinishedAt && state.lastFinishedAt > cutoff) continue;
    try { const result = await syncGmailConnection(connection); processed += result.processed; }
    catch { failed++; }
  }
  return { processed, failed };
}
