import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseBancoDoBrasilStatement } from "./banco-do-brasil";

function line(y: number, parts: Array<{ x: number; text: string }>, page = 1): PdfTextLine {
  return { page, y, parts, text: parts.map((part) => part.text).join(" ") };
}

const header = [
  line(768, [{ x: 148, text: "Consultas - Extrato de conta corrente" }]),
  line(710, [{ x: 55, text: "Agência" }, { x: 147, text: "4594-2" }]),
  line(698, [{ x: 55, text: "Conta corrente" }, { x: 147, text: "20296-7MADENNA LTDA" }]),
  line(640, [
    { x: 59, text: "Dt. balancete" },
    { x: 118, text: "Dt. movimento Ag. origem Lote Histórico" },
    { x: 408, text: "Documento" },
    { x: 467, text: "Valor R$" },
    { x: 525, text: "Saldo" },
  ]),
];

describe("leitor de extrato do Banco do Brasil", () => {
  it("lê as movimentações, continua descrições entre páginas e fecha o saldo", () => {
    const result = parseBancoDoBrasilStatement([
      ...header,
      line(628, [
        { x: 64, text: "30/06/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "00000 000 Saldo Anterior" }, { x: 523, text: "0,00 C" },
      ]),
      line(616, [
        { x: 64, text: "01/07/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "14397 821 Pix - Recebido" },
        { x: 380, text: "11.535.341.990.961" }, { x: 460, text: "6.200,00 C" },
      ]),
      line(606, [{ x: 248, text: "01/07 15:35 31324778000180 GABRIELLA 0" }]),
      line(594, [
        { x: 64, text: "01/07/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "14020 624 Cobrança com Registro" },
        { x: 375, text: "111.821.000.012.425" }, { x: 460, text: "2.534,89 C" },
      ]),
      line(582, [
        { x: 64, text: "01/07/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "13128 500 FCO Amortização" },
        { x: 375, text: "123.133.036.000.200" }, { x: 460, text: "5.641,51 D" },
      ]),
      line(570, [
        { x: 64, text: "01/07/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "13158 328 Pagto cartão crédito" },
        { x: 407, text: "139.301.133" }, { x: 467, text: "518,00 D" }, { x: 507, text: "2.575,38 C" },
      ]),
      line(796, [{ x: 248, text: "EMPRESARIAL ELO" }], 2),
      line(728, [
        { x: 64, text: "01/07/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "00000 999 S A L D O" }, { x: 507, text: "2.575,38 C" },
      ], 2),
    ]);

    expect(result).toMatchObject({
      bank: "Banco do Brasil",
      accountHolder: "MADENNA LTDA",
      branch: "4594-2",
      account: "20296-7",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-01",
      detectedOpeningBalance: 0,
      detectedClosingBalance: 2575.38,
    });
    expect(result.transactions).toHaveLength(4);
    expect(result.transactions[0]).toMatchObject({
      description: "Pix - Recebido 01/07 15:35 31324778000180 GABRIELLA 0",
      document: "11.535.341.990.961",
      type: "CREDIT",
      amount: 6200,
      balance: 6200,
    });
    expect(result.transactions[3]).toMatchObject({
      description: "Pagto cartão crédito EMPRESARIAL ELO",
      type: "DEBIT",
      amount: 518,
      balance: 2575.38,
    });
  });

  it("bloqueia o arquivo quando alguma movimentação não fecha com o saldo final", () => {
    expect(() => parseBancoDoBrasilStatement([
      ...header,
      line(628, [
        { x: 64, text: "30/06/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "00000 000 Saldo Anterior" }, { x: 523, text: "0,00 C" },
      ]),
      line(616, [
        { x: 64, text: "01/07/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "14397 821 Pix - Recebido" },
        { x: 380, text: "11.535.341.990.961" }, { x: 460, text: "100,00 C" },
      ]),
      line(604, [
        { x: 64, text: "01/07/2026" }, { x: 191, text: "0000" },
        { x: 223, text: "00000 999 S A L D O" }, { x: 507, text: "90,00 C" },
      ]),
    ])).toThrow("ficou incompleta");
  });
});
