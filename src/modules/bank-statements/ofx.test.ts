import { describe, expect, it } from "vitest";
import { generateOfx } from "./ofx";

describe("gerador OFX de extratos", () => {
  it("usa a data contábil e mantém o sinal correto", () => {
    const ofx = generateOfx({
      bankId: "336",
      branch: "1",
      account: "123456789",
      initialBalance: 1_000,
      finalBalance: 1_080,
      transactions: [
        {
          id: 1,
          selected: true,
          date: "2026-07-04",
          accountingDate: "2026-07-06",
          description: "Pix recebido de CLIENTE A",
          document: "",
          sourceType: "Entrada PIX",
          type: "CREDIT",
          amount: 100,
          balance: null,
          status: "OK",
        },
        {
          id: 2,
          selected: true,
          date: "2026-07-04",
          accountingDate: "2026-07-06",
          description: "Pix enviado para FORNECEDOR A",
          document: "",
          sourceType: "Saída PIX",
          type: "DEBIT",
          amount: 20,
          balance: 1_080,
          status: "OK",
        },
      ],
    });

    expect(ofx).toContain("<BANKID>336");
    expect(ofx.match(/<DTPOSTED>20260706/g)).toHaveLength(2);
    expect(ofx).toContain("<TRNAMT>100.00");
    expect(ofx).toContain("<TRNAMT>-20.00");
    expect(ofx).toContain("<BALAMT>1080.00");
  });
});
