import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areSimilarInvoiceMerchants,
  findLearnedInvoiceCategory,
  getInvoiceCategoryRules,
  invoiceMerchantSimilarity,
  learnInvoiceCategory,
  mergeInvoiceCategoryRules,
} from "./category-learning";

function useMemoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aprendizado de categorias da fatura", () => {
  it("reconhece o mesmo lançamento quando apenas o identificador numérico muda", () => {
    expect(
      areSimilarInvoiceMerchants(
        "AMAZON PRIME PEDIDO 123456",
        "AMAZON PRIME PEDIDO 987654",
      ),
    ).toBe(true);
    expect(areSimilarInvoiceMerchants("ADOBE704", "ADOBE981")).toBe(true);
  });

  it("continua reconhecendo variações que só possuem ruído do extrato", () => {
    expect(areSimilarInvoiceMerchants("DL*UBER RIDES BR", "UBER RIDES")).toBe(true);
    expect(areSimilarInvoiceMerchants("NOTION LABS INC.", "NOTION LABS")).toBe(true);
  });

  it("mantém regras separadas e retorna a categoria exata de cada descrição", () => {
    useMemoryStorage();

    learnInvoiceCategory({
      clientId: "cliente-1",
      description: "AMAZON PRIME BR",
      category: "SISTEMAS",
    });
    expect(findLearnedInvoiceCategory("cliente-1", "AMAZON PRIME VIDEOS")?.category).toBe("SISTEMAS");

    learnInvoiceCategory({
      clientId: "cliente-1",
      description: "AMAZON PRIME VIDEOS",
      category: "MARKETING",
    });

    expect(getInvoiceCategoryRules("cliente-1")).toHaveLength(2);
    expect(findLearnedInvoiceCategory("cliente-1", "AMAZON PRIME BR")?.category).toBe("SISTEMAS");
    expect(findLearnedInvoiceCategory("cliente-1", "AMAZON PRIME VIDEOS")?.category).toBe("MARKETING");
  });

  it("aprende o centro de custo junto com a categoria para o mesmo cliente", () => {
    useMemoryStorage();

    learnInvoiceCategory({
      clientId: "cliente-1",
      description: "ADOBE 704",
      category: "SISTEMAS",
      costCenter: "ADMINISTRATIVO",
    });

    const learned = findLearnedInvoiceCategory("cliente-1", "ADOBE 981");
    expect(learned?.category).toBe("SISTEMAS");
    expect(learned?.costCenter).toBe("ADMINISTRATIVO");
  });

  it("sincroniza regras compartilhadas salvas no banco", () => {
    useMemoryStorage();

    mergeInvoiceCategoryRules("cliente-1", [
      {
        normalizedDescription: "MICROSOFT 365",
        category: "SISTEMAS",
        costCenter: "TECNOLOGIA",
        updatedAt: "2026-08-25T12:00:00.000Z",
      },
    ]);

    expect(getInvoiceCategoryRules("cliente-1")).toHaveLength(1);
    expect(invoiceMerchantSimilarity("MICROSOFT 365", "Microsoft*Microsoft 365 P"))
      .toBe(1);
    expect(findLearnedInvoiceCategory("cliente-1", "Microsoft*Microsoft 365 P"))
      .toMatchObject({ category: "SISTEMAS", costCenter: "TECNOLOGIA" });
  });
});
