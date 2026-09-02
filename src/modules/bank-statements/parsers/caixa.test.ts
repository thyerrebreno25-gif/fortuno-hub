import { describe, expect, it } from "vitest";
import { parseCaixaStatement } from "./caixa";

const REAL_LAYOUT_LINES = [
  "CAIXA #PESSOAL",
  "Extrato por período",
  "Cliente Y TREINAMENTO E APOIO AD LTDA",
  "Conta 6194 / 1292.000577619979-0",
  "Período dos lançamentos 01/07/2026 até 31/07/2026",
  "SALDO ANTERIOR R$ 992,05 C",
  "27/07/2026 - 00:00:00 000000 SALDO DIA 0,00 C 1.197,74 C",
  "27/07/2026 - O5 :31:15 000000 TARIFA MANUTENCAO CONTA A 73,00 D 1.197,74 C",
  "17/07/2026 - 00:00:00 000000 SALDO DIA 0,00 C 1.270,74 C",
  "17/07/2026 - 02 27:17 000000 DEBITO PRESTA SIEMP 5.721,11 D 1.270,74 C",
  "14/07/2026 - 00:00:00 000000 SALDO DIA 0,00 C 6.991,85 C",
  "14/07/2026 - 17:56:24 141756 PIX RECEBIDO Y Consultoria **406.626/0*** 6.000,00 C 6.991,85 C",
  "06/07/2026 - 00:00:00 000000 SALDO DIA 0,00 C 991,85 C",
  "07/07/2026 - 02:06:36 000000 COBRANCA DE JUROS 0,17 D 991,85 C",
  "01/07/2026 - 00:00:00 000000 SALDO DIA 0,00 C 992,02 C",
  "02/07/2026 - 02:16:49 000000 DEBITO DE IOF 0,03 D 992,02 C",
];

describe("leitor de extrato da Caixa", () => {
  it("ignora saldos diários, preserva entradas e saídas e fecha o extrato", () => {
    const result = parseCaixaStatement(REAL_LAYOUT_LINES);

    expect(result).toMatchObject({
      bank: "Caixa",
      accountHolder: "Y TREINAMENTO E APOIO AD LTDA",
      branch: "6194",
      account: "1292.000577619979-0",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      detectedOpeningBalance: 992.05,
      detectedClosingBalance: 1197.74,
    });
    expect(result.transactions).toHaveLength(5);
    expect(result.transactions.map((item) => item.amount)).toEqual([
      0.03,
      0.17,
      6000,
      5721.11,
      73,
    ]);
    expect(result.transactions[3]).toMatchObject({
      date: "2026-07-17",
      type: "DEBIT",
      amount: 5721.11,
    });
    expect(result.transactions.some((item) => /SALDO DIA/i.test(item.description))).toBe(false);
  });

  it("bloqueia a conversão se alguma movimentação necessária não for lida", () => {
    const incomplete = REAL_LAYOUT_LINES.filter((line) => !line.includes("PIX RECEBIDO"));
    expect(() => parseCaixaStatement(incomplete)).toThrow("leitura do extrato da Caixa ficou incompleta");
  });

  it('lê o layout "Extrato da conta" e infere o período pela emissão e movimentações', () => {
    const result = parseCaixaStatement([
      "CAIXA #PESSOAL",
      "Extrato da conta",
      "Cliente GUIMARAES SERVICOS LTDA",
      "Conta 1502 / 1292.000568008508-5",
      "Data 27/08/2026 - 11:02",
      "SALDO ANTERIOR R$ 1,41 C",
      "25/08/2026 - 00:00:00 000000 SALDO DIA 0,00 C 1.691,41 D",
      "25/08/2026 - 02:32:18 000000 DEB PARC EMPREST PESSOAL 1.625,22D 1.691,41 D",
      "20/08/2026 - 00:00:00 000000 SALDO DIA 0,00 C 66,19 D",
      "20/08/2026 - 05:25:30 202607 PLANO MAIS VALOR 2 67,60 D 66,19 D",
    ]);

    expect(result).toMatchObject({
      bank: "Caixa",
      accountHolder: "GUIMARAES SERVICOS LTDA",
      branch: "1502",
      account: "1292.000568008508-5",
      periodStart: "2026-08-20",
      periodEnd: "2026-08-27",
      detectedOpeningBalance: 1.41,
      detectedClosingBalance: -1691.41,
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map((item) => item.amount)).toEqual([67.6, 1625.22]);
    expect(result.transactions.every((item) => item.type === "DEBIT")).toBe(true);
  });
});
