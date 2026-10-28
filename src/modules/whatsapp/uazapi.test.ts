import { afterEach, describe, expect, it, vi } from "vitest";
import { instanceState, normalizeUazapiEvent, serverUrl, tokenHash, tokenMatches, uazapiRequest } from "./uazapi";
import { normalizeWhatsappIdentity } from "./core";
afterEach(() => vi.unstubAllGlobals());
describe("Uazapi credentials and server isolation", () => {
  it.each(["http://free.uazapi.com", "https://evil.example", "https://uazapi.com.evil.example", "https://free.uazapi.com@evil.example", "https://user:pass@free.uazapi.com", "https://free.uazapi.com/path", "https://free.uazapi.com?token=secret", "https://free.uazapi.com#secret", "https://free.uazapi.com:8443"])("rejects an unsafe destination: %s", (url) => expect(() => serverUrl(url)).toThrow());
  it("accepts the official free server and compares credential hashes", () => {
    expect(serverUrl("https://free.uazapi.com/")).toBe("https://free.uazapi.com");
    expect(tokenMatches("instance-secret", tokenHash("instance-secret"))).toBe(true);
    expect(tokenMatches("different", tokenHash("instance-secret"))).toBe(false);
    expect(tokenMatches("different", "invalid")).toBe(false);
  });
  it("does not follow redirects or expose provider error bodies", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("secret-provider-body", { status: 401 })); vi.stubGlobal("fetch", fetch);
    await expect(uazapiRequest("https://free.uazapi.com", "secret", "/instance/status")).rejects.toThrow("recusou o token");
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { token: "secret" } });
  });
});
describe("Uazapi real status and webhook normalization", () => {
  it("does not treat valid credentials or a QR as a connected WhatsApp", () => {
    const state = instanceState({ instance: { id: "a", token: "private", status: "connecting", qrcode: "<script>" } });
    expect(state.status).toBe("CONNECTING"); expect(state.qrCode).toBeNull(); expect(JSON.stringify(state)).not.toContain("private");
    expect(instanceState({ instance: { status: "connected" } }).status).toBe("CONNECTED");
  });
  it("strips credentials while preserving raw ids and group participants", () => {
    const result = normalizeUazapiEvent({ EventType: "messages", token: "private-token", BaseUrl: "private-host", message: { id: "owner:msg", messageid: "msg", chatid: "123-456@g.us", senderName: "Ana", sender: "5511@s.whatsapp.net", text: "Boleto", messageTimestamp: 1793193600000 }, chat: { name: "Empresa" } });
    expect(result).toMatchObject({ kind: "messages", id: "msg", apiId: "owner:msg", group: true, chatId: "123-456@g.us", senderName: "Ana", body: "Boleto" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("keeps LID identities separate from phone numbers", () => {
    expect(normalizeWhatsappIdentity("CONTACT", "123@lid")).toBe("123@lid");
    expect(normalizeWhatsappIdentity("CONTACT", "5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });
  it("normalizes media and API echoes without including arbitrary provider objects", () => {
    const result = normalizeUazapiEvent({ EventType: "messages", message: { id: "a", chatid: "123@lid", messageType: "DocumentMessage", fromMe: true, wasSentByApi: true, content: { fileName: "nota.pdf", mimetype: "application/pdf", unknown: "discard" } } });
    expect(result).toMatchObject({ fromMe: true, wasSentByApi: true, media: { id: "a", name: "nota.pdf", mimeType: "application/pdf" } });
    expect(JSON.stringify(result)).not.toContain("discard");
  });
  it("reads delivery ids and the highest group receipt", () => {
    expect(normalizeUazapiEvent({ EventType: "messages_update", state: "Delivered", event: { MessageIDs: ["a", "b"], Timestamp: 1793193600, Receipts: [{ state: "Read" }] } })).toMatchObject({ kind: "messages_update", status: "read", ids: ["a", "b"] });
  });
  it("ignores unsupported messages and invalid chats", () => {
    expect(normalizeUazapiEvent({ EventType: "contacts" })).toBeNull();
    expect(normalizeUazapiEvent({ EventType: "messages", message: { id: "a", chatid: "status@broadcast" } })).toBeNull();
  });
});
