import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseBtgInvoice } from "./btg-parser";

function line(text: string, parts?: Array<{ x: number; text: string }>, page = 1): PdfTextLine {
  return { page, y: 100, text, parts };
}

describe("leitor de fatura BTG", () => {
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
