import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getWhatsAppPermission } from "@/modules/atendimento/auth";
import type { getWhatsappTicket } from "./server";
export class WhatsAppTransferError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const schema=z.object({mode:z.literal("OPERATOR").default("OPERATOR"),clientId:z.string().min(1).optional(),assignedToId:z.string().min(1),routingArea:z.enum(["ACCOUNTS_PAYABLE","ACCOUNTS_RECEIVABLE","GENERAL"]),departmentId:z.string().min(1).max(100).optional(),note:z.string().trim().max(1000).optional()});

type Current = NonNullable<Awaited<ReturnType<typeof getWhatsappTicket>>>;
type Actor = { organizationId: string; userId: string; user: { name: string | null; email: string } };
export async function transferWhatsappTicket(current: Current, actor: Actor, canManage: boolean, body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new WhatsAppTransferError(400, "Selecione o setor, o colaborador e revise a observação da transferência.");
  const input = parsed.data;
  if (current.organizationId !== actor.organizationId) throw new WhatsAppTransferError(404, "Atendimento não encontrado.");
  if (["RESOLVED", "SPAM"].includes(current.status)) throw new WhatsAppTransferError(400, "Este atendimento já foi finalizado.");
  if (current.assignedToId && current.assignedToId !== actor.userId && !canManage) throw new WhatsAppTransferError(403, "Este atendimento está com outro operador.");
  if(input.clientId!==undefined&&input.clientId!==current.clientId)throw new WhatsAppTransferError(400,"A transferência mantém o cliente já vinculado ao chamado.");
  const department=input.departmentId?await prisma.whatsAppDepartment.findFirst({where:{id:input.departmentId,organizationId:actor.organizationId,active:true},select:{id:true,name:true}}):null;
  if(input.departmentId&&!department)throw new WhatsAppTransferError(400,"O setor selecionado não está disponível. Atualize a lista de setores.");
  const area=department?"GENERAL":input.routingArea,assignedToId=input.assignedToId;
  const target = await prisma.organizationMember.findFirst({ where: { organizationId: actor.organizationId, userId: assignedToId, role: { not: "CLIENT" } }, select: { role: true, user: { select: { name: true, email: true } } } });
  if (!target) throw new WhatsAppTransferError(400, "Operador de destino inválido.");
  const permission = await getWhatsAppPermission(actor.organizationId, target.role);
  if (!permission.canView || !permission.canEdit) throw new WhatsAppTransferError(400, "O operador selecionado não possui acesso de atendimento ao WhatsApp.");
  const targetName = target.user.name || target.user.email, actorName = actor.user.name || actor.user.email;
  const areaName = department?.name || (area === "ACCOUNTS_PAYABLE" ? "Contas a pagar" : area === "ACCOUNTS_RECEIVABLE" ? "Contas a receber" : "Atendimento geral");
  const note = input.note || "";
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const changed = await tx.serviceTicket.updateMany({ where: { id: current.id, organizationId: actor.organizationId, mergedIntoId: null, assignedToId: current.assignedToId, clientId: current.clientId, status: { notIn: ["RESOLVED", "SPAM"] } }, data: {
      assignedToId, assignedAt: now, status: "IN_PROGRESS",
      routingArea: area, whatsappDepartmentId:department?.id||null,whatsappDepartmentName:department?.name||null,
      routingReason: `Transferido manualmente para ${targetName} · ${areaName}.`,
      lastMessageAt: now, snippet: `Transferido para ${targetName}${note ? ": " + note : ""}`.slice(0, 220),
    } });
    if (!changed.count) throw new WhatsAppTransferError(409, "Este atendimento foi alterado por outro operador. Atualize a conversa e tente novamente.");
    const metadata = { previousAssignedToId: current.assignedToId, assignedToId, previousRoutingArea: current.routingArea, previousDepartmentId:current.whatsappDepartmentId,departmentId:department?.id||null,departmentName:department?.name||null, routingArea: area || "UNKNOWN", clientId: current.clientId, mode: input.mode, note };
    await tx.serviceTicketHistory.create({ data: { ticketId: current.id, userId: actor.userId, type: "WHATSAPP_TRANSFERRED", message: `Atendimento transferido por ${actorName} para ${targetName}.`, metadata } });
    await tx.serviceMessage.create({ data: { ticketId: current.id, direction: "INTERNAL", fromName: actorName, fromEmail: actor.user.email, toEmails: [], textBody: `Transferência interna: ${actorName} → ${targetName} · ${areaName}.${note ? "\n" + note : ""}`, receivedAt: now, providerMetadata: { ...metadata, accountPhone: current.recipientEmail?.startsWith("wa-account:") ? current.recipientEmail.split(":").at(-1) : null, type: "WHATSAPP_TRANSFER" } } });
  });
}
