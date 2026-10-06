import { prisma } from "@/lib/prisma";
import { classifyAndRouteEmail } from "@/modules/atendimento/routing/classifier";
import { whatsappChannelAddress } from "./core";
import {
  getWhatsAppPhoneNumberId,
  metaMessageAttachment,
  metaMessageContent,
  type MetaWhatsAppContact,
  type MetaWhatsAppMessage,
  type MetaWhatsAppStatus,
  type MetaWhatsAppWebhookPayload,
} from "./meta";
import { resolveWhatsappRouting } from "./server";

async function webhookOrganizationId() {
  const configured = process.env.WHATSAPP_ORGANIZATION_ID?.trim();
  if (configured) {
    const organization = await prisma.organization.findUnique({
      where: { id: configured },
      select: { id: true },
    });
    if (!organization) {
      throw new Error("WHATSAPP_ORGANIZATION_ID não corresponde a uma organização.");
    }
    return organization.id;
  }

  const organizations = await prisma.organization.findMany({
    take: 2,
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (organizations.length === 1) return organizations[0].id;

  throw new Error(
    "WHATSAPP_ORGANIZATION_ID é obrigatória quando há mais de uma organização.",
  );
}

function receivedAt(timestamp?: string) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
}

function contactName(contacts: MetaWhatsAppContact[], waId: string) {
  return (
    contacts.find((contact) => contact.wa_id === waId)?.profile?.name?.trim() ||
    `+${waId}`
  );
}

async function alreadyReceived(organizationId: string, messageId: string) {
  return prisma.serviceMessage.findFirst({
    where: {
      externalMessageId: messageId,
      ticket: { organizationId, source: "WHATSAPP_API" },
    },
    select: { id: true, ticketId: true },
  });
}

async function receiveMessage(input: {
  organizationId: string;
  displayPhoneNumber: string | null;
  contacts: MetaWhatsAppContact[];
  message: MetaWhatsAppMessage;
}) {
  const messageId = input.message.id?.trim();
  const waId = input.message.from?.replace(/\D/g, "") || "";
  if (!messageId || !waId) return { created: false, ignored: true };

  const duplicate = await alreadyReceived(input.organizationId, messageId);
  if (duplicate) {
    return { created: false, duplicate: true, ticketId: duplicate.ticketId };
  }

  const displayName = contactName(input.contacts, waId);
  const textBody = metaMessageContent(input.message);
  const attachment = metaMessageAttachment(input.message);
  const timestamp = receivedAt(input.message.timestamp);
  const classification = await classifyAndRouteEmail({
    organizationId: input.organizationId,
    senderEmail: `${waId}@whatsapp.invalid`,
    subject: displayName,
    textBody,
    attachmentNames: attachment ? [attachment.name] : [],
  });
  const routing = await resolveWhatsappRouting({
    organizationId: input.organizationId,
    kind: "CONTACT",
    identifier: waId,
    routingArea: classification.area,
  });
  const address = whatsappChannelAddress("CONTACT", routing.externalId);

  const activeTicket = await prisma.serviceTicket.findFirst({
    where: {
      organizationId: input.organizationId,
      source: { in: ["WHATSAPP_SIMULATOR", "WHATSAPP_API"] },
      senderEmail: address,
      status: { notIn: ["RESOLVED", "SPAM"] },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const ticket = await prisma.$transaction(async (tx) => {
    const current = activeTicket
      ? await tx.serviceTicket.update({
          where: { id: activeTicket.id },
          data: {
            senderName: displayName,
            snippet: textBody.slice(0, 220),
            lastMessageAt: timestamp,
            status: activeTicket.assignedToId ? "IN_PROGRESS" : "NEW",
          },
        })
      : await tx.serviceTicket.create({
          data: {
            organizationId: input.organizationId,
            clientId: routing.clientId,
            routingArea: classification.area,
            routingSquad: routing.routingSquad,
            routingConfidence: routing.clientId && !routing.ambiguous ? 100 : 0,
            routingReason: `${routing.reason} ${classification.reason}`,
            assignedToId: routing.assignedToId,
            assignedAt: routing.assignedToId ? timestamp : null,
            externalThreadId: `whatsapp:${waId}:${messageId}`,
            source: "WHATSAPP_API",
            subject: displayName,
            senderName: displayName,
            senderEmail: address,
            recipientEmail: input.displayPhoneNumber
              ? `wa-business:${input.displayPhoneNumber.replace(/\D/g, "")}`
              : "wa-business",
            snippet: textBody.slice(0, 220),
            status: routing.assignedToId ? "IN_PROGRESS" : "NEW",
            receivedAt: timestamp,
            lastMessageAt: timestamp,
          },
        });

    const serviceMessage = await tx.serviceMessage.create({
      data: {
        ticketId: current.id,
        externalMessageId: messageId,
        direction: "INBOUND",
        fromName: displayName,
        fromEmail: address,
        toEmails: input.displayPhoneNumber
          ? [`wa-business:${input.displayPhoneNumber.replace(/\D/g, "")}`]
          : [],
        textBody,
        receivedAt: timestamp,
        providerMetadata: {
          provider: "META_WHATSAPP",
          type: input.message.type || "unknown",
        },
      },
    });

    if (attachment) {
      await tx.serviceAttachment.upsert({
        where: { id: `whatsapp_${attachment.externalId}` },
        update: {},
        create: {
          id: `whatsapp_${attachment.externalId}`,
          messageId: serviceMessage.id,
          externalAttachmentId: attachment.externalId,
          name: attachment.name,
          mimeType: attachment.mimeType,
        },
      });
    }

    if (!activeTicket) {
      await tx.serviceTicketHistory.create({
        data: {
          ticketId: current.id,
          type: "WHATSAPP_API_INBOUND_CREATED",
          message: routing.assignedToId
            ? "Mensagem real recebida e distribuída automaticamente."
            : "Mensagem real recebida na fila geral.",
          metadata: {
            externalMessageId: messageId,
            externalId: routing.externalId,
            routingArea: classification.area,
            routingReason: routing.reason,
            contentReason: classification.reason,
          },
        },
      });
    }

    return current;
  });

  return { created: true, ticketId: ticket.id };
}

async function receiveStatus(organizationId: string, status: MetaWhatsAppStatus) {
  const messageId = status.id?.trim();
  const state = status.status?.trim();
  if (!messageId || !state) return false;

  const result = await prisma.serviceMessage.updateMany({
    where: {
      externalMessageId: messageId,
      ticket: { organizationId, source: "WHATSAPP_API" },
    },
    data: {
      deliveryStatus: state,
      statusUpdatedAt: receivedAt(status.timestamp),
      providerMetadata: {
        provider: "META_WHATSAPP",
        recipientId: status.recipient_id || null,
        conversation: status.conversation || null,
        pricing: status.pricing || null,
        errors: status.errors || null,
      },
    },
  });
  return result.count > 0;
}

export async function processWhatsAppWebhook(
  payload: MetaWhatsAppWebhookPayload,
) {
  if (payload.object !== "whatsapp_business_account") {
    return { received: 0, duplicates: 0, statuses: 0, ignored: true };
  }

  const organizationId = await webhookOrganizationId();
  const expectedPhoneNumberId = getWhatsAppPhoneNumberId();
  let received = 0;
  let duplicates = 0;
  let statuses = 0;

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value;
      if (!value || value.metadata?.phone_number_id !== expectedPhoneNumberId) {
        continue;
      }

      for (const message of value.messages || []) {
        const result = await receiveMessage({
          organizationId,
          displayPhoneNumber: value.metadata?.display_phone_number || null,
          contacts: value.contacts || [],
          message,
        });
        if (result.created) received += 1;
        if (result.duplicate) duplicates += 1;
      }

      for (const status of value.statuses || []) {
        if (await receiveStatus(organizationId, status)) statuses += 1;
      }
    }
  }

  return { received, duplicates, statuses, ignored: false };
}
