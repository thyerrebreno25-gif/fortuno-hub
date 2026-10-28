import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), options: vi.fn(), closing: vi.fn(), draftFind: vi.fn(), draftUpdateMany: vi.fn(), draftUpdate: vi.fn(), deliveryFind: vi.fn(), deliveryUnique: vi.fn(), deliveryCreate: vi.fn(), deliveryUpdate: vi.fn(), leaseUpsert: vi.fn(), leaseUpdate: vi.fn(), leaseFind: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/document-imports/server", () => ({ importOptions: mocks.options }));
vi.mock("@/modules/document-imports/account-balance", () => ({ closingAccountBalance: mocks.closing }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request, ContaAzulApiError: class extends Error { status = 400; } }));
vi.mock("@/lib/prisma", () => {
  const tx = { documentImportReview: { findFirst: mocks.draftFind, updateMany: mocks.draftUpdateMany, update: mocks.draftUpdate }, documentImportDelivery: { findMany: mocks.deliveryFind, findUnique: mocks.deliveryUnique, create: mocks.deliveryCreate, update: mocks.deliveryUpdate }, documentImportDispatchLease: { upsert: mocks.leaseUpsert, updateMany: mocks.leaseUpdate, findFirst: mocks.leaseFind }, auditLog: { create: mocks.audit } };
  return { prisma: { ...tx, $transaction: async (run: (client: unknown) => unknown) => run(tx) } };
});
import { sendInvestmentReview, incomeBusinessKey } from "./delivery";
import { parseInvestment } from "./parsers";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- The test store mirrors several external API payload shapes.
type RecordData = Record<string, any>;
let draft: RecordData, deliveries: RecordData[], sales: RecordData[], settlements: RecordData[];
beforeEach(() => {
  vi.clearAllMocks(); deliveries = []; sales = []; settlements = [];
  const review = parseInvestment(["Período de: 01/10/2026 a 28/10/2026 Conta: 196592070", "CDB UM", "28/10/2026 Rendimento até esta data R$ 10,00 ABERTURA R$ 110,00", "CDB DOIS", "28/10/2026 Rendimento até esta data R$ 20,00 ABERTURA R$ 220,00"].map((text) => ({ text, page: 1 })));
  review.rows.forEach((row) => { row.categoryId = id(3); row.accountId = id(4); });
  draft = { id: "review", clientId: "company", organizationId: "org", data: review, version: 1, status: "REVIEW" };
  mocks.draftFind.mockImplementation(({ where }) => where.version && where.version !== draft.version ? null : { ...draft });
  mocks.draftUpdateMany.mockImplementation(({ where, data }) => { if (where.version !== draft.version) return { count: 0 }; draft = { ...draft, status: data.status, version: draft.version + data.version.increment }; return { count: 1 }; });
  mocks.draftUpdate.mockImplementation(({ data }) => { draft = { ...draft, ...data }; return draft; });
  mocks.deliveryFind.mockImplementation(() => deliveries.map((row) => ({ ...row })));
  mocks.deliveryUnique.mockImplementation(({ where }) => deliveries.find((row) => row.businessKey === where.businessKey) || null);
  mocks.deliveryCreate.mockImplementation(({ data }) => { const row = { id: "delivery" + deliveries.length, status: "PENDING", saleNumber: null, saleId: null, eventId: null, installmentId: null, settlementId: null, lastError: null, ...data }; deliveries.push(row); return { ...row }; });
  mocks.deliveryUpdate.mockImplementation(({ where, data }) => { const index = deliveries.findIndex((row) => row.id === where.id); deliveries[index] = { ...deliveries[index], ...data }; return { ...deliveries[index] }; });
  mocks.leaseUpdate.mockResolvedValue({ count: 1 }); mocks.leaseFind.mockResolvedValue({});
  mocks.options.mockResolvedValue({ customers: [{ value: id(1) }], services: [{ value: id(2) }], categories: [{ value: id(3) }], financialAccounts: [{ value: id(4) }] });
  mocks.closing.mockImplementation(async () => ({ accountId: id(4), date: "2026-10-28", balanceCents: 30000 + settlements.reduce((sum, row) => sum + Math.round(row.valor_composicao.valor_liquido * 100), 0), method: "CURRENT", checkedAt: new Date().toISOString() }));
  mocks.request.mockImplementation(async (_client: string, path: string, options?: { method: string; body: string }) => {
    if (path.startsWith("/v1/pessoas?")) return [{ id: id(1), nome: "LANÇAMENTO AUTOMÁTICO - RECEITAS" }];
    if (path === "/v1/pessoas/" + id(1)) return { id: id(1), ativo: true, perfis: [{ tipo_perfil: "Cliente" }] };
    if (path === "/v1/financeiro/contas-a-receber" && options?.method === "POST") { const data = JSON.parse(options.body); const row = { id: id(1001 + sales.length), ...data }; sales.push(row); return { id: row.id }; }
    if (path.includes("contas-a-receber/buscar")) { const marker = new URL("https://example.test" + path).searchParams.get("descricao"); return { itens: sales.filter((item) => item.descricao.includes(marker)).map((item) => ({ id: id(20000 + Number(item.id.slice(-12))), descricao: item.descricao })) }; }
    if (path.endsWith("/parcelas")) { const sale = sales.find((item) => path.includes(item.id))!; return [{ id: id(20000 + Number(sale.id.slice(-12))), valor_liquido: sale.valor, data_vencimento: sale.data_competencia, nota: sale.observacao, conta_financeira: { id: sale.conta_financeira }, evento: { id: sale.id, tipo: "RECEITA", rateio: sale.rateio } }]; }
    if (path.includes("/parcelas/") && !path.endsWith("/baixa")) { const sale = sales.find((item) => path.endsWith(id(20000 + Number(item.id.slice(-12)))))!; return { nota: sale.observacao, evento: { id: sale.id } }; }
    if (path.endsWith("/baixa")) {
      const installment = path.split("/").at(-2);
      if (options?.method === "POST") { const data = JSON.parse(options.body); const row = { id: id(30000 + settlements.length), id_parcela: installment, ...data, valor_composicao: { valor_liquido: data.composicao_valor.valor_bruto } }; settlements.push(row); return { id: row.id }; }
      return settlements.filter((row) => row.id_parcela === installment);
    }
    throw new Error("Unexpected path " + path);
  });
});
const send = () => sendInvestmentReview({ organizationId: "org", userId: "master", reviewId: "review", version: draft.version });
const writes = (suffix: string) => mocks.request.mock.calls.filter((call) => call[2]?.method === "POST" && call[1].endsWith(suffix));
it("creates one financial receivable per type without commercial sales or services and settles the same amount/account/date", async () => {
  expect((await send()).completed).toBe(true); expect(sales).toHaveLength(2); expect(settlements).toHaveLength(2);
  expect(mocks.request.mock.calls.some((call) => call[1].startsWith("/v1/venda") || call[1].startsWith("/v1/servicos"))).toBe(false);
  expect(sales.every((sale) => !sale.itens && sale.id_cliente === id(1))).toBe(true);
  expect(sales.map((sale) => sale.valor)).toEqual([10, 20]);
  expect(settlements.every((row) => row.conta_financeira === id(4) && row.data_pagamento === "2026-10-28")).toBe(true);
  expect(draft.status).toBe("SENT"); expect(mocks.audit).toHaveBeenCalled();
  await send(); expect(sales).toHaveLength(2); expect(settlements).toHaveLength(2);
});
it("recovers an uncertain creation by marker without posting another sale", async () => {
  const implementation = mocks.request.getMockImplementation()!; let fail = true;
  mocks.request.mockImplementation(async (...args) => { const result = await implementation(...args); if (args[1] === "/v1/financeiro/contas-a-receber" && fail) { fail = false; throw new TypeError("network timeout after creation"); } return result; });
  expect((await send()).completed).toBe(false); expect(deliveries[0].status).toBe("UNCERTAIN_RECEIVABLE");
  expect((await send()).completed).toBe(true); expect(writes("/contas-a-receber")).toHaveLength(2); expect(settlements).toHaveLength(2);
});
it("does not retry a sale POST when its outcome cannot be found", async () => {
  const implementation = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args) => { if (args[1] === "/v1/financeiro/contas-a-receber") throw new TypeError("network timeout"); return implementation(...args); });
  expect((await send()).completed).toBe(false);
  await expect(send()).rejects.toThrow("incerto"); expect(writes("/contas-a-receber")).toHaveLength(1);
});
it("recovers an uncertain settlement and validates only the remaining income", async () => {
  const implementation = mocks.request.getMockImplementation()!; let fail = true;
  mocks.request.mockImplementation(async (...args) => { const result = await implementation(...args); if (args[1].endsWith("/baixa") && args[2]?.method === "POST" && fail) { fail = false; throw new TypeError("network timeout after settlement"); } return result; });
  expect((await send()).completed).toBe(false); expect(deliveries[0].status).toBe("UNCERTAIN_SETTLEMENT");
  expect((await send()).completed).toBe(true); expect(sales).toHaveLength(2); expect(writes("/baixa")).toHaveLength(2);
});
it("blocks a mismatching balance and an active company lease before creating anything", async () => {
  mocks.closing.mockResolvedValue({ accountId: id(4), date: "2026-10-28", balanceCents: 30001, method: "CURRENT" });
  await expect(send()).rejects.toThrow("saldo"); expect(deliveries).toHaveLength(0); expect(writes("/contas-a-receber")).toHaveLength(0);
  mocks.leaseUpdate.mockResolvedValueOnce({ count: 0 }); await expect(send()).rejects.toThrow("andamento");
});
it("uses the same monthly business key even when filenames, values or CA accounts change", () => {
  const review = draft.data;
  expect(incomeBusinessKey("org", "company", review, review.rows[0])).toBe(incomeBusinessKey("org", "company", { ...review, periodEnd: "2026-10-31" }, { ...review.rows[0], amountCents: 999, accountId: id(9) }));
  expect(incomeBusinessKey("org", "company", review, review.rows[0])).not.toBe(incomeBusinessKey("other", "company", review, review.rows[0]));
});

it("does not settle a receivable whose amount was changed in the ERP", async () => {
  const implementation = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args) => { const result = await implementation(...args); return args[1].endsWith("/parcelas") ? result.map((item: RecordData) => ({ ...item, valor_liquido: 999 })) : result; });
  expect((await send()).completed).toBe(false); expect(sales).toHaveLength(1); expect(settlements).toHaveLength(0);
  expect(deliveries[0].status).toBe("RECEIVABLE_CREATED");
});
it("blocks resuming legacy commercial deliveries through the financial flow", async () => {
  deliveries.push({ id: "old", status: "SALE_CREATED", saleId: id(9), saleNumber: 100, payload: {}, rowKey: draft.data.rows[0].key });
  await expect(send()).rejects.toThrow("envio comercial anterior");
  expect(sales).toHaveLength(0); expect(settlements).toHaveLength(0);
});
