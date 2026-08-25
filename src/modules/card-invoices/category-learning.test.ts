import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areSimilarInvoiceMerchants,
  findLearnedInvoiceCategory,
  getInvoiceCategoryRules,
  learnInvoiceCategory,
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
});
