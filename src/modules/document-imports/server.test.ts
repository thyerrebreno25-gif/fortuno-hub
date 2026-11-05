import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), company: vi.fn(), closing: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/permissions/permissions", () => ({ getCurrentMember: vi.fn(), getRolePermissions: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { client: { findUnique: mocks.company } } }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
vi.mock("@/modules/document-imports/account-balance", () => ({ closingAccountBalance: mocks.closing }));
import { simulateReview } from "./server";
import { parseInvestment } from "./parsers";
import { parseContract } from "./parsers";
const contract = () => ({ ...parseContract([]), buyer: "MHS", buyerDocument: "43541033000151", sellerDocument: "33822179000111", description: "Site e Branding", firstDueDate: "2026-11-15", startMonth: "2026-11-01", dueDay: 15, installments: 8, amountCents: 225000, totalCents: 1800000, paymentMethod: "BOLETO_BANCARIO" as const, categoryId: "category", accountId: "account", customerId: "customer", serviceId: "service" });
beforeEach(() => {
  vi.clearAllMocks(); mocks.company.mockResolvedValue({ document: "33.822.179/0001-11" });
  mocks.request.mockImplementation(async (_client: string, path: string) => path.startsWith("/v1/categorias") ? [{ id: "category", nome: "Receitas", tipo: "RECEITA" }] : path.startsWith("/v1/conta-financeira") ? [{ id: "account", nome: "Inter" }] : path.startsWith("/v1/servicos") ? [{ id: "service", descricao: "Serviço", status: "ATIVO", tipo_servico: "PRESTADO" }] : [{ id: "customer", nome: "MHS", documento: "43.541.033/0001-51" }]);
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

it.each([10000,11000,null])("keeps closing balance %s advisory while reading it from CA",async(balanceCents)=>{
 const review=parseInvestment([{page:1,text:"Período de: 01/10/2026 a 28/10/2026 Conta: 196592070"},{page:1,text:"CDB UM"},{page:1,text:"28/10/2026 Rendimento até esta data R$ 10,00 ABERTURA R$ 110,00"}]);
 expect(review.rows).toHaveLength(1);review.rows.forEach(row=>{row.categoryId="category";row.accountId="account";});
 mocks.closing.mockResolvedValue({accountId:"account",date:review.periodEnd,balanceCents,method:balanceCents===null?"UNAVAILABLE":"CURRENT"});
 const result=await simulateReview("company",review);expect(result.errors).toEqual([]);expect(result.balances).toHaveLength(1);expect(mocks.closing).toHaveBeenCalled();
 if(balanceCents!==10000)expect(result.warnings.length).toBeGreaterThan(0);
 expect(mocks.request.mock.calls.every(call=>call.length===2)).toBe(true);
});
