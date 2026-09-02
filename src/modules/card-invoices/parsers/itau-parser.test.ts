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

  it("continua a leitura quando uma única fatura possui mais de um cartão", () => {
    const source = lines([
      "ITAU EMPRESAS MASTERCARD - 0005.XXXX.XXXX.7209",
      "fatura do cartão: vencimento: data de fechamento:",
      "Fechada 20/08/2026 09 agosto",
      "Total da fatura R$1.648,53",
      "Lançamentos",
      "EDUARDA REIS ARAUJO - FINAL 5561",
      "Lançamentos nacionais",
      "21/07 ANUIDADE DIFERENCI01/12 R$18,75",
      "Total de lançamentos nacionais R$18,75",
      "EDUARDA REIS ARAUJO - FINAL 3354",
      "Lançamentos nacionais",
      "23/08 EBN*Canva04617 35 12/12 R$108,51",
      "12/03 Madeira*MadeiraMad05/05 R$371,55",
      "17/03 CONTA AZUL 05/12 R$349,90",
      "23/05 EBN*Canva04890 29 03/03 R$35,80",
      "07/07 FACEBK* KPHY7XZK2 R$68,30",
      "09/07 FACEBK* W3FCLWHZK2 R$68,38",
      "11/07 FACEBK* YUWKTWHZK2 R$68,30",
      "13/07 FACEBK* RX4GSWVZK2 R$42,23",
      "14/07 AMAZON BR R$58,49",
      "14/07 FACEBK* 7TNG3X52L2 R$68,69",
      "15/07 FACEBK* JCAG2X92L2 R$68,59",
      "23/07 FACEBK* EKH8UXD2L2 R$314,18",
      "23/07 ESTORNO DE ANUIDADE DIF -R$18,75",
      "24/07 AMAZON BR R$19,71",
      "02/08 APPLE.COM/BILL R$5,90",
      "Total de lançamentos nacionais R$1.629,78",
      "Produtos, serviços e encargos",
      "25/08 LINHA QUE NAO E COMPRA R$999,00",
    ]);

    const result = parseItauInvoice(source);

    expect(result.items).toHaveLength(14);
    expect(result.items.reduce((total, item) => total + item.amount, 0)).toBeCloseTo(1_648.53, 2);
    expect(result.items.some((item) => item.cardLastDigits === "5561")).toBe(false);
    expect(result.items.filter((item) => item.cardLastDigits === "3354")).toHaveLength(14);
    expect(result.items.some((item) => item.description.includes("LINHA QUE NAO"))).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("lê compras internacionais quando descrição e valores ficam em linhas próximas", () => {
    const source: PdfTextLine[] = [
      { page: 1, y: 700, text: "ITAU EMPRESAS VISA - 0004.XXXX.XXXX.0445" },
      { page: 1, y: 680, text: "fatura do cartão: vencimento: data de fechamento:" },
      { page: 1, y: 660, text: "Fechada 15/08/2026 04 agosto" },
      { page: 1, y: 640, text: "Total da fatura R$683,77" },
      { page: 1, y: 620, text: "Lançamentos" },
      { page: 1, y: 600, text: "JOAO VITOR - FINAL 0543" },
      { page: 1, y: 580, text: "Lançamentos nacionais" },
      { page: 1, y: 560, text: "01/07 COMPRA NACIONAL R$100,00" },
      { page: 1, y: 540, text: "Total de lançamentos nacionais R$100,00" },
      { page: 1, y: 520, text: "Lançamentos internacionais" },
      {
        page: 1,
        y: 498,
        text: "07/07 BRL550,00 US$107,31 R$5,44 R$583,77",
        parts: [
          { x: 36, text: "07/07" },
          { x: 305, text: "BRL550,00" },
          { x: 375, text: "US$107,31" },
          { x: 452, text: "R$5,44" },
          { x: 531, text: "R$583,77" },
        ],
      },
      {
        page: 1,
        y: 496,
        text: "ANTHROPIC* CLAUDE SUB",
        parts: [{ x: 79, text: "ANTHROPIC* CLAUDE SUB" }],
      },
      { page: 1, y: 470, text: "Total de lançamentos internacionais R$583,77" },
      { page: 1, y: 450, text: "Produtos, serviços e encargos" },
    ];

    const result = parseItauInvoice(source);

    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.transactionType === "INTERNATIONAL_PURCHASE"))
      .toMatchObject({
        date: "2026-07-07",
        description: "ANTHROPIC* CLAUDE SUB",
        amount: 583.77,
        cardLastDigits: "0543",
      });
    expect(result.items.reduce((total, item) => total + item.amount, 0)).toBeCloseTo(683.77, 2);
    expect(result.warnings).toEqual([]);
  });
});
