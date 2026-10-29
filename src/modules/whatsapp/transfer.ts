import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getWhatsAppPermission } from "@/modules/atendimento/auth";
import { parseWhatsappChannelAddress, responsibleForTransfer } from "./core";
import type { getWhatsappTicket } from "./server";
export class WhatsAppTransferError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const schema = z.object({ mode: z.enum(["AREA", "OPERATOR"]), clientId: z.string().min(1).optional(), assignedToId: z.string().min(1).optional(), routingArea: z.enum(["ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "GENERAL"]).optional(), note: z.string().trim().max(1000).optional() });
type Current = NonNullable<Awaited<ReturnType<typeof getWhatsappTicket>>>;
type Actor = { organizationId: string; userId: string; user: { name: string | null; email: string } };
export async function transferWhatsappTicket(current: Current, actor: Actor, canManage: boolean, body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new WhatsAppTransferError(400, "Revise o destino e a observação da transferência.");
  const input = parsed.data;
  if (current.organizationId !== actor.organizationId) throw new WhatsAppTransferError(404, "Atendimento não encontrado.");
  if (["RESOLVED", "SPAM"].includes(current.status)) throw new WhatsAppTransferError(400, "Este atendimento já foi finalizado.");
  if (current.assignedToId && current.assignedToId !== actor.userId && !canManage) throw new WhatsAppTransferError(403, "Este atendimento está com outro operador.");
  const clientId = input.clientId || current.clientId;
  const client = clientId ? await prisma.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId, active: true }, select: { id: true, name: true, serviceSquad: true, payableResponsibleId: true, receivableResponsibleId: true, generalResponsibleId: true, operationLeaderId: true } }) : null;
  if (clientId && !client) throw new WhatsAppTransferError(400, "Cliente inválido ou inativo.");
  const area = input.mode === "AREA" ? input.routingArea : current.routingArea;
  if (input.mode === "AREA" && (!client || !input.routingArea)) throw new WhatsAppTransferError(400, "Selecione o cliente e a área para identificar o responsável.");
  const assignedToId = input.mode === "AREA" && client && area ? responsibleForTransfer(client, area) : input.assignedToId;
  if (!assignedToId) throw new WhatsAppTransferError(400, input.mode === "AREA" ? "O cliente não possui responsável cadastrado para esta área. Atualize o cadastro ou selecione um operador." : "Selecione o operador de destino.");
  const target = await prisma.organizationMember.findFirst({ where: { organizationId: actor.organizationId, userId: assignedToId, role: { not: "CLIENT" } }, select: { role: true, user: { select: { name: true, email: true } } } });
  if (!target) throw new WhatsAppTransferError(400, "Operador de destino inválido.");
  const permission = await getWhatsAppPermission(actor.organizationId, target.role);
  if (!permission.canView || !permission.canEdit) throw new WhatsAppTransferError(400, "O operador selecionado não possui acesso de atendimento ao WhatsApp.");
  const targetName = target.user.name || target.user.email, actorName = actor.user.name || actor.user.email;
  const areaName = area === "ACCOUNTS_PAYABLE" ? "Contas a pagar" : area === "ACCOUNTS_RECEIVABLE" ? "Contas a receber" : "Atendimento geral";
  const note = input.note || "";
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const changed = await tx.serviceTicket.updateMany({ where: { id: current.id, organizationId: actor.organizationId, mergedIntoId: null, assignedToId: current.assignedToId, status: { notIn: ["RESOLVED", "SPAM"] } }, data: {
      assignedToId, assignedAt: now, status: "IN_PROGRESS", clientId: client?.id || current.clientId,
      routingArea: area, routingSquad: client?.serviceSquad ?? current.routingSquad,
      routingReason: input.mode === "AREA" ? `Transferido para o responsável de ${areaName} do cliente.` : "Transferido manualmente para outro operador.",
      lastMessageAt: now, snippet: `Transferido para ${targetName}${note ? ": " + note : ""}`.slice(0, 220),
    } });
    if (!changed.count) throw new WhatsAppTransferError(409, "Este atendimento foi alterado por outro operador. Atualize a conversa e tente novamente.");
    if (client && client.id !== current.clientId) {
      const channel = parseWhatsappChannelAddress(current.senderEmail);
      await tx.clientWhatsAppIdentity.updateMany({ where: { organizationId: actor.organizationId, kind: channel.kind, externalId: channel.externalId, clientId: { not: client.id } }, data: { active: false } });
      await tx.clientWhatsAppIdentity.upsert({ where: { organizationId_clientId_kind_externalId: { organizationId: actor.organizationId, clientId: client.id, kind: channel.kind, externalId: channel.externalId } }, create: { organizationId: actor.organizationId, clientId: client.id, kind: channel.kind, externalId: channel.externalId, displayName: current.senderName }, update: { active: true, displayName: current.senderName } });
    }
    const metadata = { previousAssignedToId: current.assignedToId, assignedToId, previousRoutingArea: current.routingArea, routingArea: area || "UNKNOWN", clientId: client?.id || current.clientId, mode: input.mode, note };
    await tx.serviceTicketHistory.create({ data: { ticketId: current.id, userId: actor.userId, type: "WHATSAPP_TRANSFERRED", message: `Atendimento transferido por ${actorName} para ${targetName}.`, metadata } });
    await tx.serviceMessage.create({ data: { ticketId: current.id, direction: "INTERNAL", fromName: actorName, fromEmail: actor.user.email, toEmails: [], textBody: `Transferência interna: ${actorName} → ${targetName}${input.mode === "AREA" ? " · " + areaName : ""}.${note ? "\n" + note : ""}`, receivedAt: now, providerMetadata: { ...metadata, type: "WHATSAPP_TRANSFER" } } });
  });
}
