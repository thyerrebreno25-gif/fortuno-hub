import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), company: vi.fn(), options: vi.fn(), balance: vi.fn() }));
vi.mock("@/modules/document-imports/server", () => ({ importAccess: mocks.access, authorizedCompany: mocks.company, importOptions: mocks.options }));
vi.mock("@/modules/document-imports/account-balance", () => ({ closingAccountBalance: mocks.balance }));
import { POST } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
const request = () => new Request("https://example.test/api/document-imports/balances", { method: "POST", body: JSON.stringify({ clientId: "company", date: "2026-10-31", accountIds: [id, id] }) });
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ member: { organizationId: "org" }, permission: { canView: true } }); mocks.company.mockResolvedValue({ id: "company" }); mocks.options.mockResolvedValue({ financialAccounts: [{ value: id }] }); mocks.balance.mockResolvedValue({ accountId: id, date: "2026-10-31", balanceCents: 100, method: "RECONSTRUCTED" }); });
it("requires access to the investment module and the current organization's company", async () => {
  mocks.access.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(401);
  mocks.access.mockResolvedValueOnce({ permission: { canView: false } }); expect((await POST(request())).status).toBe(403);
  mocks.company.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(404);
  expect(mocks.options).not.toHaveBeenCalled(); expect(mocks.balance).not.toHaveBeenCalled();
});
it("rejects a foreign financial account before reading its balance", async () => {
  mocks.options.mockResolvedValue({ financialAccounts: [] }); expect((await POST(request())).status).toBe(400); expect(mocks.balance).not.toHaveBeenCalled();
});
it("queries each authorized account once at the requested cutoff", async () => {
  expect((await POST(request())).status).toBe(200); expect(mocks.balance).toHaveBeenCalledTimes(1);
  expect(mocks.balance).toHaveBeenCalledWith("company", id, "2026-10-31", expect.any(Date), expect.any(Number));
});
