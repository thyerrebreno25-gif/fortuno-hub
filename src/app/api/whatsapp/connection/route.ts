import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptIntegrationSecret, decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { instanceState, serverUrl, tokenHash, uazapiRequest } from "@/modules/whatsapp/uazapi";
import { checkConnection, configureWebhook, connectionView, whatsappConnection } from "@/modules/whatsapp/uazapi-server";
import { processWhatsAppHistory } from "@/modules/whatsapp/history-sync";
export const maxDuration = 120;
async function access() {
  const member = await getServiceCenterMember();
  if (!member) return null;
  const permission = await getWhatsAppPermission(member.organizationId, member.role);
  return { member, permission, canConfigure: member.role === "MASTER" || member.role === "ADMIN" && permission.canManage };
}
export async function GET() {
  const auth = await access();
  if (!auth) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!auth.permission.canView) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const connection = await whatsappConnection(auth.member.organizationId);
  let state;
  if (connection && auth.canConfigure) {
    try { state = await checkConnection(connection); }
    catch { await prisma.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "UNAVAILABLE", lastError: "Não foi possível consultar a instância. Confira a credencial e a validade do servidor de teste.", lastCheckedAt: new Date() } }); }
    after(async () => { await processWhatsAppHistory(connection.id); });
  }
  return NextResponse.json({ connection: connectionView(await whatsappConnection(auth.member.organizationId)), ...(auth.canConfigure && state ? { qrCode: state.qrCode, pairCode: state.pairCode } : {}), canConfigure: auth.canConfigure }, { headers: { "Cache-Control": "no-store" } });
}
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE"), serverUrl: z.string().min(1).max(300), token: z.string().trim().min(10).max(1000) }),
  z.object({ action: z.literal("CONNECT"), phone: z.string().regex(/^\d{10,15}$/).optional() }),
  z.object({ action: z.literal("WEBHOOK") }),
  z.object({ action: z.literal("DISCONNECT"), confirmation: z.literal("DESCONECTAR") }),
]);
export async function POST(request: Request) {
  const auth = await access();
  if (!auth) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!auth.canConfigure) return NextResponse.json({ error: "Somente administradores autorizados podem configurar a conexão." }, { status: 403 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Revise os dados da conexão." }, { status: 400 });
  try {
    let connection = await whatsappConnection(auth.member.organizationId);
    let state;
    if (input.data.action === "SAVE") {
      const base = serverUrl(input.data.serverUrl), hash = tokenHash(input.data.token);
      const linked = await prisma.whatsAppConnection.findUnique({ where: { tokenHash: hash }, select: { organizationId: true } });
      if (linked && linked.organizationId !== auth.member.organizationId) return NextResponse.json({ error: "Instância já vinculada a outra organização." }, { status: 409 });
      state = instanceState(await uazapiRequest(base, input.data.token, "/instance/status"));
      if (!state.instanceId) throw new Error("A Uazapi não confirmou o identificador da instância.");
      if (connection?.status === "CONNECTED" && connection.instanceId !== state.instanceId) throw new Error("Desconecte a instância atual antes de substituí-la.");
      const created = /T.*(?:Z|[+-]\d\d:\d\d)$/.test(state.created) ? Date.parse(state.created) : Date.now();
      const data = { serverUrl: base, tokenEncrypted: encryptIntegrationSecret(input.data.token), tokenHash: hash, instanceId: state.instanceId, instanceName: state.instanceName || null, status: state.status, phone: state.phone || connection?.phone || null, profileName: state.profileName || null, lastCheckedAt: new Date(), lastError: null, webhookConfiguredAt: null, webhookId: null, ...(connection?.instanceId !== state.instanceId ? { lastDisconnectedAt: connection?.lastDisconnectedAt || connection?.lastWebhookAt || new Date() } : {}), expiresAt: base === "https://free.uazapi.com" ? new Date((Number.isFinite(created) ? created : Date.now()) + 3600000) : null };
      connection = await prisma.whatsAppConnection.upsert({ where: { organizationId: auth.member.organizationId }, create: { ...data, organizationId: auth.member.organizationId }, update: data });
      await configureWebhook(connection);
    } else {
      if (!connection) return NextResponse.json({ error: "Cadastre o servidor e o token da instância." }, { status: 400 });
      if (input.data.action === "WEBHOOK") await configureWebhook(connection);
      if (input.data.action === "CONNECT") {
        if (!connection.webhookConfiguredAt) await configureWebhook(connection);
        state = instanceState(await uazapiRequest(connection.serverUrl, decryptIntegrationSecret(connection.tokenEncrypted), "/instance/connect", { ...(input.data.phone ? { phone: input.data.phone } : {}), history_days: 1 }));
        await prisma.whatsAppConnection.update({ where: { id: connection.id }, data: { status: state.status === "DISCONNECTED" ? "CONNECTING" : state.status, lastCheckedAt: new Date(), lastError: null } });
      }
      if (input.data.action === "DISCONNECT") {
        await uazapiRequest(connection.serverUrl, decryptIntegrationSecret(connection.tokenEncrypted), "/instance/disconnect", {});
        await prisma.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", lastCheckedAt: new Date() } });
      }
    }
    await prisma.auditLog.create({ data: { userId: auth.member.userId, action: "UAZAPI_" + input.data.action, entity: "WhatsAppConnection", entityId: connection.id, afterData: { instanceId: connection.instanceId, serverUrl: connection.serverUrl } } });
    return NextResponse.json({ connection: connectionView(await whatsappConnection(auth.member.organizationId)), qrCode: state?.qrCode || null, pairCode: state?.pairCode || null });
  } catch (error) { return NextResponse.json({ error: error instanceof Error && !/tokenEncrypted|prisma|encryption/i.test(error.message) ? error.message : "Não foi possível configurar a conexão. Confira o servidor e a credencial." }, { status: 502 }); }
}
