import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), client: vi.fn(), batches: vi.fn(), request: vi.fn(), batch: vi.fn(), update: vi.fn(), audit: vi.fn(), lease: vi.fn() }));
vi.mock("@/lib/prisma", () => { const tx = { contaAzulFinancialExport: { findMany: mocks.batches, findFirst: mocks.batch, update: vi.fn() }, contaAzulFinancialExportLine: { update: mocks.update }, auditLog: { create: mocks.audit }, documentImportDispatchLease: { upsert: vi.fn(), updateMany: mocks.lease, findFirst: vi.fn(async () => ({})) } }; return { prisma: { ...tx, $transaction: async (run: (tx: unknown) => unknown) => run(tx) } }; });
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permission }));
vi.mock("@/modules/purchase-invoices/server/auth", () => ({ getPurchaseInvoiceMember: mocks.member, findAuthorizedClient: mocks.client }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
import { GET, POST } from "./route";
const request = (query = "") => new Request("https://example.test/history?clientId=client1" + query);
beforeEach(() => { vi.resetAllMocks(); mocks.member.mockResolvedValue({ organizationId: "org1" }); mocks.permission.mockResolvedValue({ IMPORTS: { canExport: true, canEdit: true }, PURCHASE_INVOICES: { canExport: false } }); mocks.client.mockResolvedValue({ id: "client1" }); mocks.batches.mockResolvedValue([]); });
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

const prepare = () => POST(new Request("https://example.test/history", { method: "POST", body: JSON.stringify({ exportId: "batch", confirmation: "PREPARAR REENVIO" }) }));
function missingBatch() {
  mocks.batch.mockResolvedValue({ id: "batch", clientId: "client1", lines: [{ id: "line", lineKey: "key", direction: "PAYABLE", description: "Compra", amount: 10, createdAt: new Date("2026-01-01"), dueDate: new Date("2026-10-20"), externalInstallmentId: "old-installment", externalEventId: "old-event", metadata: { originalLineKey: "original" } }] });
  mocks.lease.mockResolvedValue({ count: 1 });
}
it("only prepares missing references after independent absence checks, without writing to CA", async () => {
  missingBatch();
  mocks.request.mockImplementation(async (_client, path: string) => { if (path.includes("/buscar?")) return { itens: [], itens_totais: 0 }; throw Object.assign(new Error("Not found"), { status: 404 }); });
  const result = await (await prepare()).json(); expect(result).toMatchObject({ prepared: 1, writesToContaAzul: 0 });
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ status: "PENDING", externalEventId: null, externalInstallmentId: null, metadata: { previousExternal: { eventId: "old-event", installmentId: "old-installment" } } });
  expect(mocks.audit).toHaveBeenCalled(); expect(mocks.request.mock.calls.every((call) => !call[2]?.method)).toBe(true);
});
it("preserves an existing parcel and never prepares it for recreation", async () => {
  missingBatch(); mocks.request.mockResolvedValue({ id: "old-installment" });
  expect(await (await prepare()).json()).toMatchObject({ prepared: 0 }); expect(mocks.update).not.toHaveBeenCalled();
});
it("does not clear references when the absence query is incomplete or fails", async () => {
  missingBatch(); mocks.request.mockImplementation(async (_client, path: string) => { if (path.includes("/buscar?")) return { itens: [], itens_totais: 1 }; throw Object.assign(new Error("Not found"), { status: 404 }); });
  expect(await (await prepare()).json()).toMatchObject({ prepared: 0 }); expect(mocks.update).not.toHaveBeenCalled();
});
