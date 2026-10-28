import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), client: vi.fn(), batches: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { contaAzulFinancialExport: { findMany: mocks.batches } } }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permission }));
vi.mock("@/modules/purchase-invoices/server/auth", () => ({ getPurchaseInvoiceMember: mocks.member, findAuthorizedClient: mocks.client }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
import { GET } from "./route";
const request = (query = "") => new Request("https://example.test/history?clientId=client1" + query);
beforeEach(() => { vi.resetAllMocks(); mocks.member.mockResolvedValue({ organizationId: "org1" }); mocks.permission.mockResolvedValue({ IMPORTS: { canExport: true }, PURCHASE_INVOICES: { canExport: false } }); mocks.client.mockResolvedValue({ id: "client1" }); mocks.batches.mockResolvedValue([]); });
it("scopes diagnostics to the authorized client and organization", async () => {
  expect((await GET(request("&module=CREDIT_CARD_INVOICE"))).status).toBe(200);
  expect(mocks.batches.mock.calls[0][0].where).toEqual({ organizationId: "org1", clientId: "client1", module: "CREDIT_CARD_INVOICE" });
  expect(mocks.request).not.toHaveBeenCalled();
});
it("does not disclose history to unauthenticated or unauthorized users", async () => {
  mocks.member.mockResolvedValueOnce(null); expect((await GET(request())).status).toBe(401);
  mocks.permission.mockResolvedValueOnce({ IMPORTS: { canExport: false }, PURCHASE_INVOICES: { canExport: false } }); expect((await GET(request())).status).toBe(403);
  mocks.client.mockResolvedValueOnce(null); expect((await GET(request())).status).toBe(404);
  expect(mocks.batches).not.toHaveBeenCalled();
});
it("requires a specific batch for remote verification", async () => { expect((await GET(request("&verify=1"))).status).toBe(400); expect(mocks.request).not.toHaveBeenCalled(); });
