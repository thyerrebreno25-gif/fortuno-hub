import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseXpStatement } from "./xp";

function line(y: number, parts: Array<{ x: number; text: string }>, page = 1): PdfTextLine {
  return { page, y, parts, text: parts.map((part) => part.text).join(" ") };
}

describe("leitor automático de extratos XP", () => {
  it("identifica o layout Conta Digital e reordena as operações pelo horário", () => {
    const result = parseXpStatement([
      line(808, [{ x: 250, text: "Conta Digital XP | Extrato" }]),
      line(742, [
        { x: 25, text: "JVVGP CONSULTORIA MEDICA LTDA" },
        { x: 349, text: "Banco XP S.A | Agência: 0001 | Conta: 17280445" },
      ]),
      line(726, [{ x: 421, text: "De: 13/03/2026 Até: 09/09/2026" }]),
      line(712, [{ x: 25, text: "Saldo disponível no final do período filtrado: R$ 0,00" }]),
      line(672, [
        { x: 35, text: "Data" }, { x: 131, text: "Descrição" },
        { x: 420, text: "Valor" }, { x: 516, text: "Saldo" },
      ]),
      line(652, [
        { x: 35, text: "22/06/26 às 15:58:15" },
        { x: 131, text: "Pix enviado para Jvvgp Consultoria Em Educao" },
        { x: 420, text: "-R$ 105.914,57" }, { x: 516, text: "R$ 0,00" },
      ]),
      line(630, [
        { x: 35, text: "22/06/26 às 15:56:13" },
        { x: 131, text: "TED recebida de JVVGP CONSULTORIA MEDICA LTDA" },
        { x: 420, text: "R$ 105.914,57" }, { x: 516, text: "R$ 105.914,57" },
      ]),
    ]);

    expect(result).toMatchObject({
      bank: "XP",
      layout: "Conta Digital",
      accountHolder: "JVVGP CONSULTORIA MEDICA LTDA",
      branch: "0001",
      account: "17280445",
      detectedOpeningBalance: 0,
      detectedClosingBalance: 0,
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ type: "CREDIT", amount: 105914.57, balance: 105914.57 });
    expect(result.transactions[1]).toMatchObject({ type: "DEBIT", amount: 105914.57, balance: 0 });
  });

  it("identifica o layout Investimentos e reúne descrições quebradas", () => {
    const result = parseXpStatement([
      line(808, [{ x: 141, text: "XP INVESTIMENTOS CORRETORA DE CÂMBIO, TÍTULOS E VALORES MOBILIÁRIOS" }]),
      line(796, [{ x: 273, text: "S.A. | Extrato" }]),
      line(740, [{ x: 25, text: "JVVGP CONSULTORIA MEDICA LTDA" }, { x: 491, text: "Conta: 17280445" }]),
      line(710, [{ x: 424, text: "De: 11/07/2026 Até: 09/09/2026" }]),
      line(690, [{ x: 25, text: "Saldo disponível: R$ 0,00" }]),
      line(554, [
        { x: 35, text: "Liq" }, { x: 116, text: "Mov" }, { x: 198, text: "Histórico" },
        { x: 416, text: "Valor" }, { x: 498, text: "Saldo" },
      ]),
      line(534, [
        { x: 35, text: "09/09/2026" }, { x: 116, text: "09/09/2026" },
        { x: 198, text: "Taxa Gestao Externa s/ Carteira Adm 1000572" },
        { x: 416, text: "-R$ 379,81" }, { x: 498, text: "R$ 0,00" },
      ]),
      line(514, [
        { x: 35, text: "09/09/2026" }, { x: 116, text: "09/09/2026" },
        { x: 198, text: "RESGATE Trend Cash CIC de Classes RF Simples RL" },
        { x: 416, text: "R$ 369,86" }, { x: 498, text: "R$ 379,81" },
      ]),
      line(496, [{ x: 198, text: "IRRF S/RESGATE FUNDOS - Trend Cash CIC de Classes" }]),
      line(492, [
        { x: 35, text: "09/09/2026" }, { x: 116, text: "09/09/2026" },
        { x: 416, text: "-R$ 3,08" }, { x: 498, text: "R$ 9,95" },
      ]),
      line(484, [{ x: 198, text: "RF Simples RL" }]),
    ]);

    expect(result).toMatchObject({
      bank: "XP",
      layout: "Investimentos",
      accountHolder: "JVVGP CONSULTORIA MEDICA LTDA",
      account: "17280445",
      detectedOpeningBalance: 13.03,
      detectedClosingBalance: 0,
    });
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-09-09",
      accountingDate: "2026-09-09",
      description: "IRRF S/RESGATE FUNDOS - Trend Cash CIC de Classes RF Simples RL",
      type: "DEBIT",
      amount: 3.08,
      balance: 9.95,
    });
  });

  it("rejeita um PDF que não corresponde aos layouts conhecidos", () => {
    expect(() => parseXpStatement([
      line(100, [{ x: 20, text: "Documento desconhecido" }]),
    ])).toThrow("nenhum dos layouts");
  });
});
