import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseSicrediInvoice } from "./sicredi-parser";

function line(
  text: string,
  parts?: Array<{ x: number; text: string }>,
  options?: { page?: number; y?: number },
): PdfTextLine {
  return { page: options?.page ?? 2, y: options?.y ?? 100, text, parts };
}

function transaction(
  date: string,
  description: string,
  amount: string,
  options?: { installment?: string; international?: string; y?: number },
) {
  const parts = [
    { x: 43, text: date },
    { x: 237, text: description },
    ...(options?.installment ? [{ x: 353, text: options.installment }] : []),
    ...(options?.international ? [{ x: 386, text: options.international }] : []),
    { x: 515, text: amount },
  ];
  return line(parts.map((part) => part.text).join(" "), parts, { y: options?.y });
}

describe("leitor de fatura Sicredi", () => {
  it("lê vários cartões, parcelas, exterior e ignora o pagamento da fatura", () => {
    const source: PdfTextLine[] = [
      line("Vencimento 23/08/2026"),
      line("Total fatura de agosto R$ 1.025,70", [
        { x: 441, text: "Total fatura de agosto" },
        { x: 522, text: "R$ 1.025,70" },
      ]),
      line("Transações"),
      line("Cartão Renata Souza Crispi (final 0110)"),
      line("Anuidade Diferenc 08/12", [{ x: 237, text: "Anuidade Diferenc 08/12" }], { y: 204 }),
      transaction("09/ago 21:43", "", "R$ 14,16", { y: 200 }),
      line("0110", [{ x: 237, text: "0110" }], { y: 196 }),
      transaction("05/ago 21:49", "Iof Compra Internacional", "R$ 5,56", { y: 170 }),
      transaction("04/ago 11:02", "Gupshup Inc", "R$ 159,04", { international: "BRL 159,04 = US$ 0,00", y: 140 }),
      transaction("14/jul 11:57", "Super Adega", "R$ 846,94", { installment: "01/02", y: 110 }),
      transaction("23/jul 21:02", "Pagamento 025811412", "-R$ 4.613,60", { y: 80 }),
      line("Cartão portador virtual Renata Souza Crispi (final 1234)"),
    ];

    const result = parseSicrediInvoice(source);

    expect(result.bank).toBe("SICREDI");
    expect(result.dueDate).toBe("2026-08-23");
    expect(result.invoiceTotal).toBe(1025.7);
    expect(result.items).toHaveLength(4);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(1025.7, 2);
    expect(result.items.find((item) => item.description === "Anuidade Diferenc 0110")).toMatchObject({
      installment: "8/12",
      cardLastDigits: "0110",
      transactionType: "INSTALLMENT_PURCHASE",
    });
    expect(result.items.find((item) => item.description.includes("Iof"))?.transactionType).toBe("INTERNATIONAL_IOF");
    expect(result.items.find((item) => item.description === "Gupshup Inc")?.transactionType).toBe("INTERNATIONAL_PURCHASE");
    expect(result.items.some((item) => item.description.startsWith("Pagamento"))).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});
