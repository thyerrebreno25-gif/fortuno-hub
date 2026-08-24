import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseItauInvoice } from "./itau-parser";

function lines(values: string[]): PdfTextLine[] {
  return values.map((text, index) => ({ page: index < 20 ? 1 : 2, y: 1000 - index, text }));
}

describe("leitor de fatura do Itaú", () => {
  it("concilia créditos, remove um estorno integral e fecha o total líquido", () => {
    const source = lines([
      "ITAU EMPRESAS MASTERCARD BLACK - 0005.XXXX.XXXX.5801",
      "fatura do cartão: vencimento: data de fechamento:",
      "Fechada 12/08/2026 30 julho",
      "Total da fatura R$3.615,93",
      "PAGAMENTO EFETUADO 13/07 -R$4.009,21",
      "Lançamentos",
      "ARIANE HELENA LIMA DOS REI - FINAL 8273",
      "Lançamentos nacionais",
      "02/05 JIM.COM* D D 03/04 R$90,00",
      "05/05 JIM.COM* PROTEGER 03/06 R$1.429,86",
      "05/06 JIM.COM* PRO-CT R 02/03 R$496,68",
      "05/06 JIM.COM* PRO-CT R CEN -R$0,04",
      "18/06 Azul Seguros 02/10 R$218,45",
      "18/06 Azul Seguros -R$0,36",
      "30/06 ANUIDADE DIFERENCI06/12 R$83,25",
      "02/07 MP *SOPAPEL -CT R$36,00",
      "05/07 LEROY MERLIN-CT R$81,66",
      "09/07 MERCADOLIVRE*360IMPRIM R$271,44",
      "09/07 MP *SHELLBOX R$266,25",
      "10/07 SHOPEE *SHPSTECNOLOGIA R$9,90",
      "16/07 PAPELARIA LI-CT R$14,15",
      "21/07 KARLA VIEIRA BOLSA01/04 R$249,50",
      "21/07 KARLA VIEIRA BOLSAS -R$998,00",
      "21/07 KARLA VIEIRA BOLSA02/04 R$249,50",
      "21/07 KARLA VIEIRA BOLSA03/04 R$249,50",
      "21/07 KARLA VIEIRA BOLSA04/04 R$249,50",
      "22/07 COZINHA GRIL-CT R$113,08",
      "24/07 EC *SHELLBOX R$293,32",
      "28/07 Google One R$9,99",
      "28/07 A FESTIVA -CT R$202,30",
      "Total de lançamentos nacionais R$3.615,93",
    ]);

    const result = parseItauInvoice(source);

    expect(result.bank).toBe("ITAU");
    expect(result.dueDate).toBe("2026-08-12");
    expect(result.invoiceTotal).toBe(3615.93);
    expect(result.items).toHaveLength(15);
    expect(result.items.reduce((total, item) => total + item.amount, 0)).toBeCloseTo(3615.93, 2);
    expect(result.items.some((item) => item.description.includes("KARLA VIEIRA"))).toBe(false);
    expect(result.items.find((item) => item.description.includes("PRO-CT R"))).toMatchObject({
      amount: 496.64,
      installment: "2/3",
      cardLastDigits: "8273",
    });
    expect(result.items.find((item) => item.description === "Azul Seguros")).toMatchObject({
      amount: 218.09,
      installment: "2/10",
    });
    expect(result.items.find((item) => item.description.startsWith("ANUIDADE"))).toMatchObject({
      amount: 83.25,
      installment: "6/12",
    });
    expect(result.warnings).toEqual([]);
  });

  it("mantém crédito líquido e relaciona estorno de outra data", () => {
    const source = lines([
      "fatura do cartão: vencimento: data de fechamento:",
      "Fechada 11/08/2026 30 julho",
      "Total da fatura R$168,19",
      "Lançamentos",
      "ALESSANDRA LIMA CARDOSO BI - FINAL 1106",
      "10/07 COMPRA SEM ESTORNO R$200,00",
      "13/06 ReiArma*Rei Armari02/02 R$31,81",
      "13/06 ReiArma*Rei Armarinho -R$0,01",
      "13/06 ReiArma*Rei Armarinho -R$63,61",
      "30/06 ANUIDADE DIFERENCI06/12 R$83,25",
      "30/07 ESTORNO DE ANUIDADE DIF -R$83,25",
      "Total de lançamentos nacionais R$168,19",
    ]);

    const result = parseItauInvoice(source);

    expect(result.items).toHaveLength(2);
    expect(result.items.reduce((total, item) => total + item.amount, 0)).toBeCloseTo(168.19, 2);
    expect(result.items.some((item) => item.description.startsWith("ANUIDADE"))).toBe(false);
    expect(result.items.find((item) => item.amount < 0)).toMatchObject({
      description: "ReiArma*Rei Armarinho",
      amount: -31.81,
      cardLastDigits: "1106",
    });
    expect(result.warnings).toEqual([]);
  });
});
