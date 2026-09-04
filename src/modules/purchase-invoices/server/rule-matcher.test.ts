import { describe, expect, it } from "vitest";
import {
  findPurchaseInvoiceRule,
  type PurchaseInvoiceRuleCandidate,
} from "./rule-matcher";

function rule(
  overrides: Partial<PurchaseInvoiceRuleCandidate> = {},
): PurchaseInvoiceRuleCandidate {
  return {
    supplierDocument: "11111111000111",
    productCode: "OVO-1",
    normalizedDescription: "OVO",
    contaAzulCategoryId: "categoria-alimentos",
    contaAzulCategoryName: "Alimentos",
    contaAzulCostCenterId: "centro-cozinha",
    contaAzulCostCenterName: "Cozinha",
    ...overrides,
  };
}

describe("findPurchaseInvoiceRule", () => {
  it("prioriza a regra específica do fornecedor mesmo quando há conflito global", () => {
    const expected = rule();
    const result = findPurchaseInvoiceRule(
      [
        expected,
        rule({
          supplierDocument: "22222222000122",
          contaAzulCategoryId: "categoria-revenda",
          contaAzulCategoryName: "Mercadorias para revenda",
        }),
      ],
      "11111111000111",
      { productCode: "OVO-1", normalizedDescription: "OVO" },
    );

    expect(result).toBe(expected);
  });

  it("reaproveita a categoria entre fornecedores quando o histórico é unânime", () => {
    const result = findPurchaseInvoiceRule(
      [
        rule(),
        rule({ supplierDocument: "22222222000122", productCode: "ITEM-9" }),
      ],
      "33333333000133",
      { productCode: "OUTRO-CODIGO", normalizedDescription: "OVO" },
    );

    expect(result?.contaAzulCategoryId).toBe("categoria-alimentos");
    expect(result?.contaAzulCostCenterId).toBe("centro-cozinha");
  });

  it("não categoriza entre fornecedores quando o histórico possui conflito", () => {
    const result = findPurchaseInvoiceRule(
      [
        rule(),
        rule({
          supplierDocument: "22222222000122",
          contaAzulCategoryId: "categoria-revenda",
          contaAzulCategoryName: "Mercadorias para revenda",
        }),
      ],
      "33333333000133",
      { productCode: null, normalizedDescription: "OVO" },
    );

    expect(result).toBeUndefined();
  });

  it("reaproveita somente a categoria quando os centros de custo divergem", () => {
    const result = findPurchaseInvoiceRule(
      [
        rule(),
        rule({
          supplierDocument: "22222222000122",
          contaAzulCostCenterId: "centro-loja",
          contaAzulCostCenterName: "Loja",
        }),
      ],
      "33333333000133",
      { productCode: null, normalizedDescription: "OVO" },
    );

    expect(result?.contaAzulCategoryId).toBe("categoria-alimentos");
    expect(result?.contaAzulCostCenterId).toBeNull();
    expect(result?.contaAzulCostCenterName).toBeNull();
  });
});
