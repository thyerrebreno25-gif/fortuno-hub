import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseBtgInvoice } from "./btg-parser";
import { invoiceReviewItems } from "../review-items";

function line(text: string, parts?: Array<{ x: number; text: string }>, page = 1): PdfTextLine {
  return { page, y: 100, text, parts };
}

describe("leitor de fatura BTG", () => {
  it("associa conversões em reais às compras internacionais de cada coluna", () => {
    const result = parseBtgInvoice([
      line("Vencimento: 11/10/2026"),
      line("Total de compras e despesas dessa fatura R$ 160,00"),
      line("Lançamentos do cartão virtual | Cliente Teste | Final 1234"),
      line("02/10 Assinatura US$ 10,00 06/10 Assinatura US$ 20,00", [
        { x: 39, text: "02/10" }, { x: 86, text: "Assinatura" }, { x: 236, text: "US$ 10,00" },
        { x: 311, text: "06/10" }, { x: 358, text: "Assinatura" }, { x: 508, text: "US$ 20,00" },
      ]),
      line("Cotação da moeda - R$ 5,00 Cotação da moeda - R$ 5,50", [
        { x: 116, text: "Cotação da moeda -" }, { x: 245, text: "R$ 5,00" },
        { x: 388, text: "Cotação da moeda -" }, { x: 517, text: "R$ 5,50" },
      ]),
      line("Conversão para Real - R$ 50,00 Conversão para Real - R$ 110,00", [
        { x: 116, text: "Conversão para Real -" }, { x: 237, text: "R$ 50,00" },
        { x: 388, text: "Conversão para Real -" }, { x: 509, text: "R$ 110,00" },
      ]),
    ]);
    const review = invoiceReviewItems(result.items);
    expect(review).toHaveLength(2);
    expect(review).toEqual([
      expect.objectContaining({ date: "2026-10-02", amount: 50, description: "Assinatura", cardLastDigits: "1234", transactionType: "INTERNATIONAL_PURCHASE" }),
      expect.objectContaining({ date: "2026-10-06", amount: 110, description: "Assinatura", cardLastDigits: "1234", transactionType: "INTERNATIONAL_PURCHASE" }),
    ]);
    expect(review.reduce((sum, item) => sum + item.amount, 0)).toBe(160);
    expect(result.warnings).toEqual([]);
  });

  it.each(["card", "page", "purchase"])("não associa conversão após mudança de %s", (boundary) => {
    const foreign = line("02/10 Assinatura US$ 10,00", [
      { x: 39, text: "02/10" }, { x: 86, text: "Assinatura" }, { x: 236, text: "US$ 10,00" },
    ]);
    const conversion = line("Conversão para Real - R$ 50,00", [
      { x: 116, text: "Conversão para Real -" }, { x: 237, text: "R$ 50,00" },
    ], boundary === "page" ? 2 : 1);
    const result = parseBtgInvoice([
      line("Vencimento: 11/10/2026"),
      line("Lançamentos do cartão virtual | Cliente Teste | Final 1234"),
      foreign,
      ...(boundary === "card" ? [line("Lançamentos do cartão virtual | Cliente Teste | Final 5678")] : []),
      ...(boundary === "purchase" ? [line("03/10 Loja R$ 20,00", [
        { x: 39, text: "03/10" }, { x: 86, text: "Loja" }, { x: 236, text: "R$ 20,00" },
      ])] : []),
      conversion,
    ]);
    expect(result.items.some((item) => item.transactionType === "INTERNATIONAL_PURCHASE")).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("conversão"))).toBe(true);
  });

  it("separa duas compras na mesma linha e ignora o pagamento anterior", () => {
    const source: PdfTextLine[] = [
      line("Vencimento: 11/08/2026"),
      line(
        "Total de compras e despesas dessa fatura R$ 311,75",
        [{ x: 317, text: "Total de compras e despesas dessa fatura" }, { x: 515, text: "R$ 311,75" }],
        2,
      ),
      line("Pagamentos feitos pelo cliente", undefined, 3),
      line("13/07 Pagamento de fatura R$ 1.539,29", [
        { x: 40, text: "13/07" },
        { x: 87, text: "Pagamento de fatura" },
        { x: 231, text: "R$ 1.539,29" },
      ], 3),
      line("Lançamentos do cartão físico | Camila Machado | Final 3755 Total do cartão: R$ 186,24", undefined, 3),
      line("05/08 Posto O Amigao Dos Mo R$ 186,24", [
        { x: 39, text: "05/08" },
        { x: 86, text: "Posto O Amigao Dos Mo" },
        { x: 237, text: "R$ 186,24" },
      ], 3),
      line("Lançamentos do cartão virtual | Elisa Machado | Final 3915 Total do cartão: R$ 125,51", undefined, 3),
      line("05/08 Restaurante Sinuelo R$ 114,51 05/08 Restaurante Maiochi R$ 11,00", [
        { x: 39, text: "05/08" },
        { x: 86, text: "Restaurante Sinuelo" },
        { x: 237, text: "R$ 114,51" },
        { x: 311, text: "05/08" },
        { x: 358, text: "Restaurante Maiochi" },
        { x: 513, text: "R$ 11,00" },
      ], 3),
    ];

    const result = parseBtgInvoice(source);

    expect(result.bank).toBe("BTG");
    expect(result.dueDate).toBe("2026-08-11");
    expect(result.invoiceTotal).toBe(311.75);
    expect(result.items).toHaveLength(3);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(311.75, 2);
    expect(result.items.map((item) => item.description)).toEqual([
      "Posto O Amigao Dos Mo",
      "Restaurante Sinuelo",
      "Restaurante Maiochi",
    ]);
    expect(result.items.filter((item) => item.cardLastDigits === "3915")).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });
});
