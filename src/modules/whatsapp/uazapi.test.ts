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

it.each([true, 1, "true", "1"])("recognizes outbound provider flag %s without marking it as an incoming message", (flag) => {
 expect(normalizeUazapiEvent({EventType:"messages",message:{id:"own",chatid:"123@lid",fromMe:flag,wasSentByApi:flag,text:"Resposta"}})).toMatchObject({fromMe:true,wasSentByApi:true});
});
it.each([false, 0, "false", "0", undefined])("keeps incoming provider flag %s inbound", (flag) => {
 expect(normalizeUazapiEvent({EventType:"messages",message:{id:"in",chatid:"123@lid",fromMe:flag,text:"Pergunta"}})).toMatchObject({fromMe:false});
});

it("normalizes reactions separately so they never create calls or unread message bubbles",()=>{const event=normalizeUazapiEvent({EventType:"messages",message:{messageid:"reaction-id",chatid:"5511999999999@s.whatsapp.net",messageType:"ReactionMessage",sender:"5511999999999@s.whatsapp.net",text:"👍",content:{key:{id:"target"}},messageTimestamp:Date.now()}});expect(event).toMatchObject({kind:"reaction",targetId:"target",emoji:"👍",fromMe:false});});

it("preserves incoming replies to earlier messages independently of their reaction content",()=>{
 const event=normalizeUazapiEvent({EventType:"messages",message:{messageid:"answer",chatid:"5511999999999@s.whatsapp.net",messageType:"ExtendedTextMessage",quoted:"original",text:"Sim",content:{contextInfo:{stanzaId:"original",quotedMessage:{conversation:"Posso pagar amanhã?"}}}}});
 expect(event).toMatchObject({kind:"messages",body:"Sim",quote:{externalId:"original",fallback:{textBody:"Posso pagar amanhã?"}}});
});

it("handles deletion receipts and revocations as updates, never as a new inbound",()=>{
 expect(normalizeUazapiEvent({EventType:"messages_update",state:"Deleted",event:{MessageIDs:["old"]}})).toMatchObject({kind:"messages_update",ids:["old"],status:"deleted"});
 expect(normalizeUazapiEvent({EventType:"messages",message:{id:"revoke-event",chatid:"123@g.us",messageType:"ProtocolMessage",content:{type:0,key:{id:"original"}}}})).toMatchObject({kind:"messages_update",ids:["original"],status:"deleted"});
});

it.each([false,true])("normalizes incoming/outgoing calls as call records, not empty text (%s)",fromMe=>{
 const result=normalizeUazapiEvent({EventType:"messages",message:{messageid:"log",chatid:"123@lid",fromMe,messageType:"CallLogMessage",messageTimestamp:Date.parse("2026-11-11T13:20:00Z"),content:JSON.stringify({callOutcome:1,isVideo:false,durationSecs:0})}});
 expect(result).toMatchObject({kind:"messages",fromMe,media:null,call:{status:"missed",media:"voice"}});
 if(result?.kind==="messages")expect(result.body).toContain(fromMe?"realizada · não atendida":"perdida");
});
it("accepts live call notifications without retaining any credential or arbitrary content",()=>{
 const result=normalizeUazapiEvent({EventType:"call",owner:"5511",token:"secret",event:{CallID:"c",CallCreator:"5522@s.whatsapp.net",Timestamp:"2026-11-11T13:20:00Z",Data:{Tag:"offer",Attrs:{token:"secret"}}}});
 expect(result).toMatchObject({kind:"call",chatId:"5522@s.whatsapp.net",fromMe:false,call:{id:"c",status:"offered"}});expect(JSON.stringify(result)).not.toContain("secret");
});
