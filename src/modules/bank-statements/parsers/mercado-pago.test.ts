import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseMercadoPagoStatement } from "./mercado-pago";

function line(y: number, parts: Array<{ x: number; text: string }>, page = 1): PdfTextLine {
  return { page, y, parts, text: parts.map((part) => part.text).join(" ") };
}

describe("leitor de extrato Mercado Pago", () => {
  it("reúne descrições quebradas e valida cada saldo da operação", () => {
    const result = parseMercadoPagoStatement([
      line(594, [{ x: 329, text: "EXTRATO DE CONTA" }]),
      line(584, [{ x: 231, text: "EMPRESA TESTE LTDA" }]),
      line(574, [
        { x: 211, text: "CPF/CNPJ:" }, { x: 250, text: "12345678000190" },
        { x: 309, text: "Agência:" }, { x: 340, text: "1" },
        { x: 346, text: "Conta:" }, { x: 370, text: "987654321" },
      ]),
      line(566, [{ x: 289, text: "Periodo:" }, { x: 319, text: "De 01-08-2026 al 31-08-2026" }]),
      line(526, [{ x: 178, text: "Entradas:" }, { x: 212, text: "R$ 50,00" }]),
      line(518, [
        { x: 44, text: "Saldo inicial:" }, { x: 88, text: "R$ 100,00" },
        { x: 325, text: "Saldo final:" }, { x: 364, text: "R$ 130,00" },
      ]),
      line(512, [{ x: 178, text: "Saidas:" }, { x: 204, text: "R$ -20,00" }]),
      line(442, [
        { x: 41, text: "Data" }, { x: 89, text: "Descrição" },
        { x: 197, text: "ID da operação" }, { x: 312, text: "Valor" }, { x: 384, text: "Saldo" },
      ]),
      line(416, [{ x: 89, text: "Pagamento com Código QR" }]),
      line(410, [
        { x: 41, text: "01-08-2026" }, { x: 89, text: "Pix CLIENTE" },
        { x: 197, text: "170623670613" }, { x: 301, text: "R$ 50,00" }, { x: 368, text: "R$ 150,00" },
      ]),
      line(404, [{ x: 89, text: "DA SILVA" }]),
      line(378, [
        { x: 41, text: "02-08-2026" }, { x: 89, text: "Pix enviado FORNECEDOR" },
        { x: 197, text: "171537214346" }, { x: 303, text: "R$ -20,00" }, { x: 368, text: "R$ 130,00" },
      ]),
    ]);

    expect(result).toMatchObject({
      bank: "Mercado Pago",
      accountHolder: "EMPRESA TESTE LTDA",
      branch: "1",
      account: "987654321",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      detectedOpeningBalance: 100,
      detectedClosingBalance: 130,
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      description: "Pagamento com Código QR Pix CLIENTE DA SILVA",
      sourceType: "Pagamento com Código QR",
      type: "CREDIT",
      amount: 50,
      balance: 150,
    });
    expect(result.transactions[1]).toMatchObject({ type: "DEBIT", amount: 20, balance: 130 });
  });

  it("bloqueia um extrato quando os totais declarados não fecham", () => {
    expect(() => parseMercadoPagoStatement([
      line(594, [{ x: 329, text: "EXTRATO DE CONTA" }]),
      line(584, [{ x: 231, text: "EMPRESA TESTE LTDA" }]),
      line(574, [
        { x: 211, text: "CPF/CNPJ:" }, { x: 250, text: "12345678000190" },
        { x: 309, text: "Agência:" }, { x: 340, text: "1" },
        { x: 346, text: "Conta:" }, { x: 370, text: "987654321" },
      ]),
      line(566, [{ x: 289, text: "Periodo:" }, { x: 319, text: "De 01-08-2026 al 31-08-2026" }]),
      line(526, [{ x: 178, text: "Entradas:" }, { x: 212, text: "R$ 60,00" }]),
      line(518, [
        { x: 44, text: "Saldo inicial:" }, { x: 88, text: "R$ 100,00" },
        { x: 325, text: "Saldo final:" }, { x: 364, text: "R$ 150,00" },
      ]),
      line(512, [{ x: 178, text: "Saidas:" }, { x: 204, text: "R$ 0,00" }]),
      line(442, [
        { x: 41, text: "Data" }, { x: 89, text: "Descrição" }, { x: 197, text: "ID da operação" },
      ]),
      line(410, [
        { x: 41, text: "01-08-2026" }, { x: 89, text: "Liberação de dinheiro" },
        { x: 197, text: "170623670613" }, { x: 301, text: "R$ 50,00" }, { x: 368, text: "R$ 150,00" },
      ]),
    ])).toThrow("leitura das entradas ficou incompleta");
  });

  it("preserva uma descrição que começa no fim da página anterior", () => {
    const result = parseMercadoPagoStatement([
      line(594, [{ x: 329, text: "EXTRATO DE CONTA" }]),
      line(584, [{ x: 231, text: "EMPRESA TESTE LTDA" }]),
      line(574, [
        { x: 211, text: "CPF/CNPJ:" }, { x: 250, text: "12345678000190" },
        { x: 309, text: "Agência:" }, { x: 340, text: "1" },
        { x: 346, text: "Conta:" }, { x: 370, text: "987654321" },
      ]),
      line(566, [{ x: 289, text: "Periodo:" }, { x: 319, text: "De 01-08-2026 al 31-08-2026" }]),
      line(526, [{ x: 178, text: "Entradas:" }, { x: 212, text: "R$ 20,00" }]),
      line(518, [
        { x: 44, text: "Saldo inicial:" }, { x: 88, text: "R$ 100,00" },
        { x: 325, text: "Saldo final:" }, { x: 364, text: "R$ 120,00" },
      ]),
      line(512, [{ x: 178, text: "Saidas:" }, { x: 204, text: "R$ 0,00" }]),
      line(410, [
        { x: 41, text: "01-08-2026" }, { x: 89, text: "Liberação de dinheiro" },
        { x: 197, text: "170623670613" }, { x: 301, text: "R$ 10,00" }, { x: 368, text: "R$ 110,00" },
      ]),
      line(98, [{ x: 89, text: "Pagamento com Código QR" }]),
      line(584, [
        { x: 41, text: "Data" }, { x: 89, text: "Descrição" }, { x: 197, text: "ID da operação" },
      ], 2),
      line(560, [
        { x: 41, text: "02-08-2026" }, { x: 89, text: "Pix CLIENTE" },
        { x: 197, text: "171537214346" }, { x: 303, text: "R$ 10,00" }, { x: 368, text: "R$ 120,00" },
      ], 2),
    ]);

    expect(result.transactions[1]).toMatchObject({
      description: "Pagamento com Código QR Pix CLIENTE",
      sourceType: "Pagamento com Código QR",
    });
  });
});
