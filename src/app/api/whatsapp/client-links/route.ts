import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { canViewWhatsAppManagement } from "@/modules/whatsapp/management-access";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { summarizeClientLinks } from "@/modules/whatsapp/client-links";
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
