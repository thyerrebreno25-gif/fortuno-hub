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
  it("lê o layout Jasper com data e detalhes separados e sinais entre parênteses", () => {
    const result = parseBancoDoBrasilStatement([
      line(810, [{ x: 70, text: "Extrato de Conta Corrente" }]),
      line(788, [{ x: 71, text: "Cliente" }, { x: 110, text: "ABISMO ANHUMAS" }]),
      line(768, [
        { x: 220, text: "Agência: 1031-6" },
        { x: 304, text: "Conta: 8621-5" },
      ]),
      line(746, [{ x: 30, text: "Lançamentos" }]),
      line(732, [
        { x: 30, text: "Dia" },
        { x: 91, text: "Lote" },
        { x: 152, text: "Documento" },
        { x: 266, text: "Histórico" },
        { x: 547, text: "Valor" },
      ]),
      line(720, [{ x: 30, text: "31/07/2026" }]),
      line(714, [{ x: 266, text: "Saldo Anterior" }, { x: 539, text: "0,00 (+)" }]),
      line(698, [{ x: 266, text: "Pix - Recebido" }]),
      line(694, [{ x: 30, text: "03/08/2026" }]),
      line(688, [
        { x: 91, text: "14397" },
        { x: 152, text: "22317546424791" },
        { x: 266, text: "02/08 23:17 CLIENTE" },
        { x: 521, text: "4.895,00 (+)" },
      ]),
      line(668, [
        { x: 30, text: "03/08/2026" },
        { x: 266, text: "BB Rende Fácil" },
      ]),
      line(662, [{ x: 152, text: "9903" }, { x: 521, text: "4.895,00 (-)" }]),
      line(656, [{ x: 266, text: "Rende Facil" }]),
      line(648, [{ x: 30, text: "00/00/0000" }]),
      line(642, [
        { x: 91, text: "14024" },
        { x: 266, text: "Saldo do dia" },
        { x: 539, text: "0,00 (+)" },
      ]),
      line(810, [{ x: 70, text: "Extrato de Conta Corrente" }], 2),
      line(750, [{ x: 30, text: "Lançamentos" }], 2),
      line(282, [{ x: 30, text: "28/08/2026" }], 2),
      line(276, [
        { x: 91, text: "12024" },
        { x: 152, text: "112400100004300" },
        { x: 266, text: "BMG Granito crédito" },
        { x: 521, text: "5.728,34 (+)" },
      ], 2),
      line(262, [
        { x: 30, text: "28/08/2026" },
        { x: 266, text: "S A L D O" },
        { x: 521, text: "5.728,34 (+)" },
      ], 2),
      line(236, [{ x: 30, text: "Informações Adicionais" }], 2),
    ]);

    expect(result).toMatchObject({
      bank: "Banco do Brasil",
      layout: "bb-jasper-conta-corrente",
      accountHolder: "ABISMO ANHUMAS",
      branch: "1031-6",
      account: "8621-5",
      periodStart: "2026-08-03",
      periodEnd: "2026-08-28",
      detectedOpeningBalance: 0,
      detectedClosingBalance: 5728.34,
    });
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-08-03",
      description: "Pix - Recebido 02/08 23:17 CLIENTE",
      document: "22317546424791",
      type: "CREDIT",
      amount: 4895,
      balance: 4895,
    });
    expect(result.transactions[1]).toMatchObject({
      description: "BB Rende Fácil",
      document: "9903",
      type: "DEBIT",
      amount: 4895,
      balance: 0,
    });
  });

  it("usa o sinal da última coluna e reconhece o saldo isolado antes da página de totais", () => {
    const result = parseBancoDoBrasilStatement([
      line(810, [{ x: 70, text: "Extrato de Conta Corrente" }]),
      line(788, [{ x: 71, text: "Cliente" }, { x: 110, text: "DOCE MAISON LTDA" }]),
      line(768, [
        { x: 220, text: "Agência: 3476-2" },
        { x: 304, text: "Conta: 129012-6" },
      ]),
      line(746, [{ x: 30, text: "Lançamentos" }]),
      line(720, [{ x: 30, text: "30/06/2026" }]),
      line(714, [{ x: 266, text: "Saldo Anterior" }, { x: 539, text: "0,00 (+)" }]),
      line(698, [{ x: 266, text: "Pix - Recebido" }]),
      line(694, [{ x: 30, text: "01/07/2026" }]),
      line(688, [
        { x: 91, text: "14397" },
        { x: 152, text: "1001" },
        { x: 266, text: "01/07 09:00 CLIENTE" },
        { x: 521, text: "100,00 (+)" },
      ]),
      line(674, [{ x: 266, text: "Transferência enviada" }]),
      line(668, [{ x: 30, text: "01/07/2026" }]),
      line(662, [
        { x: 91, text: "99021" },
        { x: 152, text: "1002" },
        { x: 266, text: "DESTINATÁRIO" },
        { x: 521, text: "40,00 (-)" },
      ]),
      line(648, [{ x: 30, text: "01/07/2026" }, { x: 266, text: "BB Rende Fácil" }]),
      line(642, [{ x: 152, text: "9903" }, { x: 521, text: "60,00 (-)" }]),
      line(636, [{ x: 266, text: "Rende Facil" }]),
      line(628, [{ x: 30, text: "00/00/0000" }]),
      line(622, [{ x: 91, text: "14134" }, { x: 266, text: "Saldo do dia" }, { x: 539, text: "0,00 (+)" }]),
      line(618, [{ x: 304, text: "Conta: 129012-6" }]),
      line(616, [{ x: 30, text: "Lançamentos" }]),
      line(610, [{ x: 30, text: "02/07/2026" }, { x: 266, text: "Recebimento Fornecedor" }]),
      line(604, [
        { x: 91, text: "14134" },
        { x: 152, text: "1003" },
        { x: 521, text: "200,00 (+)" },
      ]),
      line(598, [{ x: 266, text: "FORNECEDOR S.A." }]),
      line(590, [{ x: 30, text: "02/07/2026" }, { x: 266, text: "Transferência Agendada" }]),
      line(584, [
        { x: 91, text: "13105" },
        { x: 152, text: "1004" },
        { x: 521, text: "250,00 (-)" },
      ]),
      line(578, [{ x: 266, text: "DESTINATÁRIO" }]),
      line(570, [{ x: 30, text: "02/07/2026" }, { x: 266, text: "BB Rende Fácil" }]),
      line(564, [{ x: 152, text: "9903" }, { x: 521, text: "50,00 (+)" }]),
      line(556, [{ x: 30, text: "31/07/2026" }]),
      line(550, [{ x: 266, text: "S A L D O" }, { x: 539, text: "0,00 (+)" }]),
      line(810, [{ x: 70, text: "Extrato de Conta Corrente" }], 2),
      line(752, [
        { x: 30, text: "Total Aplicações Financeiras" },
        { x: 470, text: "0,00" },
      ], 2),
    ]);

    expect(result.detectedClosingBalance).toBe(0);
    expect(result.transactions).toHaveLength(6);
    expect(result.transactions.map((transaction) => transaction.type)).toEqual([
      "CREDIT",
      "DEBIT",
      "DEBIT",
      "CREDIT",
      "DEBIT",
      "CREDIT",
    ]);
    expect(result.transactions[1]).toMatchObject({
      description: "Transferência enviada DESTINATÁRIO",
      amount: 40,
    });
    expect(result.transactions[3]?.description).not.toContain("Saldo do dia");
    expect(result.transactions[3]?.description).not.toContain("Conta:");
    expect(result.transactions.at(-1)).toMatchObject({
      description: "BB Rende Fácil",
      amount: 50,
      balance: 0,
    });
  });

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
