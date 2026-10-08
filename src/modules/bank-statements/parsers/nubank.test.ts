import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseNubankStatement } from "./nubank";

function line(
  y: number,
  parts: Array<{ x: number; text: string }>,
  page = 1,
): PdfTextLine {
  return { page, y, parts, text: parts.map((part) => part.text).join(" ") };
}

const header = [
  line(774, [{ x: 436, text: "CENTAURUS VILA LTDA" }]),
  line(762, [
    { x: 323, text: "CNPJ" },
    { x: 353, text: "41.640.474/0001-85" },
    { x: 442, text: "Agência" },
    { x: 484, text: "0001" },
    { x: 508, text: "Conta" },
  ]),
  line(750, [{ x: 481, text: "794873052-0" }]),
  line(700, [
    { x: 57, text: "01 DE MAIO DE 2026" },
    { x: 150, text: "a" },
    { x: 157, text: "08 DE OUTUBRO DE 2026" },
  ]),
  line(670, [{ x: 316, text: "Saldo inicial" }, { x: 495, text: "4.563,64" }]),
  line(650, [{ x: 316, text: "Rendimento líquido" }, { x: 512, text: "+6,49" }]),
  line(630, [{ x: 316, text: "Total de entradas" }, { x: 493, text: "+1.200,00" }]),
  line(610, [{ x: 316, text: "Total de saídas" }, { x: 494, text: "-2.849,80" }]),
  line(590, [{ x: 316, text: "Saldo final do período" }, { x: 498, text: "2.920,33" }]),
  line(560, [{ x: 57, text: "Movimentações" }]),
];

describe("leitor de extrato da conta Nubank", () => {
  it("usa os blocos de entrada e saída, une os detalhes e inclui o rendimento", () => {
    const result = parseNubankStatement([
      ...header,
      line(538, [
        { x: 58, text: "22 MAI 2026" },
        { x: 120, text: "Total de entradas" },
        { x: 497, text: "+ 650,00" },
      ]),
      line(518, [
        { x: 120, text: "Transferência recebida pelo Pix" },
        { x: 258, text: "CLIENTE UM - •••.678.826-••" },
        { x: 509, text: "650,00" },
      ]),
      line(498, [{ x: 258, text: "BANCO TESTE (0001) Agência: 1" }]),
      line(478, [{ x: 258, text: "Conta: 12345-6" }]),
      line(458, [{ x: 120, text: "Saldo do dia" }, { x: 499, text: "5.214,59" }]),
      line(666, [
        { x: 58, text: "25 MAI 2026" },
        { x: 120, text: "Total de entradas" },
        { x: 502, text: "+ 550,00" },
      ], 2),
      line(644, [
        { x: 120, text: "Transferência recebida pelo Pix" },
        { x: 262, text: "CLIENTE DOIS" },
        { x: 509, text: "550,00" },
      ], 2),
      line(590, [{ x: 120, text: "Total de saídas" }, { x: 500, text: "- 2.849,80" }], 2),
      line(570, [
        { x: 120, text: "Transferência enviada pelo Pix" },
        { x: 262, text: "FORNECEDOR UM" },
        { x: 506, text: "362,50" },
      ], 2),
      line(530, [
        { x: 120, text: "Transferência enviada pelo Pix" },
        { x: 262, text: "FORNECEDOR DOIS" },
        { x: 506, text: "2.487,30" },
      ], 2),
      line(496, [{ x: 120, text: "Saldo do dia" }, { x: 498, text: "2.919,36" }], 2),
      line(202, [{ x: 57, text: "disponíveis em nubank.com.br/contatos#ouvidoria" }], 2),
    ]);

    expect(result).toMatchObject({
      bank: "Nubank",
      layout: "Conta PJ",
      accountHolder: "CENTAURUS VILA LTDA",
      branch: "0001",
      account: "794873052-0",
      periodStart: "2026-05-01",
      periodEnd: "2026-10-08",
      detectedOpeningBalance: 4563.64,
      detectedClosingBalance: 2920.33,
    });
    expect(result.transactions).toHaveLength(5);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-05-22",
      type: "CREDIT",
      amount: 650,
      sourceType: "Pix recebido",
      description: "Transferência recebida pelo Pix CLIENTE UM - •••.678.826-•• BANCO TESTE (0001) Agência: 1 Conta: 12345-6",
      balance: 5214.59,
    });
    expect(result.transactions[2]).toMatchObject({
      type: "DEBIT",
      amount: 362.5,
      sourceType: "Pix enviado",
    });
    expect(result.transactions.at(-1)).toMatchObject({
      date: "2026-10-08",
      description: "Rendimento líquido",
      type: "CREDIT",
      amount: 6.49,
      balance: 2920.33,
    });
  });

  it("rejeita o arquivo quando os totais declarados não correspondem às movimentações", () => {
    expect(() => parseNubankStatement([
      ...header,
      line(538, [
        { x: 58, text: "22 MAI 2026" },
        { x: 120, text: "Total de entradas" },
        { x: 497, text: "+ 10,00" },
      ]),
      line(518, [
        { x: 120, text: "Transferência recebida pelo Pix" },
        { x: 258, text: "CLIENTE" },
        { x: 509, text: "10,00" },
      ]),
      line(202, [{ x: 57, text: "nubank.com.br/contatos#ouvidoria" }]),
    ])).toThrow("leitura das entradas");
  });
});
