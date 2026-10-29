import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/whatsapp/history-sync", () => ({ latestHistorySync: async () => null, processWhatsAppHistory: vi.fn() }));
const m = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), tickets: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { serviceTicket: { aggregate: m.tickets }, whatsAppConnection: { findUnique: m.connection } } }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: m.member, getWhatsAppPermission: m.permission }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); m.member.mockResolvedValue({ organizationId: "org", role: "MASTER" }); m.permission.mockResolvedValue({ canView: true }); m.tickets.mockResolvedValue({ _count: 3, _max: { updatedAt: new Date("2026-10-29T12:00:00Z") } }); m.connection.mockResolvedValue({ status: "CONNECTED", webhookConfiguredAt: new Date(), expiresAt: null }); });
describe("WhatsApp live revisions", () => {
  it("enforces authentication and permission before querying conversations", async () => {
    m.member.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    m.permission.mockResolvedValueOnce({ canView: false }); expect((await GET()).status).toBe(403); expect(m.tickets).not.toHaveBeenCalled();
  });
  it("scopes revisions to the organization and returns no message content or credentials", async () => {
    const response = await GET(); const data = await response.json(); expect(data.mode).toBe("CONNECTED"); expect(data.revision).toContain("2026-10-29");
    expect(m.tickets.mock.calls[0][0].where.organizationId).toBe("org"); expect(m.connection.mock.calls[0][0].select).not.toHaveProperty("tokenEncrypted"); expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("changes the revision for updates to an existing conversation", async () => {
    const first = await (await GET()).json(); m.tickets.mockResolvedValueOnce({ _count: 3, _max: { updatedAt: new Date("2026-10-29T12:00:02Z") } }); const second = await (await GET()).json(); expect(second.revision).not.toBe(first.revision);
  });
  it("does not show an expired trial as connected", async () => {
    m.connection.mockResolvedValueOnce({ status: "CONNECTED", webhookConfiguredAt: new Date(), expiresAt: new Date(0) }); expect((await (await GET()).json()).mode).toBe("DISCONNECTED");
  });
});
