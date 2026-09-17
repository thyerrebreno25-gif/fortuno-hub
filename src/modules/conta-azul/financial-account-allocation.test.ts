import { describe, expect, it } from "vitest";
import { allocationClientId, changeAllocationDestination, fillPendingAllocationAccounts, exportLineDestinationClient, exportLineFinancialAccount, invalidAccountAllocationLines, invalidDestinationAllocationLines, summarizeAccountAllocation, summarizeDestinationAllocation } from "./financial-account-allocation";
import { buildFinancialEventPayload, contaAzulOptions } from "./financial-export";
import { allocationCategoryKey, allocationCostCenterKey, applyAllocationClassifications } from "./financial-account-allocation";

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

describe("cadastro de destino do rateio", () => {
  const catalogs = { a: { clientName: "Unidade A", financialAccounts: [{ value: "same-id", label: "Cartão A" }] },
    b: { clientName: "Unidade B", financialAccounts: [{ value: "same-id", label: "Cartão B" }, { value: "b-only", label: "Cartão extra B" }] } };
  it("valida a conta dentro de cada cadastro, não em uma lista unificada", () => {
    const lines = [{ destinationClientId: "a", financialAccountId: "b-only", amount: 10, direction: "PAYABLE" as const },
      { destinationClientId: "b", financialAccountId: "b-only", amount: 10, direction: "PAYABLE" as const },
      { destinationClientId: "sem-acesso", financialAccountId: "same-id", amount: 10, direction: "PAYABLE" as const }];
    expect(invalidDestinationAllocationLines(lines, catalogs, "a")).toEqual([lines[0], lines[2]]);
  });
  it("trocar o cadastro limpa o destino financeiro sem mudar valor ou classificações", () => {
    const original = { amount: 20, category: "Sistemas", costCenter: "Matriz", financialAccountId: "a-account", financialAccountName: "Cartão A", destinationClientId: "a" };
    expect(changeAllocationDestination(original, { value: "b", label: "Unidade B" })).toEqual({ ...original, destinationClientId: "b", destinationClientName: "Unidade B", financialAccountId: null, financialAccountName: null });
    expect(original.financialAccountId).toBe("a-account");
  });
  it("preenchimento em lote não troca cadastro nem sobrescreve contas já escolhidas", () => {
    const lines = [{ destinationClientId: "a", financialAccountId: null }, { destinationClientId: "b", financialAccountId: null },
      { destinationClientId: "b", financialAccountId: "escolhida" }, { financialAccountId: null }];
    expect(fillPendingAllocationAccounts(lines, "a", "b", { value: "b-only", label: "Cartão B" })).toEqual([lines[0],
      { ...lines[1], financialAccountId: "b-only", financialAccountName: "Cartão B" }, lines[2], lines[3]]);
  });
  it("não mistura unidades no resumo, mesmo com IDs ou nomes de conta iguais", () => {
    const result = summarizeDestinationAllocation([{ destinationClientId: "a", financialAccountId: "same-id", direction: "PAYABLE", amount: 10 },
      { destinationClientId: "b", financialAccountId: "same-id", direction: "RECEIVABLE", amount: 5 },
      { financialAccountId: "same-id", direction: "PAYABLE", amount: 2 }], catalogs, "a");
    expect(result).toEqual([{ clientId: "a", clientName: "Unidade A", accountId: "same-id", accountName: "Cartão A", count: 2, payableAmount: 12, receivableAmount: 0 },
      { clientId: "b", clientName: "Unidade B", accountId: "same-id", accountName: "Cartão B", count: 1, payableAmount: 0, receivableAmount: 5 }]);
  });
  it("retomada usa o cadastro persistido, ignorando metadados livres do arquivo", () => {
    expect(exportLineDestinationClient({ destinationClientId: "b", source: { destinationClientId: "outra" } }, "a")).toBe("b");
    expect(exportLineDestinationClient({ source: { destinationClientId: "b" } }, "a")).toBe("a");
    expect(exportLineDestinationClient({}, "a")).toBe("a");
    expect(allocationClientId({}, "a")).toBe("a");
  });
});

describe("classificações equivalentes por destino", () => {
  const catalogs = {
    a: { clientName: "A", financialAccounts: [], categories: [{ value: "cat-a", label: "Sistema A", type: "DESPESA" as const }], costCenters: [{ value: "cc-a", label: "Matriz A" }] },
    b: { clientName: "B", financialAccounts: [], categories: [{ value: "cat-b", label: "Sistema B", type: "DESPESA" as const }, { value: "credit-b", label: "Estorno B", type: "RECEITA" as const }], costCenters: [{ value: "cc-b", label: "Filial B" }] },
  };
  const lines = ["a", "b"].map((destinationClientId) => ({ destinationClientId, categoryName: "Sistemas", costCenterName: "Operação", direction: "PAYABLE" as const, amount: 20, financialAccountId: "account" }));
  it("uma categoria/centro iguais na origem podem ter equivalentes diferentes em cada CNPJ", () => {
    const result = applyAllocationClassifications(lines, catalogs, "a", true,
      { [allocationCategoryKey("a", "PAYABLE", "Sistemas")]: "cat-a", [allocationCategoryKey("b", "PAYABLE", "Sistemas")]: "cat-b" },
      { [allocationCostCenterKey("a", "Operação")]: "cc-a", [allocationCostCenterKey("b", "Operação")]: "cc-b" });
    expect(result.map((line) => [line.categoryName, line.costCenterName])).toEqual([["Sistema A", "Matriz A"], ["Sistema B", "Filial B"]]);
    expect(result.map((line) => [line.amount, line.financialAccountId, line.destinationClientId])).toEqual([[20, "account", "a"], [20, "account", "b"]]);
    expect(lines[0].categoryName).toBe("Sistemas");
  });
  it("não aplica identificadores de outra unidade ou de natureza incompatível", () => {
    expect(applyAllocationClassifications(lines, catalogs, "a", true,
      { [allocationCategoryKey("a", "PAYABLE", "Sistemas")]: "cat-b", [allocationCategoryKey("b", "PAYABLE", "Sistemas")]: "credit-b" },
      { [allocationCostCenterKey("a", "Operação")]: "cc-b" })).toEqual(lines);
  });
  it("créditos têm sua própria classificação e destinos antigos usam o cliente de origem", () => {
    const credit = { direction: "RECEIVABLE" as const, destinationClientId: "b", categoryName: "Sistemas" };
    expect(applyAllocationClassifications([credit], catalogs, "a", true, { [allocationCategoryKey("b", "RECEIVABLE", "Sistemas")]: "credit-b" }, {})[0].categoryName).toBe("Estorno B");
    expect(applyAllocationClassifications([{ categoryName: "Sistemas", direction: "PAYABLE" as const }], catalogs, "a", false,
      { [allocationCategoryKey("a", "PAYABLE", "Sistemas")]: "cat-a" }, {})[0].categoryName).toBe("Sistema A");
  });
});
