import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseItauInvoice } from "./itau-parser";

function line(
  text: string,
  parts: Array<{ x: number; text: string }>,
  page: number,
  y: number,
): PdfTextLine {
  return { page, y, x: parts[0]?.x, text, parts };
}

function movement(
  date: string,
  description: string,
  amount: string,
  page: number,
  y: number,
  side: "left" | "right" = "left",
): PdfTextLine {
  const positions = side === "left" ? [151, 178, 319] : [367, 394, 535];
  const parts = [
    { x: positions[0], text: date },
    { x: positions[1], text: description },
    { x: positions[2], text: amount },
  ];
  return line(parts.map((part) => part.text).join(" "), parts, page, y);
}

describe("leitor do layout Itaú/Azul", () => {
  it("lê duas colunas, exterior, produtos, créditos e encargos sem atingir o layout Itaú novo", () => {
    const source: PdfTextLine[] = [
      line("Vencimento: 06/08/2026", [{ x: 245, text: "Vencimento: 06/08/2026" }], 1, 700),
      line("Emissão: 30/07/2026", [{ x: 245, text: "Emissão: 30/07/2026" }], 1, 690),
      line("= Total desta fatura 354,95", [
        { x: 358, text: "=" },
        { x: 367, text: "Total desta fatura" },
        { x: 522, text: "354,95" },
      ], 1, 680),
      line("Lançamentos: compras e saques", [{ x: 151, text: "Lançamentos: compras e saques" }], 2, 700),
      line("FELIPE (final 7191)", [{ x: 151, text: "FELIPE (final 7191)" }], 2, 690),
      movement("14/07", "V4BAYERCO", "100,00", 2, 680),
      line("Lançamentos: compras e saques", [{ x: 367, text: "Lançamentos: compras e saques" }], 2, 700),
      movement("01/06", "AMAZON PRIME02/05", "200,00", 2, 680, "right"),
      movement("01/06", "AMAZON PRIME", "- 0,05", 2, 660, "right"),
      line("Lançamentos internacionais", [{ x: 151, text: "Lançamentos internacionais" }], 3, 700),
      line("FELIPE (final 7191)", [{ x: 151, text: "FELIPE (final 7191)" }], 3, 690),
      movement("04/07", "MOULTRIE", "30,00", 3, 680),
      line("Repasse de IOF em R$ 3,00", [
        { x: 151, text: "Repasse de IOF em R$" },
        { x: 325, text: "3,00" },
      ], 3, 670),
      line("Lançamentos: produtos e serviços", [{ x: 367, text: "Lançamentos: produtos e serviços" }], 3, 700),
      movement("30/06", "ANUIDADE06/12", "10,00", 3, 680, "right"),
      line("Titular 2656", [{ x: 394, text: "Titular" }, { x: 419, text: "2656" }], 3, 670),
      line("Outros lançamentos", [{ x: 367, text: "Outros lançamentos" }], 3, 650),
      movement("30/06", "ACELERADOR DE PONTOS", "5,00", 3, 640, "right"),
      line("Encargos cobrados nesta fatura", [{ x: 367, text: "Encargos cobrados nesta fatura" }], 3, 620),
      line("Juros do rotativo 2,00", [
        { x: 367, text: "Juros do rotativo" },
        { x: 537, text: "2,00" },
      ], 3, 610),
      line("Juros de mora 1,00", [{ x: 151, text: "Juros de mora" }, { x: 328, text: "1,00" }], 4, 700),
      line("Multa por atraso 4,00", [{ x: 151, text: "Multa por atraso" }, { x: 321, text: "4,00" }], 4, 690),
    ];

    const result = parseItauInvoice(source);

    expect(result.bank).toBe("ITAU");
    expect(result.dueDate).toBe("2026-08-06");
    expect(result.invoiceTotal).toBe(354.95);
    expect(result.items).toHaveLength(10);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(354.95, 2);
    expect(result.items.find((item) => item.description === "AMAZON PRIME")).toMatchObject({
      installment: "2/5",
      cardLastDigits: "7191",
    });
    expect(result.items.find((item) => item.description === "MOULTRIE")?.transactionType).toBe("INTERNATIONAL_PURCHASE");
    expect(result.items.find((item) => item.description === "REPASSE DE IOF")?.transactionType).toBe("INTERNATIONAL_IOF");
    expect(result.warnings).toEqual([]);
  });
});
