import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { summarizeClientLinks } from "@/modules/whatsapp/client-links";
import { currentDirectoryVisibility } from "@/modules/whatsapp/directory-core";
import { normalizeWhatsappIdentity, whatsappChannelAddress } from "@/modules/whatsapp/core";
export async function GET() {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!canViewWhatsAppManagement(member.role, permission.canView)) return NextResponse.json({ error: "Acesso restrito à gestão." }, { status: 403 });
  const account = await currentWhatsAppAccount(member.organizationId);
  if (!account.recipient || !account.connection) return NextResponse.json({ error: "Conecte o WhatsApp para conferir os vínculos do número atual." }, { status: 409 });
  const [clients, directory, tickets] = await Promise.all([
    prisma.client.findMany({ where: { organizationId: member.organizationId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, whatsappIdentities: { where: { active: true, organizationId: member.organizationId }, select: { kind: true, externalId: true, displayName: true } } } }),
    prisma.whatsAppDirectoryEntry.findMany({ where: { organizationId: member.organizationId, connectionId: account.connection.id, accountPhone: account.connection.phone!, active: true }, select: { kind: true, externalId: true, displayName: true } }),
    prisma.serviceTicket.findMany({ where: { ...account.where, mergedIntoId: null, isSpam: false, status: { not: "SPAM" } }, orderBy: { lastMessageAt: "desc" }, distinct: ["senderEmail"], select: { id: true, clientId: true, senderEmail: true, senderName: true, subject: true } }),
  ]);
  return NextResponse.json(summarizeClientLinks(clients, directory, tickets), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!canViewWhatsAppManagement(member.role, permission.canView) || !permission.canEdit) return NextResponse.json({ error: "Somente a gestão com permissão de edição pode vincular clientes." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.clientId !== "string" || typeof body.entryId !== "string" || !body.clientId || !body.entryId || body.clientId.length > 200 || body.entryId.length > 200) return NextResponse.json({ error: "Selecione o cliente e um contato ou grupo da agenda." }, { status: 400 });
  const account = await currentWhatsAppAccount(member.organizationId);
  const connection = account.connection;
  if (!account.recipient || !connection) return NextResponse.json({ error: "Conecte o WhatsApp para vincular um contato ou grupo." }, { status: 409 });
  const [client, entry] = await Promise.all([
    prisma.client.findFirst({ where: { id: body.clientId, organizationId: member.organizationId, active: true }, select: { id: true, name: true, serviceSquad: true } }),
    prisma.whatsAppDirectoryEntry.findFirst({ where: { id: body.entryId, organizationId: member.organizationId, connectionId: connection.id, accountPhone: connection.phone!, active: true, AND: [currentDirectoryVisibility()] }, select: { kind: true, externalId: true, displayName: true } }),
  ]);
  if (!client || !entry) return NextResponse.json({ error: "Cliente ou contato não encontrado na base e no WhatsApp conectado." }, { status: 404 });
  const kind = entry.kind === "GROUP" ? "GROUP" : "CONTACT";
  const externalId = normalizeWhatsappIdentity(kind, entry.externalId);
  const result = await prisma.$transaction(async tx => {
    const current = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WhatsAppConnection" WHERE id = ${connection.id} AND "organizationId" = ${member.organizationId} AND phone = ${connection.phone} AND status = 'CONNECTED' FOR SHARE`;
    if (!current.length) return false;
    // Add only this identity. Other groups/contacts and their clients stay intact.
    await tx.clientWhatsAppIdentity.upsert({ where: { organizationId_clientId_kind_externalId: { organizationId: member.organizationId, clientId: client.id, kind, externalId } }, create: { organizationId: member.organizationId, clientId: client.id, kind, externalId, displayName: entry.displayName }, update: { active: true, displayName: entry.displayName } });
    // Reflect the association on this account's unlinked conversations, without
    // moving tickets already linked to another client or changing their operator.
    await tx.serviceTicket.updateMany({ where: { ...account.where, senderEmail: whatsappChannelAddress(kind, externalId), clientId: null, mergedIntoId: null, isSpam: false }, data: { clientId: client.id, routingSquad: client.serviceSquad } });
    return true;
  });
  return result ? NextResponse.json({ linked: true, clientId: client.id, clientName: client.name, displayName: entry.displayName }) : NextResponse.json({ error: "O número conectado mudou. Atualize a agenda e tente novamente." }, { status: 409 });
}
