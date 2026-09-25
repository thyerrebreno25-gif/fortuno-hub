import { describe, expect, it } from "vitest";
import {
  invoiceAmountToContaAzulValue,
  invoiceItemToContaAzulRow,
} from "./conta-azul-exporter";

describe("sinal da fatura no padrão Conta Azul", () => {
  it("exporta despesa negativa e crédito positivo", () => {
    expect(invoiceAmountToContaAzulValue(100)).toBe(-100);
    expect(invoiceAmountToContaAzulValue(-31.81)).toBe(31.81);
  });

  it("preenche o centro de custo na coluna do Conta Azul", () => {
    const row = invoiceItemToContaAzulRow(
      {
        date: "2026-08-12",
        description: "ADOBE",
        amount: 100,
        category: "SISTEMAS",
        costCenter: "ADMINISTRATIVO",
      },
      {
        bankName: "Cora",
        competenceDate: "2026-08-01",
        dueDate: "2026-08-17",
        paymentDate: "2026-08-17",
      },
    );

    expect(row["Centro de Custo"]).toBe("ADMINISTRATIVO");
    expect(row.Categoria).toBe("SISTEMAS");
    expect(row["Cliente/Fornecedor"]).toBe("Cora");
  });
});
