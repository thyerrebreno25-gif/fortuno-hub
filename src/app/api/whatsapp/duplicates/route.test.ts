import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), connection: vi.fn(), plan: vi.fn(), merge: vi.fn() }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: m.member, getWhatsAppPermission: m.permission }));
vi.mock("@/modules/whatsapp/uazapi-server", () => ({ whatsappConnection: m.connection }));
vi.mock("@/modules/whatsapp/merge", () => ({ duplicatePlan: m.plan, planView: (plan: unknown) => plan, mergeDuplicates: m.merge, MergeConflict: class extends Error {} }));
import { GET, POST } from "./route";
const fingerprint = "a".repeat(64);
beforeEach(() => { vi.resetAllMocks(); m.member.mockResolvedValue({ organizationId: "org", role: "MASTER", userId: "user" }); m.permission.mockResolvedValue({ canEdit: true, canManage: true }); m.connection.mockResolvedValue({ id: "c", organizationId: "org", phone: "5511999999999" }); m.plan.mockResolvedValue({ fingerprint, groups: [] }); m.merge.mockResolvedValue({ merged: 1, messages: 2, skipped: [] }); });
describe("Duplicate cleanup authorization", () => {
  it("requires an authenticated manager with edit access", async () => {
    m.member.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    m.member.mockResolvedValueOnce({ organizationId: "org", role: "OPERATOR" }); m.permission.mockResolvedValueOnce({ canEdit: true, canManage: false }); expect((await GET()).status).toBe(403);
    expect(m.plan).not.toHaveBeenCalled(); expect(m.merge).not.toHaveBeenCalled();
  });
  it("preview is read-only and scoped to the member organization", async () => {
    const response = await GET(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(m.connection).toHaveBeenCalledWith("org"); expect(m.merge).not.toHaveBeenCalled();
  });
  it("requires explicit product confirmation and the reviewed fingerprint", async () => {
    const request = (body: unknown) => new Request("https://hub.test/api/whatsapp/duplicates", { method: "POST", body: JSON.stringify(body) });
    expect((await POST(request({ fingerprint }))).status).toBe(400); expect(m.merge).not.toHaveBeenCalled();
    expect((await POST(request({ fingerprint, confirmation: "UNIR_ATENDIMENTOS" }))).status).toBe(200);
    expect(m.merge).toHaveBeenCalledWith({ id: "c", organizationId: "org", phone: "5511999999999" }, "user", fingerprint);
  });
});
