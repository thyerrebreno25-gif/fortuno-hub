import { describe, expect, it } from "vitest";
import { selectContractedRate } from "./contracted-rate-matcher";

type TestRate = {
  id: string;
  modality: string;
  installments: number | null;
  cardBrand: string | null;
};

const rate = (
  id: string,
  installments: number | null,
  cardBrand: string | null = null,
): TestRate => ({ id, modality: "CREDIT", installments, cardBrand });

describe("selectContractedRate", () => {
  it("mantém uma regra parcelada antiga aplicável a qualquer quantidade", () => {
    const selected = selectContractedRate(
      [rate("legacy", 2)],
      "CREDIT",
      10,
      "Visa",
    );

    expect(selected?.id).toBe("legacy");
  });

  it("seleciona a faixa pelo limite superior de parcelas", () => {
    const rates = [rate("up-to-6", 6), rate("from-7", 36)];

    expect(selectContractedRate(rates, "CREDIT", 6, "Visa")?.id).toBe("up-to-6");
    expect(selectContractedRate(rates, "CREDIT", 7, "Visa")?.id).toBe("from-7");
    expect(selectContractedRate(rates, "CREDIT", 12, "Visa")?.id).toBe("from-7");
  });

  it("prioriza a bandeira específica dentro da faixa selecionada", () => {
    const rates = [
      rate("general", 6),
      rate("visa", 6, "Visa"),
      rate("mastercard-next-range", 36, "Mastercard"),
    ];

    expect(selectContractedRate(rates, "CREDIT", 4, "Visa")?.id).toBe("visa");
    expect(selectContractedRate(rates, "CREDIT", 4, "Elo")?.id).toBe("general");
  });

  it("ignora faixas específicas de outras bandeiras", () => {
    const rates = [
      rate("general-up-to-6", 6),
      rate("visa-up-to-12", 12, "Visa"),
      rate("general-from-7", 36),
    ];

    expect(selectContractedRate(rates, "CREDIT", 7, "Visa")?.id).toBe("visa-up-to-12");
    expect(selectContractedRate(rates, "CREDIT", 7, "Mastercard")?.id).toBe("general-from-7");
  });

  it("mantém o crédito à vista separado do parcelado", () => {
    const rates = [rate("cash", 1), rate("installment", 6)];

    expect(selectContractedRate(rates, "CREDIT", 1, "Visa")?.id).toBe("cash");
    expect(selectContractedRate(rates, "CREDIT", 2, "Visa")?.id).toBe("installment");
  });
});
