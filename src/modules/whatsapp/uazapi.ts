import { createHash, timingSafeEqual } from "node:crypto";
export const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const text = (value: unknown, max = 20000) => typeof value === "string" ? value.slice(0, max) : "";
export function serverUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/" || !/^(?:[a-z0-9-]+\.)*uazapi\.(com|dev)$/i.test(url.hostname)) throw new Error("Use a URL HTTPS do servidor Uazapi, sem caminhos ou parâmetros.");
  return url.origin;
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function tokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(tokenHash(token), "hex"), expected = Buffer.from(expectedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export function instanceState(body: unknown) {
  const root = object(body), instance = object(root.instance), state = object(root.status);
  const connected = state.connected === true || root.connected === true || instance.status === "connected";
  const raw = text(instance.status || root.status);
  const status = connected ? "CONNECTED" : raw === "connecting" ? "CONNECTING" : raw === "hibernated" ? "PAUSED" : "DISCONNECTED";
  const qr = text(instance.qrcode || root.qrcode, 2000000);
  const qrCode = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(qr) ? qr : /^[A-Za-z0-9+/=\s]{80,}$/.test(qr) ? "data:image/png;base64," + qr : null;
  return { status, instanceId: text(instance.id), instanceName: text(instance.name, 200), phone: text(object(state.jid).user || instance.owner || root.owner, 80).split("@")[0].replace(/\D/g, ""), profileName: text(instance.profileName, 200), qrCode: connected ? null : qrCode, pairCode: connected ? null : text(instance.paircode || root.paircode, 30), created: text(instance.created, 100) };
}
export async function uazapiRequest(base: string, token: string, path: string, body?: unknown) {
  const response = await fetch(serverUrl(base) + path, { method: body === undefined ? "GET" : "POST", headers: { token, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "A Uazapi recusou o token desta instância." : response.status === 404 ? "Instância não encontrada. No servidor gratuito, ela expira após uma hora." : "A Uazapi não concluiu a operação (HTTP " + response.status + ").");
  const result: unknown = await response.json();
  return result;
}
export function normalizeUazapiEvent(payload: unknown) {
  const root = object(payload), message = object(root.message), event = object(root.event), instance = object(root.instance), chat = object(root.chat);
  const kind = text(root.EventType, 50);
  if (!["messages", "messages_update", "connection"].includes(kind)) return null;
  if (kind === "connection") return { kind: "connection" as const, eventId: text(root.event_id, 200), status: text(instance.status, 30) };
  if (kind === "messages_update") {
    const receipts = Array.isArray(event.Receipts) ? event.Receipts.map(object) : [];
    const states = [root.state, event.Type, ...receipts.map((item) => item.state)].map((value) => text(value).toLowerCase());
    const status = states.includes("read") || states.includes("played") ? "read" : states.includes("delivered") ? "delivered" : states.includes("sent") ? "sent" : states.includes("failed") ? "failed" : "";
    return { kind: "messages_update" as const, ids: Array.isArray(event.MessageIDs) ? event.MessageIDs.filter((id): id is string => typeof id === "string").slice(0, 200) : [], status, timestamp: Number(event.Timestamp) || 0 };
  }
  const content = object(message.content), chatId = text(message.chatid || chat.wa_chatid, 150), id = text(message.messageid || text(message.id).split(":").at(-1), 200);
  if (!id || !/^[0-9]+(?:-[0-9]+)?@(s\.whatsapp\.net|g\.us|lid)$/.test(chatId)) return null;
  const fromMe = message.fromMe === true;
  const mediaType = text(message.messageType, 80);
  const media = /image|document|audio|video|sticker/i.test(mediaType);
  return { kind: "messages" as const, id, apiId: text(message.id || id, 250), chatId, group: chatId.endsWith("@g.us"), fromMe, wasSentByApi: message.wasSentByApi === true,
    senderName: text(message.senderName, 250), chatName: text(chat.name, 250), sender: text(message.sender, 150),
    body: text(message.text || content.caption || content.text || content.conversation || (typeof message.content === "string" ? message.content : "")) || (media ? "[" + mediaType + "]" : "[Mensagem sem texto]"), timestamp: Number(message.messageTimestamp) || Date.now(),
    media: media ? { id: text(message.id || id, 250), name: text(content.fileName || content.filename, 250) || mediaType, mimeType: text(content.mimetype || content.mimeType, 150) || null } : null,
  };
}
