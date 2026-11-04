import {currentDirectoryVisibility} from "@/modules/whatsapp/directory-core";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
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
  const connection = await whatsappConnection(member.organizationId);
  if (!connection || connection.status !== "CONNECTED" || connection.expiresAt && connection.expiresAt < new Date()) return NextResponse.json({ url: null });
  const entry = await prisma.whatsAppDirectoryEntry.findFirst({where:{id,organizationId:member.organizationId,connectionId:connection.id,accountPhone:connection.phone || "",active:true,AND:[currentDirectoryVisibility()]},select:{externalId:true}});
  if (!entry) return NextResponse.json({error:"Contato não encontrado."},{status:404});
  const chat = entry.externalId;
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
