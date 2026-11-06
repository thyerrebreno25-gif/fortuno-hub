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
  const rawIds = body?.entryIds ?? (typeof body?.entryId === "string" ? [body.entryId] : null);
  if (!body || typeof body.clientId !== "string" || !body.clientId || body.clientId.length > 200 || !Array.isArray(rawIds) || !rawIds.length || rawIds.length > 100 || rawIds.some(id => typeof id !== "string" || !id || id.length > 200)) return NextResponse.json({ error: "Selecione o cliente e de 1 a 100 contatos ou grupos da agenda." }, { status: 400 });
  const entryIds = [...new Set<string>(rawIds)];
  const account = await currentWhatsAppAccount(member.organizationId);
  const connection = account.connection;
  if (!account.recipient || !connection) return NextResponse.json({ error: "Conecte o WhatsApp para vincular os contatos e grupos." }, { status: 409 });
  const [client, entries] = await Promise.all([
    prisma.client.findFirst({ where: { id: body.clientId, organizationId: member.organizationId, active: true }, select: { id: true, name: true, serviceSquad: true } }),
    prisma.whatsAppDirectoryEntry.findMany({ where: { id: { in: entryIds }, organizationId: member.organizationId, connectionId: connection.id, accountPhone: connection.phone!, active: true, AND: [currentDirectoryVisibility()] }, select: { id: true, kind: true, externalId: true, displayName: true } }),
  ]);
  if (!client || entries.length !== entryIds.length) return NextResponse.json({ error: "Um dos contatos ou grupos não está mais disponível no WhatsApp conectado. Nenhum vínculo foi salvo." }, { status: 404 });
  const identities = entries.map(entry => { const kind = entry.kind === "GROUP" ? "GROUP" as const : "CONTACT" as const; return { organizationId: member.organizationId, clientId: client.id, kind, externalId: normalizeWhatsappIdentity(kind, entry.externalId), displayName: entry.displayName }; });
  if (identities.some(identity => !identity.externalId)) return NextResponse.json({ error: "Um dos contatos está sem identificação válida. Nenhum vínculo foi salvo." }, { status: 400 });
  const result = await prisma.$transaction(async tx => {
    const current = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WhatsAppConnection" WHERE id = ${connection.id} AND "organizationId" = ${member.organizationId} AND phone = ${connection.phone} AND status = 'CONNECTED' FOR SHARE`;
    if (!current.length) return false;
    // Add the entire selection atomically without removing existing identities.
    await tx.clientWhatsAppIdentity.createMany({ data: identities, skipDuplicates: true });
    await tx.clientWhatsAppIdentity.updateMany({ where: { organizationId: member.organizationId, clientId: client.id, OR: identities.map(({ kind, externalId }) => ({ kind, externalId })) }, data: { active: true } });
    await tx.serviceTicket.updateMany({ where: { ...account.where, senderEmail: { in: identities.map(identity => whatsappChannelAddress(identity.kind, identity.externalId)) }, clientId: null, mergedIntoId: null, isSpam: false }, data: { clientId: client.id, routingSquad: client.serviceSquad } });
    return true;
  });
  return result ? NextResponse.json({ linked: true, count: entries.length, clientId: client.id, clientName: client.name, displayName: entries[0].displayName }) : NextResponse.json({ error: "O número conectado mudou. Atualize a agenda e tente novamente." }, { status: 409 });
}

export async function DELETE(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!canViewWhatsAppManagement(member.role, permission.canView) || !permission.canEdit) return NextResponse.json({ error: "Somente a gestão com permissão de edição pode remover vínculos." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.clientId !== "string" || !body.clientId || body.clientId.length > 200 || !["GROUP", "CONTACT"].includes(body.kind) || typeof body.externalId !== "string" || !body.externalId || body.externalId.length > 200) return NextResponse.json({ error: "Informe o vínculo que deseja remover." }, { status: 400 });
  const account = await currentWhatsAppAccount(member.organizationId), connection = account.connection;
  if (!account.recipient || !connection) return NextResponse.json({ error: "Conecte o WhatsApp para remover o vínculo da conta atual." }, { status: 409 });
  const kind = body.kind === "GROUP" ? "GROUP" as const : "CONTACT" as const, externalId = normalizeWhatsappIdentity(kind, body.externalId), address = whatsappChannelAddress(kind, externalId);
  const [client, entry, ticket] = await Promise.all([
    prisma.client.findFirst({ where: { id: body.clientId, organizationId: member.organizationId, active: true }, select: { id: true } }),
    prisma.whatsAppDirectoryEntry.findFirst({ where: { organizationId: member.organizationId, connectionId: connection.id, accountPhone: connection.phone!, active: true, kind, externalId: { in: [body.externalId, externalId, externalId + "@s.whatsapp.net"] }, AND: [currentDirectoryVisibility()] }, select: { displayName: true } }),
    prisma.serviceTicket.findFirst({ where: { ...account.where, clientId: body.clientId, senderEmail: address, mergedIntoId: null }, select: { id: true, senderName: true } }),
  ]);
  if (!client || !externalId || !entry && !ticket) return NextResponse.json({ error: "Vínculo não encontrado no WhatsApp conectado." }, { status: 404 });
  const removed = await prisma.$transaction(async tx => {
    const current = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WhatsAppConnection" WHERE id = ${connection.id} AND "organizationId" = ${member.organizationId} AND phone = ${connection.phone} AND status = 'CONNECTED' FOR SHARE`;
    if (!current.length) return false;
    // Keep an inactive identity so name matching cannot undo this manual removal.
    await tx.clientWhatsAppIdentity.upsert({ where: { organizationId_clientId_kind_externalId: { organizationId: member.organizationId, clientId: client.id, kind, externalId } }, create: { organizationId: member.organizationId, clientId: client.id, kind, externalId, displayName: entry?.displayName || ticket?.senderName, active: false }, update: { active: false } });
    await tx.serviceTicket.updateMany({ where: { ...account.where, clientId: client.id, senderEmail: address, mergedIntoId: null }, data: { clientId: null, routingSquad: null, routingReason: "Vínculo removido manualmente na gestão do WhatsApp." } });
    return true;
  });
  return removed ? NextResponse.json({ removed: true }) : NextResponse.json({ error: "O número conectado mudou. Atualize a agenda." }, { status: 409 });
}
