import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), company: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/permissions/permissions", () => ({ getCurrentMember: vi.fn(), getRolePermissions: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { client: { findUnique: mocks.company } } }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
import { simulateReview } from "./server";
import { parseContract } from "./parsers";
const contract = () => ({ ...parseContract([]), buyer: "MHS", buyerDocument: "43541033000151", sellerDocument: "33822179000111", description: "Site e Branding", firstDueDate: "2026-11-15", startMonth: "2026-11-01", dueDay: 15, installments: 8, amountCents: 225000, totalCents: 1800000, paymentMethod: "BOLETO_BANCARIO" as const, categoryId: "category", accountId: "account", customerId: "customer" });
beforeEach(() => {
  vi.clearAllMocks(); mocks.company.mockResolvedValue({ document: "33.822.179/0001-11" });
  mocks.request.mockImplementation(async (_client: string, path: string) => path.startsWith("/v1/categorias") ? [{ id: "category", nome: "Receitas", tipo: "RECEITA" }] : path.startsWith("/v1/conta-financeira") ? [{ id: "account", nome: "Inter" }] : [{ id: "customer", nome: "MHS", documento: "43.541.033/0001-51" }]);
});
it("validates the real catalog references without performing any CA writes", async () => {
  const result = await simulateReview("company", contract());
  expect(result.errors).toEqual([]); expect(result.sales).toHaveLength(8); expect(result.totalCents).toBe(1800000); expect(result.writesToContaAzul).toBe(0);
  expect(mocks.request.mock.calls.every((call) => call.length === 2)).toBe(true);
});
it("rejects foreign categories, accounts, buyer documents and seller companies", async () => {
  mocks.company.mockResolvedValue({ document: "00000000000000" });
  const result = await simulateReview("company", { ...contract(), categoryId: "foreign", accountId: "foreign", buyerDocument: "11111111111111" });
  expect(result.errors.length).toBeGreaterThanOrEqual(4);
});
