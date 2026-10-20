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

// Synthetic data reproducing the PDF.js spacing and column boundaries, without customer data.
it("reconhece palavras fragmentadas, centavos espaçados e ignora parcelas futuras", () => {
  const source: PdfTextLine[] = [
    line("Vencimento: 05/06/2026", [{ x: 241, text: "Vencimento: 05/06/2026" }], 1, 662),
    line("Emissão: 26/05/2026", [{ x: 251, text: "Emissão: 26/05/2026" }], 1, 655),
    line("= Total desta fatura 1 21,00", [{ x: 367, text: "=" }, { x: 375, text: "Total desta fatura" }, { x: 540, text: "1 21,00" }], 1, 648),
    line("S Saldo financiado -10,00", [{ x: 367, text: "S" }, { x: 375, text: "Saldo financiado" }, { x: 540, text: "-10,00" }], 1, 640),
    line("Pa ga me nt os e fet u ad o s", [{ x: 142, text: "Pa ga me nt os e fet u ad o s" }], 2, 714),
    movement("11/05", "Pagamento debito minim o", "-10,00", 2, 698),
    movement("11/05", "PAGAMENTO", "-50,00", 2, 693),
    line("La nça me nt os : co m pr as e sa qu es Li mi tes de c ré dit o", [{ x: 142, text: "La nça me nt os : co m pr as e sa qu es" }, { x: 361, text: "Li mi tes de c ré dit o" }], 2, 646),
    movement("27/04", "LO JA EXEMPLO", "9 0,00", 2, 614),
    line("Prin cipal (R$ 90,00) + Juro s (R$ 0,00)", [{ x:170, text:"Prin cipal (R$ 90,00) + Juro s (R$ 0,00)" }], 2, 605),
    movement("07/05", "LOJA TESTE 01/06", "20, 00", 2, 541),
    movement("22/ 05", "LOJA TESTE B", "15 ,00", 2, 468),
    line("C om p ra s p ar cel ad as - p ró x im as fa tur as", [{ x:142, text:"C om p ra s p ar cel ad as - p ró x im as fa tur as" }], 2, 395),
    movement("07/05", "LOJA TESTE 02/06", "6,00", 2, 374),
    movement("12/05", "LOJA FUTURA 02/11", "4,00", 2, 706, "right"),
    line("Enca rg o s c ob ra do s nes ta f at u ra", [{ x:361, text:"Enca rg o s c ob ra do s nes ta f at u ra" }], 2, 544),
    line("Juros do rota tivo 14,00 % 2,00", [{ x:361, text:"Juros do rota tivo" }, { x:499, text:"14,00 %" }, { x:540, text:"2,00" }], 2, 532),
    line("Ju ro s de mor a 1,00", [{ x:361, text:"Ju ro s de mor a" }, { x:540, text:"1,00" }], 2, 522),
    line("Mul ta po r atra so 3,00", [{ x:361, text:"Mul ta po r atra so" }, { x:540, text:"3,00" }], 2, 511),
    line("Novo teto de juros do cartão", [{ x:359, text:"Novo teto de juros do cartão" }], 2, 463),
    line("Juros do rotativo 100,00", [{ x:361, text:"Juros do rotativo" }, { x:540, text:"100,00" }], 2, 440),
  ];
  const result = parseItauInvoice(source);
  expect(result.dueDate).toBe("2026-06-05");
  expect(result.invoiceTotal).toBe(121);
  expect(result.items).toHaveLength(7);
  expect(result.items.reduce((total,item) => total + item.amount,0)).toBe(121);
  expect(result.items.find((item) => item.installment)).toMatchObject({ installment: "1/6", amount:20 });
  expect(result.items.find((item) => item.description === "LOJA TESTE B")?.date).toBe("2026-05-22");
  expect(result.items.filter((item) => item.amount < 0)).toEqual([expect.objectContaining({
    amount: -10, date: "2026-05-11", description: "PAGAMENTO DEBITO MINIMO - CREDITO NA FATURA", exportable: true,
  })]);
  expect(result.warnings).toEqual([]);
  // An already-reconciled invoice must never get the credit twice.
  const reconciled = source.map((row) => row.text.startsWith("= Total") ? line("= Total desta fatura 131,00", [{ x:375, text:"Total desta fatura" }, { x:540, text:"131,00" }],1,648) : row);
  expect(parseItauInvoice(reconciled).items).toHaveLength(6);
  expect(result.warnings.some((warning) => warning.includes("não foi localizada"))).toBe(false);
});
