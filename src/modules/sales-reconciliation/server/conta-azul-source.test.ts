import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  contaAzulRequest: vi.fn(),
}));

vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({
  contaAzulRequest: mocks.contaAzulRequest,
}));

import { fetchContaAzulReceivables } from "./conta-azul-source";

describe("fetchContaAzulReceivables", () => {
  beforeEach(() => {
    mocks.contaAzulRequest.mockReset();
  });

  it("busca lançamentos pela competência mesmo quando vencimento e recebimento estão no mês seguinte", async () => {
    mocks.contaAzulRequest.mockImplementation(async (_clientId: string, path: string) => {
      if (path.includes("data_competencia_de=2026-08-01")) {
        return {
          itens: [{
            id: "receivable-by-competence",
            descricao: "Venda no cartão",
            total: 150,
            data_competencia: "2026-08-20",
            data_vencimento: "2026-09-10",
            data_pagamento: "2026-09-10",
          }],
        };
      }
      return { itens: [] };
    });

    const result = await fetchContaAzulReceivables("client-1", "2026-08-01", "2026-08-31");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "receivable-by-competence",
      competenceDate: "2026-08-20",
      paymentDate: "2026-09-10",
    });
    expect(mocks.contaAzulRequest).toHaveBeenCalledTimes(3);
    expect(mocks.contaAzulRequest.mock.calls.every(([, path]) => (
      String(path).includes("data_vencimento_de=")
      && String(path).includes("data_vencimento_ate=")
    ))).toBe(true);
    expect(mocks.contaAzulRequest.mock.calls.some(([, path]) => (
      String(path).includes("data_competencia_de=2026-08-01")
      && String(path).includes("data_competencia_ate=2026-08-31")
      && String(path).includes("data_vencimento_de=2016-01-01")
      && String(path).includes("data_vencimento_ate=2036-12-31")
    ))).toBe(true);
  });

  it("não ignora falha na consulta obrigatória por competência", async () => {
    mocks.contaAzulRequest
      .mockResolvedValueOnce({ itens: [] })
      .mockRejectedValueOnce(new Error("Falha ao consultar competência"));

    await expect(fetchContaAzulReceivables("client-1", "2026-08-01", "2026-08-31"))
      .rejects.toThrow("Falha ao consultar competência");
  });
});
