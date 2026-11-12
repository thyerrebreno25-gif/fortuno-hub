import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ update: vi.fn(), request: vi.fn(), find: vi.fn(), directory: vi.fn(), directorySync: vi.fn(), historySync: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsAppConnection: { update: m.update, findUnique: m.find }, whatsAppDirectoryEntry: { updateMany: m.directory }, whatsAppDirectorySync: { updateMany: m.directorySync }, whatsAppHistorySync: { updateMany: m.historySync } } }));
vi.mock("./directory", () => ({ scheduleDirectorySync: vi.fn() }));
vi.mock("./history-sync", () => ({ scheduleHistorySync: vi.fn() }));
vi.mock("@/modules/purchase-invoices/server/crypto", () => ({ decryptIntegrationSecret: () => "private-token" }));
vi.mock("./uazapi", async (original) => ({ ...await original<typeof import("./uazapi")>(), uazapiRequest: m.request }));
import { checkConnection, configureWebhook, connectionView, sendUazapiText, sendUazapiMedia, sendUazapiReaction, type whatsappConnection } from "./uazapi-server";
const connection = { id: "connection", instanceId: "instance", organizationId: "org", serverUrl: "https://free.uazapi.com", tokenEncrypted: "encrypted-secret", tokenHash: "private-hash", status: "DISCONNECTED", expiresAt: null } as NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
beforeEach(() => { vi.clearAllMocks(); m.update.mockResolvedValue({}); });
describe("Uazapi server-side connection", () => {
  it("projects connection information without credentials", () => {
    const result = JSON.stringify(connectionView(connection)); expect(result).not.toMatch(/encrypted-secret|private-hash|tokenEncrypted|tokenHash/);
    expect(connectionView({ ...connection, expiresAt: new Date(0) }).status).toBe("EXPIRED");
  });
  it("adds its webhook without replacing other subscriptions", async () => {
    const url = "https://app.hubsuporte.shop/api/whatsapp/uazapi/webhook/connection";
    m.request.mockResolvedValueOnce([{ id: "other", url: "https://other.example/hook" }]).mockResolvedValueOnce({}).mockResolvedValueOnce([{ id: "own", url, enabled: true, events: ["messages", "messages_update", "connection", "history", "call"] }]);
    await configureWebhook(connection);
    expect(m.request.mock.calls[1][3]).toMatchObject({ action: "add", url, excludeMessages: [] }); expect(m.request.mock.calls[1][3].id).toBeUndefined(); expect(m.update.mock.calls[0][0].data.webhookId).toBe("own");
  });
  it("does not claim receiving is configured until the provider confirms it", async () => {
    m.request.mockResolvedValueOnce([]).mockResolvedValueOnce({}).mockResolvedValueOnce([]);
    await expect(configureWebhook(connection)).rejects.toThrow("não foi confirmada"); expect(m.update).not.toHaveBeenCalled();
  });
  it("refuses credentials that resolve to another instance", async () => {
    m.request.mockResolvedValueOnce({ instance: { id: "another", status: "connected" } }); await expect(checkConnection(connection)).rejects.toThrow("outra instância"); expect(m.update).not.toHaveBeenCalled();
  });
  it("retires the previous physical account's contacts and pending syncs when the number changes", async () => {
    m.request.mockResolvedValueOnce({ instance: { id: "instance", status: "connected", owner: "5522999999999" } });
    await checkConnection({ ...connection, phone: "5511888888888" });
    expect(m.update.mock.calls[0][0].data.phone).toBe("5522999999999");
    expect(m.directory).toHaveBeenCalledWith({ where: { connectionId: "connection", accountPhone: { not: "5522999999999" } }, data: { active: false } });
    for (const cancel of [m.directorySync, m.historySync]) expect(cancel.mock.calls[0][0]).toMatchObject({ where: { connectionId: "connection", accountPhone: { not: "5522999999999" } }, data: { status: "CANCELLED" } });
  });
  it("rejects a reply from an old account even when the provider instance was reused", async () => {
    m.find.mockResolvedValue({ ...connection, status: "CONNECTED", webhookConfiguredAt: new Date(), phone: "5522999999999" });
    await expect(sendUazapiText({ organizationId: "org", to: "5511000000000", body: "test", instanceId: "instance", accountRecipient: "wa-account:connection:5511888888888" })).rejects.toThrow("número conectado mudou");
    expect(m.request).not.toHaveBeenCalled();
  });
});

it("uses the documented media payload and confirms the provider message id",async()=>{
 m.find.mockResolvedValue({...connection,status:"CONNECTED",webhookConfiguredAt:new Date(),phone:"5511"});m.request.mockResolvedValueOnce({messageid:"sent-media"});
 const sent=await sendUazapiMedia({organizationId:"org",accountRecipient:"wa-account:connection:5511",to:"5522",type:"document",file:"https://storage.example/signed",name:"arquivo.pdf",mimeType:"application/pdf",caption:"Documento",trackingId:"upload"});
 expect(sent.messageId).toBe("uazapi:5511:sent-media");expect(m.request.mock.calls[0].slice(2)).toEqual(["/send/media",{number:"5522",type:"document",file:"https://storage.example/signed",text:"Documento",docName:"arquivo.pdf",mimetype:"application/pdf",track_source:"FORTUNO_HUB",track_id:"upload"}]);
});
it("uses id and text for provider reactions and rejects old physical accounts",async()=>{
 m.find.mockResolvedValue({...connection,status:"CONNECTED",webhookConfiguredAt:new Date(),phone:"5511"});m.request.mockResolvedValueOnce({success:true});
 await sendUazapiReaction({organizationId:"org",accountRecipient:"wa-account:connection:5511",messageId:"target",emoji:"👍"});expect(m.request.mock.calls[0].slice(2)).toEqual(["/message/react",{id:"target",text:"👍"}]);
 await expect(sendUazapiReaction({organizationId:"org",accountRecipient:"wa-account:connection:old",messageId:"target",emoji:"👍"})).rejects.toThrow("número conectado mudou");expect(m.request).toHaveBeenCalledTimes(1);
});

it("sends replyid only when explicitly given for text and media",async()=>{
 m.find.mockResolvedValue({...connection,status:"CONNECTED",webhookConfiguredAt:new Date(),phone:"5511"});m.request.mockResolvedValue({messageid:"answer"});
 await sendUazapiText({organizationId:"org",accountRecipient:"wa-account:connection:5511",to:"5522",body:"Resposta",replyToMessageId:"original"});expect(m.request.mock.calls[0][3]).toMatchObject({replyid:"original"});
 await sendUazapiMedia({organizationId:"org",accountRecipient:"wa-account:connection:5511",to:"5522",type:"image",file:"https://storage.example/print",name:"print.png",mimeType:"image/png",caption:"Segue o print",trackingId:"upload",replyToMessageId:"original"});expect(m.request.mock.calls[1][3]).toMatchObject({replyid:"original",type:"image"});
});
