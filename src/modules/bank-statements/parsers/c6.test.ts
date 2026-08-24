import { describe, expect, it } from "vitest";
import { parseC6 } from "./c6";

describe("leitor de extrato C6", () => {
  it("preserva as duas datas e fecha entradas, saídas e saldos", () => {
    const result = parseC6([
      "EMPRESA TESTE • 12.345.678/0001-90",
      "Agência: 1 • Conta: 123456789",
      "C6 BANK",
      "( 01/07/2026 - 31/07/2026 )",
      "Julho 2026 Entradas: R$ 150,00 • Saídas: R$ 20,00",
      "Data Data",
      "lançamento contábil Tipo Descrição Valor",
      "01/07 01/07 Entrada PIX Pix recebido de CLIENTE A R$ 100,00",
      "01/07 01/07 Saída PIX Pix enviado para FORNECEDOR A -R$ 20,00",
      "Saldo do dia 01/07/26 R$ 1.080,00",
      "02/07 03/07 Entradas RECEBIMENTO DE TED R$ 50,00",
      "Saldo do dia 03/07/26 R$ 1.130,00",
    ]);

    expect(result).toMatchObject({
      bank: "C6 Bank",
      accountHolder: "EMPRESA TESTE",
      branch: "1",
      account: "123456789",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      detectedOpeningBalance: 1_000,
      detectedClosingBalance: 1_130,
    });
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[2]).toMatchObject({
      date: "2026-07-02",
      accountingDate: "2026-07-03",
      type: "CREDIT",
      amount: 50,
      sourceType: "Entradas",
    });
    expect(result.transactions[2]?.balance).toBe(1_130);
  });

  it("impede exportação quando os totais declarados não fecham", () => {
    expect(() => parseC6([
      "EMPRESA TESTE • 12.345.678/0001-90",
      "Agência: 1 • Conta: 123456789",
      "C6 BANK",
      "( 01/07/2026 - 31/07/2026 )",
      "Julho 2026 Entradas: R$ 200,00 • Saídas: R$ 0,00",
      "Data Data",
      "01/07 01/07 Entrada PIX Pix recebido de CLIENTE A R$ 100,00",
      "Saldo do dia 01/07/26 R$ 1.100,00",
    ])).toThrow("leitura das entradas ficou incompleta");
  });

  it("impede exportação quando um saldo diário diverge", () => {
    expect(() => parseC6([
      "EMPRESA TESTE • 12.345.678/0001-90",
      "Agência: 1 • Conta: 123456789",
      "C6 BANK",
      "( 01/07/2026 - 31/07/2026 )",
      "Julho 2026 Entradas: R$ 100,00 • Saídas: R$ 20,00",
      "Data Data",
      "01/07 01/07 Entrada PIX Pix recebido de CLIENTE A R$ 100,00",
      "01/07 01/07 Saída PIX Pix enviado para FORNECEDOR A -R$ 20,00",
      "Saldo do dia 01/07/26 R$ 1.090,00",
      "02/07 02/07 Entrada PIX Pix recebido de CLIENTE B R$ 0,00",
      "Saldo do dia 02/07/26 R$ 1.080,00",
    ])).toThrow("saldo diário");
  });
});
