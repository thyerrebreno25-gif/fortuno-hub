import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseSantanderInvoice } from "./santander-parser";

function line(text: string, parts?: Array<{ x: number; text: string }>, page = 1): PdfTextLine {
  return { page, y: 100, text, parts };
}

function transaction(
  date: string,
  description: string,
  amount: string,
  options?: { installment?: string; currency?: string; page?: number },
): PdfTextLine {
  const parts = [
    { x: 18, text: date },
    { x: 66, text: description },
    ...(options?.installment
      ? [{ x: 178, text: "PARC" }, { x: 201, text: options.installment }]
      : []),
    ...(options?.currency ? [{ x: 368, text: options.currency }] : []),
    { x: 489, text: amount },
  ];
  return line(parts.map((part) => part.text).join(" "), parts, options?.page ?? 1);
}

describe("leitor de fatura Santander", () => {
  it("lê vários cartões, continuação de página, compra internacional e ignora pagamento", () => {
    const source: PdfTextLine[] = [
      line("Data de Vencimento: 20/08/2026 Data do Fechamento da Fatura: 07/08/2026"),
      line("Demonstrativo de Transações"),
      line("CRISTIANE DE MELO D 5526 XXXX XXXX 8407"),
      transaction("17-12-2025", "CONTA AZUL", "100,00", { installment: "08/12" }),
      transaction("07-07-2026", "UBER *TRIP", "95,24", { currency: "EUR" }),
      transaction("07-07-2026", "IOF DESPESA NO EXTERIOR", "3,33"),
      line("Total em R$ 198,57"),
      line("GUSTAVO F TRINDADE 5404 XXXX XXXX 3969"),
      transaction("25-04-2026", "ASAAS*GRUPO JUMANIY LT", "200,00", { installment: "04/06" }),
      line("GUSTAVO F TRINDADE 5526 XXXX XXXX 6594"),
      transaction("20-07-2026", "DEB AUTOM DE FATURA EM", "-7.948,80"),
      transaction("28-07-2026", "VOCE FARMA", "50,00", { page: 2 }),
      line("Total desta fatura", undefined, 2),
      line("Total de compras desta Fatura (R$ + US$) 448,57", undefined, 2),
    ];

    const result = parseSantanderInvoice(source);

    expect(result.bank).toBe("SANTANDER");
    expect(result.dueDate).toBe("2026-08-20");
    expect(result.invoiceTotal).toBe(448.57);
    expect(result.items).toHaveLength(5);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(448.57, 2);
    expect(result.items.find((item) => item.description === "CONTA AZUL")).toMatchObject({
      installment: "8/12",
      cardLastDigits: "8407",
      transactionType: "INSTALLMENT_PURCHASE",
    });
    expect(result.items.find((item) => item.description === "UBER *TRIP")?.transactionType).toBe("INTERNATIONAL_PURCHASE");
    expect(result.items.find((item) => item.description.includes("IOF"))?.transactionType).toBe("INTERNATIONAL_IOF");
    expect(result.items.some((item) => item.description.includes("DEB AUTOM"))).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});
