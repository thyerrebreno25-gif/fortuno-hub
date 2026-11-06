import { getWhatsAppPermission } from "@/modules/atendimento/auth";
import { matchWhatsappGroup } from "./automatic-routing";
import { currentWhatsAppAccount, accountMessageWhere } from "./account-scope";
import { prisma } from "@/lib/prisma";
import {
  normalizeWhatsappIdentity,
  responsibleForTransfer,
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
  displayName?: string;
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
        ? await eligibleWhatsappResponsible(input.organizationId, client, input.routingArea)
        : null,
      reason: client ? "Cliente vinculado ao atendimento." : "Cliente inválido.",
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
    const matched = unique.length === 0 && input.kind === "GROUP" && input.displayName ? matchWhatsappGroup(input.displayName, await prisma.client.findMany({
      where: { organizationId: input.organizationId, active: true, whatsappIdentities: { none: { organizationId: input.organizationId, kind: input.kind, externalId, active: false } } },
      select: { id: true, name: true, document: true, serviceAliases: true, serviceSquad: true, operationLeaderId: true, payableResponsibleId: true, receivableResponsibleId: true, generalResponsibleId: true },
    })) : null;
    const client = matched?.client;
    return { externalId, clientId: client?.id || null, routingSquad: client?.serviceSquad || null,
      assignedToId: client ? await eligibleWhatsappResponsible(input.organizationId, client, input.routingArea) : null,
      reason: unique.length > 1 ? "Contato vinculado a mais de um cliente; aguardando seleção." : matched?.reason || "Contato ainda não vinculado a um cliente.",
      ambiguous: unique.length > 1 || Boolean(matched?.ambiguous),
    };
  }

  const match = unique[0];
  return {
    externalId,
    clientId: match.clientId,
    routingSquad: match.client.serviceSquad,
    assignedToId: await eligibleWhatsappResponsible(input.organizationId, match.client, input.routingArea),
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

export async function resolveWhatsappTicketId(id: string, organizationId: string, database: Pick<typeof prisma, "serviceTicket" | "whatsAppConnection"> = prisma) {
  const account = await currentWhatsAppAccount(organizationId, database);
  let current = id;
  for (let depth = 0; depth < 5; depth++) {
    const row = await database.serviceTicket.findFirst({ where: { id: current, ...account.where }, select: { mergedIntoId: true } });
    if (!row?.mergedIntoId) return current;
    current = row.mergedIntoId;
  }
  throw new Error("Referência circular de atendimento.");
}
export async function getWhatsappTicket(id: string, organizationId: string, page?: { beforeId?: string }) {
  const account = await currentWhatsAppAccount(organizationId);
  let current = id;
  for (let depth = 0; depth < 5; depth++) {
  const ticket = await prisma.serviceTicket.findFirst({
    where: {
      id: current,
      ...account.where,
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
        where: accountMessageWhere(account.connection),
        ...(page ? { take: 51, orderBy: [{ receivedAt: "desc" as const }, { id: "desc" as const }], ...(page.beforeId ? { cursor: { id: page.beforeId }, skip: 1 } : {}) } : { orderBy: { receivedAt: "asc" as const } }),
        include: { attachments: { orderBy: { createdAt: "asc" } } },
      },
      history: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!ticket?.mergedIntoId) return ticket && page ? { ...ticket, messages: ticket.messages.slice(0, 50).reverse(), hasOlderMessages: ticket.messages.length > 50 } : ticket;
  current = ticket.mergedIntoId;
  }
  return null;
}

export async function eligibleWhatsappResponsible(organizationId: string, client: Parameters<typeof responsibleForTransfer>[0], area: WhatsAppRoutingArea) {
  if (area === "UNKNOWN") return null;
  const id = responsibleForTransfer(client, area);
  if (!id) return null;
  const member = await prisma.organizationMember.findFirst({ where: { organizationId, userId: id, role: { not: "CLIENT" } }, select: { role: true } });
  if (!member) return null;
  const permission = await getWhatsAppPermission(organizationId, member.role);
  return permission.canView && permission.canEdit ? id : null;
}
