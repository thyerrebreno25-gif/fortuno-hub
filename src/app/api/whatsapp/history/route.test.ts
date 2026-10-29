import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), connection: vi.fn(), schedule: vi.fn(), latest: vi.fn(), process: vi.fn(), reset: vi.fn(), after: vi.fn() }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: m.member, getWhatsAppPermission: m.permission }));
vi.mock("@/modules/whatsapp/uazapi-server", () => ({ whatsappConnection: m.connection }));
vi.mock("@/modules/whatsapp/history-sync", () => ({ scheduleHistorySync: m.schedule, latestHistorySync: m.latest, processWhatsAppHistory: m.process }));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsAppWebhookInbox: { updateMany: m.reset } } }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: m.after }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); m.member.mockResolvedValue({ organizationId: "org", role: "OPERATOR" }); m.permission.mockResolvedValue({ canEdit: true }); m.connection.mockResolvedValue({ id: "connection", instanceId: "instance", phone: "5511", status: "CONNECTED", expiresAt: null, tokenEncrypted: "secret" }); m.latest.mockResolvedValue({ status: "PENDING", queued: 0 }); });
describe("WhatsApp history recovery access", () => {
  it("requires authentication and edit permission", async () => {
    m.member.mockResolvedValueOnce(null); expect((await POST()).status).toBe(401); m.permission.mockResolvedValueOnce({ canEdit: false }); expect((await POST()).status).toBe(403); expect(m.connection).not.toHaveBeenCalled();
  });
  it("does not schedule history against an expired instance", async () => {
    m.connection.mockResolvedValueOnce({ status: "CONNECTED", phone: "5511", expiresAt: new Date(0) }); expect((await POST()).status).toBe(409); expect(m.schedule).not.toHaveBeenCalled();
  });
  it("schedules asynchronous recovery only for the member's connection without returning credentials", async () => {
    const response = await POST(); expect(response.status).toBe(202); expect(m.connection).toHaveBeenCalledWith("org"); expect(m.after).toHaveBeenCalledOnce(); expect(await response.text()).not.toContain("secret");
  });
  it("retries only history failures from the current instance", async () => {
    await POST(); expect(m.reset.mock.calls[0][0].where).toMatchObject({ connectionId: "connection", status: "FAILED", AND: [{ payload: { path: ["instanceId"], equals: "instance" } }, { payload: { path: ["event", "historical"], equals: true } }] });
  });
});
