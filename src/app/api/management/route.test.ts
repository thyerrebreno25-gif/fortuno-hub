import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), client: vi.fn(), permissions: vi.fn(), findMany: vi.fn(), connection: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), transaction: vi.fn(), audit: vi.fn(), source: vi.fn() }));
vi.mock("@/modules/assistant/auth", () => ({ getMemberForModule: mocks.member, findAssistantClient: mocks.client, assistantClientAccessWhere: () => ({ OR: [{ generalResponsibleId: "u" }] }) }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permissions }));
vi.mock("@/modules/management/source", () => ({ fetchManagementSnapshot: mocks.source }));
vi.mock("@/modules/notion/server", () => ({ notionToken: vi.fn(), notionFetch: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { client: { findMany: mocks.findMany }, contaAzulConnection: { findFirst: mocks.connection }, clientManagement: { upsert: mocks.upsert, updateMany: mocks.updateMany, findUnique: mocks.findUnique, update: mocks.update }, auditLog: { create: mocks.audit }, $transaction: mocks.transaction } }));
import { GET, PATCH, POST } from "./route";
const request = (body: unknown, method = "POST") => new Request("https://hub.test/api/management", { method, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.member.mockResolvedValue({ organizationId: "org", userId: "u", role: "OPERATOR", user: { name: "Operador" } });
  mocks.client.mockResolvedValue({ id: "c" }); mocks.permissions.mockResolvedValue({ MANAGEMENT: { canView: true, canEdit: true, canManage: false } });
});
it("requires management access and always scopes the list to assigned organization clients", async () => {
  mocks.member.mockResolvedValueOnce(null); expect((await GET()).status).toBe(403);
  mocks.findMany.mockResolvedValue([]); expect((await GET()).status).toBe(200);
  expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org", active: true, OR: [{ generalResponsibleId: "u" }] } }));
});
it("does not call Conta Azul for a client outside the caller scope", async () => {
  mocks.client.mockResolvedValueOnce(null);
  expect((await POST(request({ clientId: "other" }))).status).toBe(404);
  expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.connection).not.toHaveBeenCalled();
});
it("prevents simultaneous refreshes of a rotating Conta Azul token", async () => {
  mocks.connection.mockResolvedValue({ id: "conn" }); mocks.updateMany.mockResolvedValue({ count: 0 });
  expect((await POST(request({ clientId: "c" }))).status).toBe(409); expect(mocks.source).not.toHaveBeenCalled();
});
it("rejects edits from viewers and stale check revisions without audit writes", async () => {
  mocks.permissions.mockResolvedValueOnce({ MANAGEMENT: { canEdit: false } });
  expect((await PATCH(request({ clientId: "c" }, "PATCH"))).status).toBe(403);
  mocks.findUnique.mockResolvedValue({ snapshot: { accounts: [{ id: "a" }] }, checkedAccounts: { other: { note: "preserve" } } });
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation(async (fn) => fn({ clientManagement: { updateMany: mocks.updateMany }, auditLog: { create: mocks.audit } }));
  const response = await PATCH(request({ clientId: "c", accountId: "a", revision: 1, bankBalance: null, balanceAt: null, lastImportAt: null, pendingPayable: null, pendingReceivable: null }, "PATCH"));
  expect(response.status).toBe(409); expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.updateMany.mock.calls[0][0].data.checkedAccounts.other).toEqual({ note: "preserve" });
});
