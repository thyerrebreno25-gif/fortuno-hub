import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), client: vi.fn(), request: vi.fn() }));
vi.mock("@/modules/purchase-invoices/server/auth", () => ({ getPurchaseInvoiceMember: mocks.member, getPurchaseInvoicePermission: mocks.permission, findAuthorizedClient: mocks.client }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
import { GET } from "./route";
const get = (scope = "financial-accounts") => GET(new Request(`http://localhost/api/integrations/conta-azul/options?clientId=client1&scope=${scope}`));
beforeEach(() => { vi.resetAllMocks(); mocks.member.mockResolvedValue({ userId: "u1", organizationId: "org1" }); mocks.permission.mockResolvedValue({ canView: true }); mocks.client.mockResolvedValue({ id: "client1" }); });
describe("contas para rateio da fatura", () => {
  it("consulta somente contas do cliente, sem carregar categorias, centros e fornecedores", async () => {
    mocks.request.mockResolvedValue({ itens: [{ id: "x", nome: "Conta X", ativo: true }, { id_conta_financeira: "y", nome: "Conta Y" }, { id: "z", nome: "Inativa", ativo: false }] });
    expect((await (await get()).json()).financialAccounts.map((account: { value: string }) => account.value)).toEqual(["x", "y"]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("client1", "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true");
  });
  it("rejeita falta de autenticação, permissão e cliente antes de consultar a API", async () => {
    mocks.member.mockResolvedValueOnce(null); expect((await get()).status).toBe(401);
    mocks.permission.mockResolvedValueOnce({ canView: false }); expect((await get()).status).toBe(403);
    mocks.client.mockResolvedValueOnce(null); expect((await get()).status).toBe(404);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("preserva o escopo anterior de categorias", async () => {
    mocks.request.mockResolvedValue({ itens: [{ id: "cat", nome: "Sistemas", tipo: "DESPESA" }] });
    expect((await (await get("categories")).json()).categories[0].label).toBe("Sistemas");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1]).toContain("/v1/categorias?");
  });
});
