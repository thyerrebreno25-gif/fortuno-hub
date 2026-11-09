import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/whatsapp/server", () => ({ resolveWhatsappTicketId: async (id: string) => id }));
const m = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), find: vi.fn(), download: vi.fn(), stored: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsAppConnection: { findUnique: vi.fn(async () => ({ id: "conn", organizationId: "org", phone: "5511888888888", instanceId: "instance", status: "CONNECTED", expiresAt: null, webhookConfiguredAt: new Date() })) }, serviceAttachment: { findFirst: m.find } } }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: m.member, getWhatsAppPermission: m.permission }));
vi.mock("@/modules/whatsapp/uazapi-server", () => ({ downloadUazapiMedia: m.download }));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({storage:{from:()=>({download:m.stored})}})}));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "ticket", attachmentId: "attachment" }) };
beforeEach(() => { vi.clearAllMocks(); m.member.mockResolvedValue({ organizationId: "org", role: "MASTER" }); m.permission.mockResolvedValue({ canView: true }); m.find.mockResolvedValue({ name: "AudioMessage", mimeType: null, externalAttachmentId: "uazapi:i:msg" }); m.download.mockResolvedValue({ body: new TextEncoder().encode("OggS123456"), mimeType: "", size: 10 }); });
describe("Authorized WhatsApp media previews", () => {
  it("serves inline audio with the correct MIME and partial content for seeking", async () => {
    const response = await GET(new Request("https://hub/file?preview=1", { headers: { Range: "bytes=4-7" } }), context);
    expect(response.status).toBe(206); expect(response.headers.get("content-type")).toBe("audio/ogg"); expect(response.headers.get("content-range")).toBe("bytes 4-7/10"); expect(response.headers.get("content-disposition")).toContain("inline"); expect(await response.text()).toBe("1234");
  });
  it("keeps ordinary downloads as attachments", async () => { const response = await GET(new Request("https://hub/file"), context); expect(response.status).toBe(200); expect(response.headers.get("content-disposition")).toContain("attachment"); });
  it("does not allow HTML previews", async () => { m.download.mockResolvedValue({ body: new TextEncoder().encode("<html>"), mimeType: "text/html" }); expect((await GET(new Request("https://hub/file?preview=1"), context)).status).toBe(415); });
  it("rejects unsatisfiable ranges", async () => { const response = await GET(new Request("https://hub/file?preview=1", { headers: { Range: "bytes=50-" } }), context); expect(response.status).toBe(416); expect(response.headers.get("content-range")).toBe("bytes */10"); });
  it("requires authentication and view permission before accessing media", async () => {
    m.member.mockResolvedValueOnce(null); expect((await GET(new Request("https://hub/file?preview=1"), context)).status).toBe(401);
    m.permission.mockResolvedValueOnce({ canView: false }); expect((await GET(new Request("https://hub/file?preview=1"), context)).status).toBe(403); expect(m.download).not.toHaveBeenCalled();
  });
  it("scopes the attachment lookup to the user's organization and ticket", async () => {
    m.find.mockResolvedValueOnce(null); expect((await GET(new Request("https://hub/file?preview=1"), context)).status).toBe(404);
    expect(m.find.mock.calls[0][0].where.message).toMatchObject({ ticketId: "ticket", ticket: { organizationId: "org", source: "WHATSAPP_API" } }); expect(m.download).not.toHaveBeenCalled();
  });
});

it("downloads sent private attachments through the same authenticated route",async()=>{
 m.find.mockResolvedValueOnce({name:"arquivo.pdf",mimeType:"application/pdf",externalAttachmentId:null,storagePath:"org/ticket/upload/file.pdf"});m.stored.mockResolvedValueOnce({data:new Blob(["%PDF-1.7"])});
 const response=await GET(new Request("https://hub/file"),context);expect(response.status).toBe(200);expect(await response.text()).toBe("%PDF-1.7");expect(m.download).not.toHaveBeenCalled();
});
it("rejects a private storage path outside the authenticated organization",async()=>{
 m.find.mockResolvedValueOnce({name:"arquivo.pdf",mimeType:"application/pdf",externalAttachmentId:null,storagePath:"other/ticket/file.pdf"});
 expect((await GET(new Request("https://hub/file"),context)).status).toBe(502);expect(m.stored).not.toHaveBeenCalled();
});
