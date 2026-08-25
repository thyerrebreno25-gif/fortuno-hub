import { describe, expect, it } from "vitest";
import {
  parseInvoiceImagePages,
  type InvoiceImagePage,
  type InvoiceImageTextLine,
} from "./image-transactions";

function row(y: number, ...values: Array<[number, string]>): InvoiceImageTextLine[] {
  return values.map(([x, text]) => ({ x, y, text }));
}

describe("leitor genérico de prints de fatura", () => {
  it("lê o print móvel, ignora pagamento e preserva parcela e compras internacionais", () => {
    const page: InvoiceImagePage = {
      name: "image (8).png",
      text: "Valor total\nR$ 2.676,43\nFatura paga\nVenc. 17/08/2026",
      lines: [
        ...row(0.10, [0.05, "Valor total"], [0.75, "Fatura paga"]),
        ...row(0.13, [0.05, "R$ 2.676,43"], [0.68, "Venc. 17/08/2026"]),
        ...row(0.30, [0.05, "11/08"], [0.18, "Pagamento total da fatura"], [0.78, "R$ 2.676,43"]),
        ...row(0.38, [0.05, "02/08"], [0.18, "VERCEL INC."], [0.80, "R$ 704,14"]),
        ...row(0.40, [0.18, "USD 128,84 / USD 128,84"]),
        ...row(0.42, [0.18, "Conversão dolar - U$ 0,0528"]),
        ...row(0.44, [0.18, "IOF - R$ 23,81"]),
        ...row(0.50, [0.05, "01/08"], [0.18, "VMO*VIMEO.COM"], [0.80, "R$ 1.639,56"]),
        ...row(0.52, [0.18, "USD 300 / USD 300"]),
        ...row(0.58, [0.05, "30/07"], [0.18, "VERCEL INC."], [0.80, "R$ 5,35"]),
        ...row(0.64, [0.05, "19/07"], [0.18, "IG*STAYCLOUD"], [0.80, "R$ 39,90"]),
        ...row(0.70, [0.05, "12/07"], [0.18, "AXIOM"], [0.80, "R$ 137,48"]),
        ...row(0.72, [0.18, "USD 25 / USD 25"]),
        ...row(0.78, [0.05, "09/07"], [0.18, "Microsoft*Microsoft 365 P"], [0.80, "R$ 51,00"]),
        ...row(0.84, [0.05, "11/11"], [0.18, "EC *ADAPTA"], [0.52, "9/12"], [0.80, "R$ 99,00"]),
      ],
    };

    const result = parseInvoiceImagePages([page], "Itaú", new Date("2026-08-25"));

    expect(result.dueDate).toBe("2026-08-17");
    expect(result.invoiceTotal).toBe(2676.43);
    expect(result.items).toHaveLength(7);
    expect(result.items.some((item) => /Pagamento/i.test(item.description))).toBe(false);
    expect(result.items[0]).toMatchObject({
      date: "2026-08-02",
      description: "VERCEL INC.",
      amount: 704.14,
      transactionType: "INTERNATIONAL_PURCHASE",
    });
    expect(result.items.at(-1)).toMatchObject({
      date: "2025-11-11",
      description: "EC *ADAPTA",
      amount: 99,
      installment: "9/12",
      transactionType: "INSTALLMENT_PURCHASE",
    });
  });

  it("combina imagens, remove a sobreposição e mantém ocorrências legítimas", () => {
    const first: InvoiceImagePage = {
      name: "parte-1.png",
      text: "",
      lines: [
        ...row(0.2, [0.05, "01/08"], [0.2, "LOJA A"], [0.8, "R$ 10,00"]),
        ...row(0.3, [0.05, "02/08"], [0.2, "LOJA B"], [0.8, "R$ 20,00"]),
      ],
    };
    const second: InvoiceImagePage = {
      name: "parte-2.png",
      text: "",
      lines: [
        ...row(0.2, [0.05, "02/08"], [0.2, "LOJA B"], [0.8, "R$ 20,00"]),
        ...row(0.3, [0.05, "03/08"], [0.2, "LOJA C"], [0.8, "R$ 30,00"]),
        ...row(0.4, [0.05, "03/08"], [0.2, "LOJA C"], [0.8, "R$ 30,00"]),
      ],
    };

    const result = parseInvoiceImagePages(
      [first, second],
      "Banco",
      new Date("2026-08-25"),
    );

    expect(result.items.map((item) => item.description)).toEqual([
      "LOJA A",
      "LOJA B",
      "LOJA C",
      "LOJA C",
    ]);
    expect(result.invoiceTotal).toBe(90);
    expect(result.warnings.join(" ")).toContain("1 lançamento(s) repetido(s)");
    expect(result.warnings.join(" ")).toContain("Importação parcial por imagem");
  });

  it("usa somente o valor presente nos prints quando eles são um recorte da fatura", () => {
    const page: InvoiceImagePage = {
      name: "recorte.png",
      text: "Valor total R$ 500,00 Venc. 20/08/2026",
      lines: row(0.5, [0.05, "05/08"], [0.2, "COMPRA SELECIONADA"], [0.8, "R$ 100,00"]),
    };

    const result = parseInvoiceImagePages([page], "Banco");

    expect(result.invoiceTotal).toBe(100);
    expect(result.warnings.join(" ")).toContain("fatura de R$ 500,00");
    expect(result.warnings.join(" ")).toContain("R$ 100,00 em lançamentos");
  });

  it("aceita datas por extenso usadas em prints do Banco Inter", () => {
    const page: InvoiceImagePage = {
      name: "inter.png",
      text: "Vencimento 25/08/2026",
      lines: row(
        0.5,
        [0.05, "19 de ago 2026"],
        [0.25, "ASSINATURA ONLINE"],
        [0.8, "R$ 45,90"],
      ),
    };

    const result = parseInvoiceImagePages([page], "Banco Inter");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      date: "2026-08-19",
      description: "ASSINATURA ONLINE",
      amount: 45.9,
    });
  });
});
