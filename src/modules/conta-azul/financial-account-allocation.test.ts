import { describe, expect, it } from "vitest";
import { exportLineFinancialAccount, invalidAccountAllocationLines, summarizeAccountAllocation } from "./financial-account-allocation";
import { buildFinancialEventPayload, contaAzulOptions } from "./financial-export";

const accounts = [{ value: "x", label: "Conta X" }, { value: "y", label: "Conta Y" }];
describe("rateio da fatura entre contas", () => {
  it("identifica conta ausente e conta que não está no cliente sem escolher um destino silenciosamente", () => {
    const lines = [{ direction: "PAYABLE" as const, amount: 10, financialAccountId: "x" },
      { direction: "PAYABLE" as const, amount: 20, financialAccountId: null },
      { direction: "PAYABLE" as const, amount: 30, financialAccountId: "outra-empresa" }];
    expect(invalidAccountAllocationLines(lines, accounts)).toEqual(lines.slice(1));
  });
  it("resume contas preservando despesas e créditos separadamente, sem somar dois vezes", () => {
    expect(summarizeAccountAllocation([
      { financialAccountId: "x", direction: "PAYABLE", amount: 20.15 },
      { financialAccountId: "y", direction: "PAYABLE", amount: 30 },
      { financialAccountId: "x", direction: "RECEIVABLE", amount: -5 },
      { financialAccountId: "x", direction: "PAYABLE", amount: 0.1 },
    ], accounts)).toEqual([
      { accountId: "x", accountName: "Conta X", count: 3, payableAmount: 20.25, receivableAmount: 5 },
      { accountId: "y", accountName: "Conta Y", count: 1, payableAmount: 30, receivableAmount: 0 },
    ]);
  });
  it("retomada usa a conta persistida da linha, nunca a seleção nova de outra linha", () => {
    expect(exportLineFinancialAccount({ financialAccountId: "y", source: { financialAccountId: "outra" } }, "x")).toBe("y");
  });
  it.each([null, {}, [], { source: { financialAccountId: "y" } }, { financialAccountId: "" }])("envios anteriores sem rateio usam a conta do lote: %s", (metadata) => {
    expect(exportLineFinancialAccount(metadata, "x")).toBe("x");
  });
  it("conta do evento e da parcela são iguais ao destino da linha, mantendo categoria/centro/valor", () => {
    const payload = buildFinancialEventPayload({ direction: "PAYABLE", competenceDate: "2026-09-01", dueDate: "2026-09-10",
      description: "Compra 2", observation: "Teste", amount: 30, contactId: "contact", categoryId: "cat", costCenterId: "center",
      financialAccountId: exportLineFinancialAccount({ financialAccountId: "y" }, "x") });
    expect(payload.conta_financeira).toBe("y"); expect(payload.condicao_pagamento.parcelas[0].conta_financeira).toBe("y");
    expect(payload.valor).toBe(30); expect(payload.rateio[0]).toMatchObject({ id_categoria: "cat", valor: 30, rateio_centro_custo: [{ id_centro_custo: "center", valor: 30 }] });
  });
  it("também identifica conta devolvida pelo alias id_conta_financeira", () => {
    expect(contaAzulOptions([{ id_conta_financeira: "x", nome: "Conta X" }])).toEqual([{ value: "x", label: "Conta X" }]);
  });
});
