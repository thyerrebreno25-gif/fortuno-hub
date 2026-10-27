import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), poll: vi.fn(), after: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: m.after }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: m.member, getServiceCenterPermission: m.permission }));
vi.mock("@/modules/atendimento/gmail/sync", () => ({ pollGmailConnections: m.poll }));
import { POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); m.member.mockResolvedValue({ organizationId: "own-org", role: "OPERATOR" }); m.permission.mockResolvedValue({ canView: true }); });
it("requires authentication before starting any import", async () => {
  m.member.mockResolvedValueOnce(null);
  expect((await POST(new Request("https://hub.test/api/atendimento/gmail/sync", { method: "POST" }))).status).toBe(401); expect(m.after).not.toHaveBeenCalled();
});
it("checks service-center permission", async () => {
  m.permission.mockResolvedValueOnce({ canView: false });
  expect((await POST(new Request("https://hub.test/api/atendimento/gmail/sync", { method: "POST" }))).status).toBe(403); expect(m.after).not.toHaveBeenCalled();
});
it("runs only for the authenticated organization, after the response", async () => {
  expect((await POST(new Request("https://hub.test/api/atendimento/gmail/sync", { method: "POST" }))).status).toBe(202); expect(m.poll).not.toHaveBeenCalled();
  await m.after.mock.calls[0][0](); expect(m.poll).toHaveBeenCalledExactlyOnceWith("own-org", false);
});

it("does not let an operator bypass the five-minute interval", async () => {
  expect((await POST(new Request("https://hub.test/api/atendimento/gmail/sync?force=1", { method: "POST" }))).status).toBe(403);
  expect(m.after).not.toHaveBeenCalled();
});
