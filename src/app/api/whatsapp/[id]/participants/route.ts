import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { resolveWhatsappTicketId } from "@/modules/whatsapp/server";
import { whatsappConnection } from "@/modules/whatsapp/uazapi-server";
import { uazapiRequest } from "@/modules/whatsapp/uazapi";
import { decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { chatProfile } from "@/modules/whatsapp/chat-info";
import { chatProfileTag } from "@/modules/whatsapp/contact-profile";
import { memberAliases } from "@/modules/whatsapp/group-members";
import { canManageGroupInHub, canRemoveGroupMember, groupAccountIsAdmin, groupParticipantInput, participantOperationResult } from "@/modules/whatsapp/group-management-policy";

export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (member.role === "CLIENT" || !permission.canView || !permission.canEdit) return NextResponse.json({ error: "Sem permissão para gerenciar participantes." }, { status: 403 });
  const input = groupParticipantInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Informe um participante válido. Para adicionar, use telefone com DDI e DDD." }, { status: 400 });
  const { id } = await context.params;
  const account = await currentWhatsAppAccount(member.organizationId);
  if (!account.recipient) return NextResponse.json({ error: "Conecte o WhatsApp primeiro." }, { status: 409 });
  const entry = id.startsWith("directory:") && input.data.action === "add" ? await prisma.whatsAppDirectoryEntry.findFirst({ where: { id: id.slice(10), organizationId: member.organizationId, connectionId: account.connection!.id, accountPhone: account.connection!.phone!, kind: "GROUP", active: true }, select: { externalId: true } }) : null;
  if (id.startsWith("directory:") && !entry) return NextResponse.json({ error: "Grupo não encontrado na conta conectada." }, { status: 404 });
  const ticketId = entry ? null : await resolveWhatsappTicketId(id, member.organizationId);
  const ticket = await prisma.serviceTicket.findFirst({ where: { ...(entry ? { senderEmail: "wa-group:" + entry.externalId } : { id: ticketId! }), ...account.where, mergedIntoId: null, isSpam: false }, orderBy: { updatedAt: "desc" }, select: { id: true, senderEmail: true, recipientEmail: true, assignedToId: true, status: true } });
  if (!entry && !ticket) return NextResponse.json({ error: "Conversa indisponível na conta conectada." }, { status: 404 });
  if (!canManageGroupInHub(member.role, permission, member.userId, ticket || { assignedToId: null, status: "RESOLVED" })) return NextResponse.json({ error: "Assuma o chamado ou solicite a alteração a um gestor." }, { status: 403 });
  const groupJid = entry?.externalId || ticket?.senderEmail.match(/^wa-group:(\d+(?:-\d+)?@g\.us)$/)?.[1];
  if (!groupJid || !/^\d+(?:-\d+)?@g\.us$/.test(groupJid)) return NextResponse.json({ error: "Esta conversa não é um grupo." }, { status: 400 });
  const connection = await whatsappConnection(member.organizationId);
  if (!connection?.phone || connection.status !== "CONNECTED" || connection.expiresAt && connection.expiresAt <= new Date() || connection.id !== account.connection?.id || connection.instanceId !== account.connection?.instanceId || account.recipient !== `wa-account:${connection.id}:${connection.phone}`) return NextResponse.json({ error: "A conta conectada mudou. Atualize a conversa." }, { status: 409 });
  let claimId: string | null = null;
  let attempted = false;
  try {
    const token = decryptIntegrationSecret(connection.tokenEncrypted);
    // Never authorize using the cached profile shown in the drawer.
    const profile = chatProfile(await uazapiRequest(connection.serverUrl, token, "/group/info", { groupjid: groupJid, force: true }), true);
    if (!groupAccountIsAdmin(profile, connection.phone)) return NextResponse.json({ error: "O número conectado precisa ser administrador deste grupo." }, { status: 403 });
    const { action, participant, requestId } = input.data;
    const person = profile.participants.find(person => memberAliases(person).includes(participant));
    if (action === "remove" && (!person || !canRemoveGroupMember(person, connection.phone, profile.ownerId))) return NextResponse.json({ error: "Este participante não pode ser removido. Atualize os membros; o proprietário e o próprio número conectado são protegidos." }, { status: 400 });
    if (action === "add" && profile.participants.some(person => person.phone === participant)) return NextResponse.json({ error: "Este número já participa do grupo." }, { status: 409 });
    // Recheck the connected number after the remote lookup, before any external change.
    const current = await currentWhatsAppAccount(member.organizationId);
    if (current.recipient !== account.recipient || current.connection?.instanceId !== connection.instanceId) return NextResponse.json({ error: "A conexão mudou. Atualize a conversa." }, { status: 409 });
    const auditId = "wa-group-" + createHash("sha256").update([member.organizationId, account.recipient, groupJid, member.userId, requestId].join(":" )).digest("hex");
    try {
      await prisma.auditLog.create({ data: { id: auditId, userId: member.userId, action: "WHATSAPP_GROUP_PARTICIPANT", entity: "WhatsAppGroup", entityId: groupJid, afterData: { organizationId: member.organizationId, action, participant, state: "REQUESTED", accountRecipient: account.recipient } } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return NextResponse.json({ error: "Esta alteração já foi solicitada. Atualize os membros antes de tentar novamente." }, { status: 409 });
      throw error;
    }
    claimId = auditId;
    attempted = true;
    const result = participantOperationResult(await uazapiRequest(connection.serverUrl, token, "/group/updateParticipants", { groupjid: groupJid, action, participants: [participant] }), action === "add" ? [participant, participant + "@s.whatsapp.net"] : memberAliases(person!), action);
    revalidateTag(chatProfileTag(connection, groupJid), { expire: 0 });
    await prisma.auditLog.update({ where: { id: auditId }, data: { afterData: { organizationId: member.organizationId, action, participant, state: result.ok ? "CONFIRMED" : "UNCONFIRMED", accountRecipient: account.recipient } } });
    return NextResponse.json(result.ok ? { ok: true, message: result.message } : { error: result.message }, { status: result.ok ? 200 : 502 });
  } catch {
    if (attempted) revalidateTag(chatProfileTag(connection, groupJid), { expire: 0 });
    if (claimId) await prisma.auditLog.update({ where: { id: claimId }, data: { afterData: { organizationId: member.organizationId, action: input.data.action, participant: input.data.participant, state: "UNCONFIRMED", accountRecipient: account.recipient } } }).catch(() => {});
    return NextResponse.json({ error: attempted ? "Não foi possível confirmar a alteração. Atualize os membros antes de tentar novamente." : "Não foi possível conferir as permissões no WhatsApp. Tente novamente em instantes." }, { status: 502 });
  }
}
