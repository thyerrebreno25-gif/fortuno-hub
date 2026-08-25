import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseCaixaInvoice } from "./caixa-parser";

function line(text: string, parts?: Array<{ x: number; text: string }>, page = 1): PdfTextLine {
  return { page, y: 100, text, parts };
}

function movement(
  date: string,
  description: string,
  amount: string,
  options?: { installment?: string; city?: string },
): PdfTextLine {
  const parts = [
    { x: 315, text: date },
    { x: 331, text: description },
    ...(options?.installment ? [{ x: 395, text: options.installment }] : []),
    ...(options?.city ? [{ x: 428, text: options.city }] : []),
    { x: 550, text: amount },
  ];
  return line(parts.map((part) => part.text).join(" "), parts, 2);
}

describe("leitor de fatura CAIXA", () => {
  it("lê débitos, créditos e parcelas sem exportar saldo anterior e pagamento", () => {
    const source: PdfTextLine[] = [
      line("VENCIMENTO"),
      line("15/05/2026"),
      line("VALOR TOTAL DESTA FATURA"),
      line("15/05/2026 458,45", [{ x: 291, text: "15/05/2026" }, { x: 399, text: "458,45" }]),
      line("Demonstrativo", undefined, 2),
      movement("06/04", "TOTAL DA FATURA ANTERIOR", "1.000,00D"),
      movement("24/04", "OBRIGADO PELO PAGAMENTO", "1.000,00C"),
      movement("16/04", "JUROS ATRASO ROTATIVO", "10,00D"),
      movement("13/04", "AJUSTE CRED PARC S/ JUROS", "0,02C"),
      line("BRASILMED (Cartão 2501)", undefined, 2),
      movement("05/05", "IOF BASE DE ROTATIVO", "3,17D"),
      line("COMPRAS (Cartão 4385)", undefined, 2),
      movement("07/04", "SUPER ADEGA", "200,00D", { city: "BRASILIA" }),
      movement("27/10", "MERCADOLIVRE DIMAVEEQU", "245,30D", { installment: "07 DE 12", city: "OSASCO" }),
    ];

    const result = parseCaixaInvoice(source);

    expect(result.bank).toBe("CAIXA");
    expect(result.dueDate).toBe("2026-05-15");
    expect(result.invoiceTotal).toBe(458.45);
    expect(result.items).toHaveLength(5);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(458.45, 2);
    expect(result.items.some((item) => item.description.includes("FATURA ANTERIOR"))).toBe(false);
    expect(result.items.some((item) => item.description.includes("PAGAMENTO"))).toBe(false);
    expect(result.items.find((item) => item.description === "AJUSTE CRED PARC S/ JUROS")?.amount).toBe(-0.02);
    expect(result.items.find((item) => item.description === "MERCADOLIVRE DIMAVEEQU")).toMatchObject({
      date: "2025-10-27",
      installment: "7/12",
      cardLastDigits: "4385",
      transactionType: "INSTALLMENT_PURCHASE",
    });
    expect(result.warnings).toEqual([]);
  });
});
