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

  it("aprende pelas primeiras palavras quando o restante da descrição varia", () => {
    const expected = rule({
      normalizedDescription: "OVO BRANCO CARTELA 30 UNIDADES",
    });
    const result = findPurchaseInvoiceRule(
      [expected],
      "11111111000111",
      {
        productCode: "NOVO-CODIGO",
        normalizedDescription: "OVO BRANCO CAIXA 12 UNIDADES",
      },
    );

    expect(result).toBe(expected);
  });

  it("usa somente a primeira palavra principal para reconhecer a família do item", () => {
    const expected = rule({
      normalizedDescription: "OVO BRANCO CARTELA 30 UNIDADES",
    });
    const result = findPurchaseInvoiceRule(
      [expected],
      "11111111000111",
      {
        productCode: "NOVO-CODIGO",
        normalizedDescription: "OVO VERMELHO GRANDE CAIXA 12",
      },
    );

    expect(result).toBe(expected);
  });

  it("ignora conectores ao comparar o início da descrição", () => {
    const expected = rule({
      normalizedDescription: "OLEO DE SOJA REFINADO 900 ML",
    });
    const result = findPurchaseInvoiceRule(
      [expected],
      "11111111000111",
      {
        productCode: "NOVO-CODIGO",
        normalizedDescription: "OLEO SOJA TIPO 1 GARRAFA",
      },
    );

    expect(result).toBe(expected);
  });

  it("usa uma descrição histórica curta como prefixo de outra mais completa", () => {
    const expected = rule({ normalizedDescription: "OVO" });
    const result = findPurchaseInvoiceRule(
      [expected],
      "33333333000133",
      {
        productCode: null,
        normalizedDescription: "OVO BRANCO GRANDE CARTELA 30",
      },
    );

    expect(result).toBe(expected);
  });

  it("não confunde itens que compartilham somente uma palavra genérica", () => {
    const result = findPurchaseInvoiceRule(
      [rule({ normalizedDescription: "SERVICO CONTABIL MENSAL" })],
      "11111111000111",
      {
        productCode: "NOVO-CODIGO",
        normalizedDescription: "SERVICO ELETRICO PREDIAL",
      },
    );

    expect(result).toBeUndefined();
  });

  it("mantém para revisão descrições semelhantes com categorias conflitantes", () => {
    const result = findPurchaseInvoiceRule(
      [
        rule({ normalizedDescription: "CAFE TORRADO PACOTE 500 G" }),
        rule({
          supplierDocument: "22222222000122",
          productCode: "CAFE-2",
          normalizedDescription: "CAFE TORRADO EXTRA FORTE 500 G",
          contaAzulCategoryId: "categoria-revenda",
          contaAzulCategoryName: "Mercadorias para revenda",
        }),
      ],
      "33333333000133",
      {
        productCode: null,
        normalizedDescription: "CAFE TORRADO TRADICIONAL 250 G",
      },
    );

    expect(result).toBeUndefined();
  });

  it("prioriza o início mais específico antes de avaliar prefixos mais amplos", () => {
    const expected = rule({
      normalizedDescription: "CAFE TORRADO EXTRA FORTE 500 G",
    });
    const result = findPurchaseInvoiceRule(
      [
        expected,
        rule({
          supplierDocument: "22222222000122",
          productCode: "CAFE-2",
          normalizedDescription: "CAFE TORRADO TRADICIONAL 500 G",
          contaAzulCategoryId: "categoria-revenda",
          contaAzulCategoryName: "Mercadorias para revenda",
        }),
      ],
      "33333333000133",
      {
        productCode: null,
        normalizedDescription: "CAFE TORRADO EXTRA FORTE PACOTE 250 G",
      },
    );

    expect(result).toBe(expected);
  });
});
