import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), account: vi.fn(), preview: vi.fn(), clear: vi.fn(), restore: vi.fn(), last: vi.fn() }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: m.member, getWhatsAppPermission: m.permission, SERVICE_CENTER_MANAGER_ROLES: new Set(["MASTER", "ADMIN", "MANAGER"]) }));
vi.mock("@/modules/whatsapp/account-scope", () => ({ currentWhatsAppAccount: m.account }));
vi.mock("@/modules/whatsapp/payment-cleanup", () => ({ PaymentCleanupError: class extends Error { status = 409; }, previewPaymentCleanup: m.preview, clearPaymentAlerts: m.clear, restorePaymentCleanup: m.restore, lastPaymentCleanup: m.last }));
import { POST } from "./route";
const run = (body: unknown) => POST(new Request("https://hub.test/api/whatsapp/payment-requests/cleanup", { method: "POST", body: JSON.stringify(body) }));
const input = { action: "PREVIEW", range: { mode: "BEFORE", to: "2026-10-01" } };
beforeEach(() => { vi.resetAllMocks(); m.member.mockResolvedValue({ role: "MASTER", organizationId: "org", userId: "me" }); m.permission.mockResolvedValue({ canView: true, canEdit: true }); m.account.mockResolvedValue({ recipient: "current" }); m.preview.mockResolvedValue({ count: 2 }); });
it.each(["OPERATOR", "CLIENT"])("refuses cleanup for %s before reading any alerts", async role => {
  m.member.mockResolvedValue({ role }); expect((await run(input)).status).toBe(403); expect(m.preview).not.toHaveBeenCalled();
});
it("requires editing permission and scopes cleanup to the authenticated identity", async () => {
  expect((await run(input)).status).toBe(200); expect(m.preview).toHaveBeenCalledWith({ organizationId: "org", userId: "me", recipient: "current" }, input.range);
  m.permission.mockResolvedValue({ canView: true, canEdit: false }); expect((await run(input)).status).toBe(403);
});
it("requires the preview fingerprint and rejects forged scope or unsupported operations", async () => {
  for (const body of [{ action: "CLEAR", range: input.range }, { ...input, userId: "other" }, { action: "DELETE_ALL" }]) expect((await run(body)).status).toBe(400);
  expect(m.clear).not.toHaveBeenCalled(); expect(m.restore).not.toHaveBeenCalled();
});
