import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), find: vi.fn(), update: vi.fn(), claim: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { purchaseInvoice: { findFirst: mocks.find, update: mocks.update, updateMany: mocks.claim } } }));
vi.mock("@/modules/purchase-invoices/server/auth", () => ({ getPurchaseInvoiceMember: mocks.member, getPurchaseInvoicePermission: mocks.permission }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request, ContaAzulApiError: class extends Error { status = 400; } }));
import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue({ organizationId: "org" });
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.permission.mockResolvedValue({ canExport: true });
  mocks.find.mockResolvedValue({
    id: "invoice", clientId: "client", status: "READY_TO_SEND", externalPayableProtocolId: null, lastError: null,
    connection: { active: true }, supplierContaAzulId: "supplier-from-invoice", supplierName: "Fornecedor da nota",
    financialAccountId: "account", totalInvoice: 100, competenceDate: new Date("2026-10-19T12:00:00Z"), number: "123", paymentMethod: "OUTRO",
    items: [{ contaAzulCategoryId: "category", allocationAmount: 100 }],
    installments: [{ source: "XML", amount: 100, dueDate: new Date("2026-11-19T12:00:00Z") }],
  });
  mocks.request.mockImplementation(async (_client, _path, options) => {
    const payload = JSON.parse(options.body);
    if (!payload.id_fornecedor) throw new Error("O campo id_cliente/id_fornecedor é obrigatório");
    return { id: "11111111-1111-4111-8111-111111111111", tipo: "DESPESA" };
  });
});

describe("envio de nota de compra", () => {
  it("envia o fornecedor vinculado à nota no campo exigido pela API", async () => {
    const result = await POST(new Request("http://localhost/api/purchase-invoices/invoice/send", { method: "POST" }), { params: Promise.resolve({ id: "invoice" }) });
    expect(result.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const [client, path, options] = mocks.request.mock.calls[0];
    expect(client).toBe("client");
    expect(path).toBe("/v1/financeiro/contas-a-pagar");
    const payload = JSON.parse(options.body);
    expect(payload.id_fornecedor).toBe("supplier-from-invoice");
    expect(payload).not.toHaveProperty("contato");
    expect(payload.condicao_pagamento.parcelas[0].detalhe_valor.valor_bruto).toBe(100);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", externalPayableProtocolId: "11111111-1111-4111-8111-111111111111" }) }));
  });
  it("bloqueia o reenvio após a mensagem antiga de protocolo ausente", async () => {
    mocks.find.mockResolvedValue({ ...(await mocks.find()), status: "FAILED", lastError: "A Conta Azul aceitou a requisição, mas não devolveu o protocolo da despesa." });
    const result = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "invoice" }) });
    expect(result.status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("mantém envios sem resposta conclusiva bloqueados para conferência", async () => {
    mocks.request.mockResolvedValue({});
    const result = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "invoice" }) });
    expect(result.status).toBe(502);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: expect.stringContaining("Envio em conferência:") }) }));
  });
  it("impede duas chamadas externas quando outro envio já reservou a nota", async () => {
    mocks.claim.mockResolvedValue({ count: 0 });
    const result = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "invoice" }) });
    expect(result.status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("continua aceitando respostas antigas com protocolo", async () => {
    mocks.request.mockResolvedValue({ protocolo: "old-protocol" });
    const result = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "invoice" }) });
    expect(result.status).toBe(200);
    expect((await result.json()).protocolId).toBe("old-protocol");
  });
  it("não reenvia nota que já tem protocolo", async () => {
    const invoice = await mocks.find();
    mocks.find.mockResolvedValue({ ...invoice, externalPayableProtocolId: "existing" });
    const result = await POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "invoice" }) });
    expect(result.status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
