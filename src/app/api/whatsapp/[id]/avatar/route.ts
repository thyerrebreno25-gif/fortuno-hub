import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { WHATSAPP_SOURCES, parseWhatsappChannelAddress } from "@/modules/whatsapp/core";
import { whatsappConnection } from "@/modules/whatsapp/uazapi-server";
import { decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { object, uazapiRequest } from "@/modules/whatsapp/uazapi";
import { safeAvatarUrl } from "@/modules/whatsapp/avatar-url";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  if (!permission.canView) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { id } = await context.params;
  const ticket = await prisma.serviceTicket.findFirst({ where: { id, organizationId: member.organizationId, source: { in: [...WHATSAPP_SOURCES] } }, select: { senderEmail: true } });
  if (!ticket) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  const connection = await whatsappConnection(member.organizationId);
  if (!connection || connection.status !== "CONNECTED" || connection.expiresAt && connection.expiresAt < new Date()) return NextResponse.json({ url: null });
  const chat = parseWhatsappChannelAddress(ticket.senderEmail).externalId;
  try {
    const url = await unstable_cache(async () => {
      const body = object(await uazapiRequest(connection.serverUrl, decryptIntegrationSecret(connection.tokenEncrypted), "/chat/avatar", { number: chat, preview: true }));
      return safeAvatarUrl(body.url);
    }, ["whatsapp-avatar-v1", member.organizationId, connection.id, connection.instanceId, connection.phone || "", chat], { revalidate: 600 })();
    return NextResponse.json({ url }, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch {
    return NextResponse.json({ url: null }, { status: 503, headers: { "Retry-After": "60" } });
  }
}
