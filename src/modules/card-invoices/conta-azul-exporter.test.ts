import { describe, expect, it } from "vitest";
import { invoiceAmountToContaAzulValue } from "./conta-azul-exporter";

describe("sinal da fatura no padrão Conta Azul", () => {
  it("exporta despesa negativa e crédito positivo", () => {
    expect(invoiceAmountToContaAzulValue(100)).toBe(-100);
    expect(invoiceAmountToContaAzulValue(-31.81)).toBe(31.81);
  });
});
