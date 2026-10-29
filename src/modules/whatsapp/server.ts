import { prisma } from "@/lib/prisma";
import {
  normalizeWhatsappIdentity,
  responsibleForRoutingArea,
  whatsappChannelAddress,
  type WhatsAppIdentityKind,
  type WhatsAppRoutingArea,
} from "./core";

export async function resolveWhatsappRouting(input: {
  organizationId: string;
  kind: WhatsAppIdentityKind;
  identifier: string;
  routingArea: WhatsAppRoutingArea;
  requestedClientId?: string | null;
}) {
  const externalId = normalizeWhatsappIdentity(input.kind, input.identifier);

  if (input.requestedClientId) {
    const client = await prisma.client.findFirst({
      where: {
        id: input.requestedClientId,
        organizationId: input.organizationId,
        active: true,
      },
      select: {
        id: true,
        serviceSquad: true,
        operationLeaderId: true,
        payableResponsibleId: true,
        receivableResponsibleId: true,
        generalResponsibleId: true,
      },
    });

    return {
      externalId,
      clientId: client?.id ?? null,
      routingSquad: client?.serviceSquad ?? null,
      assignedToId: client
        ? responsibleForRoutingArea(client, input.routingArea)
        : null,
      reason: client ? "Cliente informado na simulação." : "Cliente inválido.",
      ambiguous: false,
    };
  }

  const identities = await prisma.clientWhatsAppIdentity.findMany({
    where: {
      organizationId: input.organizationId,
      kind: input.kind,
      externalId,
      active: true,
      client: { active: true },
    },
    select: {
      clientId: true,
      client: {
        select: {
          serviceSquad: true,
          operationLeaderId: true,
          payableResponsibleId: true,
          receivableResponsibleId: true,
          generalResponsibleId: true,
        },
      },
    },
  });

  const unique = [...new Map(identities.map((item) => [item.clientId, item])).values()];

  if (unique.length !== 1) {
    return {
      externalId,
      clientId: null,
      routingSquad: null,
      assignedToId: null,
      reason:
        unique.length > 1
          ? "Contato vinculado a mais de um cliente; aguardando seleção."
          : "Contato ainda não vinculado a um cliente.",
      ambiguous: unique.length > 1,
    };
  }

  const match = unique[0];
  return {
    externalId,
    clientId: match.clientId,
    routingSquad: match.client.serviceSquad,
    assignedToId: responsibleForRoutingArea(match.client, input.routingArea),
    reason: "Cliente reconhecido pelo contato do WhatsApp.",
    ambiguous: false,
  };
}

export function whatsappTicketAddress(
  kind: WhatsAppIdentityKind,
  identifier: string,
) {
  const externalId = normalizeWhatsappIdentity(kind, identifier);
  return whatsappChannelAddress(kind, externalId);
}

export async function resolveWhatsappTicketId(id: string, organizationId: string, database: Pick<typeof prisma, "serviceTicket"> = prisma) {
  let current = id;
  for (let depth = 0; depth < 5; depth++) {
    const row = await database.serviceTicket.findFirst({ where: { id: current, organizationId, source: { in: ["WHATSAPP_SIMULATOR", "WHATSAPP_API"] } }, select: { mergedIntoId: true } });
    if (!row?.mergedIntoId) return current;
    current = row.mergedIntoId;
  }
  throw new Error("Referência circular de atendimento.");
}
export async function getWhatsappTicket(id: string, organizationId: string) {
  let current = id;
  for (let depth = 0; depth < 5; depth++) {
  const ticket = await prisma.serviceTicket.findFirst({
    where: {
      id: current,
      organizationId,
      source: { in: ["WHATSAPP_SIMULATOR", "WHATSAPP_API"] },
    },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          document: true,
          contaAzulConnection: {
            select: { status: true, active: true, externalTenantName: true },
          },
        },
      },
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { receivedAt: "asc" },
        include: { attachments: { orderBy: { createdAt: "asc" } } },
      },
      history: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!ticket?.mergedIntoId) return ticket;
  current = ticket.mergedIntoId;
  }
  return null;
}
