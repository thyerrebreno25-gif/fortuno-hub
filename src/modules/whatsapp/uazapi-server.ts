import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { instanceState, object, text, uazapiRequest } from "./uazapi";
export async function whatsappConnection(organizationId: string) {
  return prisma.whatsAppConnection.findUnique({ where: { organizationId } });
}
export function connectionView(connection: Awaited<ReturnType<typeof whatsappConnection>>) {
  if (!connection) return { configured: false, status: "NOT_CONFIGURED", provider: "UAZAPI" };
  return { configured: true, provider: "UAZAPI", serverUrl: connection.serverUrl, instanceName: connection.instanceName, phone: connection.phone, profileName: connection.profileName, status: connection.expiresAt && connection.expiresAt < new Date() ? "EXPIRED" : connection.status, isTestServer: connection.serverUrl === "https://free.uazapi.com", expiresAt: connection.expiresAt, webhookReady: Boolean(connection.webhookConfiguredAt), lastWebhookAt: connection.lastWebhookAt, lastCheckedAt: connection.lastCheckedAt, lastError: connection.lastError };
}
export async function checkConnection(connection: NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>) {
  const state = instanceState(await uazapiRequest(connection.serverUrl, decryptIntegrationSecret(connection.tokenEncrypted), "/instance/status"));
  if (state.instanceId && state.instanceId !== connection.instanceId) throw new Error("A credencial passou a apontar para outra instância. Confira a configuração.");
  await prisma.whatsAppConnection.update({ where: { id: connection.id }, data: { status: state.status, phone: state.phone || connection.phone, profileName: state.profileName || connection.profileName, lastCheckedAt: new Date(), lastError: null } });
  return state;
}
export async function configureWebhook(connection: NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>) {
  const token = decryptIntegrationSecret(connection.tokenEncrypted);
  const url = "https://app.hubsuporte.shop/api/whatsapp/uazapi/webhook/" + connection.id;
  const asList = (body: unknown) => Array.isArray(body) ? body.map(object) : Array.isArray(object(body).webhooks) ? (object(body).webhooks as unknown[]).map(object) : object(body).url ? [object(body)] : [];
  const hooks = asList(await uazapiRequest(connection.serverUrl, token, "/webhook"));
  const own = hooks.find((hook) => hook.url === url);
  if (own && !own.id) throw new Error("A Uazapi não informou o identificador do webhook. Confira o painel da instância.");
  await uazapiRequest(connection.serverUrl, token, "/webhook", { ...(own ? { action: "update", id: own.id } : { action: "add" }), enabled: true, url, events: ["connection", "messages", "messages_update"], excludeMessages: [], addUrlEvents: false, addUrlTypesMessages: false });
  const confirmed = asList(await uazapiRequest(connection.serverUrl, token, "/webhook")).find((hook) => hook.url === url && hook.enabled === true && Array.isArray(hook.events) && ["messages", "messages_update", "connection"].every((name) => (hook.events as unknown[]).includes(name)));
  if (!confirmed) throw new Error("A configuração do recebimento não foi confirmada pela Uazapi.");
  await prisma.whatsAppConnection.update({ where: { id: connection.id }, data: { webhookId: text(confirmed.id, 200) || null, webhookConfiguredAt: new Date(), lastError: null } });
}
export async function sendUazapiText(input: { organizationId: string; to: string; body: string; instanceId?: string; replyToMessageId?: string | null }) {
  const connection = await whatsappConnection(input.organizationId);
  if (!connection || connection.status !== "CONNECTED" || !connection.webhookConfiguredAt || connection.expiresAt && connection.expiresAt < new Date()) throw new Error("Conecte o WhatsApp na aba Conexão Uazapi antes de enviar.");
  if (input.instanceId && input.instanceId !== connection.instanceId) throw new Error("A conversa pertence a outra instância. Aguarde uma mensagem recebida pela conexão atual.");
  const response = object(await uazapiRequest(connection.serverUrl, decryptIntegrationSecret(connection.tokenEncrypted), "/send/text", { number: input.to, text: input.body, ...(input.replyToMessageId ? { replyid: input.replyToMessageId } : {}) }));
  const id = text(response.messageid || text(response.id).split(":").at(-1), 250);
  if (!id) throw new Error("A Uazapi não confirmou o identificador da mensagem. Confira o WhatsApp antes de repetir.");
  return { messageId: "uazapi:" + connection.instanceId + ":" + id, instanceId: connection.instanceId, connectionId: connection.id };
}
export async function downloadUazapiMedia(organizationId: string, externalId: string) {
  const connection = await whatsappConnection(organizationId);
  const [instance, ...parts] = externalId.replace(/^uazapi:/, "").split(":");
  if (!connection || connection.instanceId !== instance || !parts.length) throw new Error("Anexo de outra instância ou conexão indisponível.");
  const response = object(await uazapiRequest(connection.serverUrl, decryptIntegrationSecret(connection.tokenEncrypted), "/message/download", { id: parts.join(":"), return_base64: true, generate_mp3: false }));
  const data = text(response.base64Data, 35000000).replace(/^data:[^;]+;base64,/, "");
  if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new Error("A Uazapi não disponibilizou o conteúdo do anexo. Arquivos grandes podem exigir download pelo WhatsApp.");
  const body = Buffer.from(data, "base64");
  if (body.length > 25000000) throw new Error("O anexo excede o limite de download do Hub.");
  return { body: new Uint8Array(body), mimeType: text(response.mimetype, 150), size: body.length };
}
