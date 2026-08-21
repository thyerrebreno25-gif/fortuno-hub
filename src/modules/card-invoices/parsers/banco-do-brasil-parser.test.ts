import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseBancoDoBrasilInvoice } from "./banco-do-brasil-parser";

function line(page: number, text: string, index: number): PdfTextLine {
  return { page, y: 1000 - index, text };
}

describe("leitor de fatura do Banco do Brasil", () => {
  it("reconcilia o Ourocard empresarial e preserva lançamentos idênticos legítimos", () => {
    const page2 = [
      "Gabriella M Pereira Valor da fatura: R$ 3.448,78 Vencimento: 01/07/2026 Fatura fechada em: 19/06/2026",
      "Detalhes da fatura",
      "SALDO FATURA ANTERIOR BR 2.535,83",
      "Pagamentos/Créditos",
      "01/06 PGTO DEBITO CONTA 4594 000000000 2002 11 -2.535,83",
      "Outros lançamentos",
      "01/06 IOF DIAR ROT PJ REF.05/26 BR 0,03",
      "01/06 IOF ADIC ROT PJ REF.05/26 BR 4,21",
      "12/06 IOF - COMPRA NO EXTERIOR 3,76",
    ];
    const page3 = [
      "Subtotal 8,00",
      "Gabriella M Pereira (Cartão 7414)",
      "03/06 JERIVA ABADIANIA BR 79,80",
      "Serviços",
      "20/05 REDE AQUI BRASILIA BR 100,00",
      "26/05 CASCOL COMBUSTIVEIS BRASILIA BR 100,00",
      "28/05 EBN Canva04895 95 CURITIBA BR 81,00",
      "28/05 CASCOL COMBUSTIVEIS BRASILIA BR 100,00",
      "30/05 CASCOL COMBUSTIVEIS BRASILIA BR 100,00",
      "01/06 DL GOOGLE Workspacema Sao Pablo BR 196,00",
      "01/06 Vindi MelhorEnvio PELOTAS BR 48,49",
      "01/06 A GARIMPEIRA POR PROJE BRASILIA BR 350,00",
      "02/06 CASCOL COMBUSTIVEIS BRASILIA BR 321,16",
      "04/06 AmazonPrimeBR SAO PAULO BR 19,90",
      "11/06 OPENAI *CHATGPT SUBSCR 4158799686 CA 107,67",
      "*** 20,00 DOLAR AMERICANO",
      "Cotação do Dólar de 11/06: R$ 5,3834",
      "11/06 Vindi MelhorEnvio PELOTAS BR 43,68",
      "12/06 POSTNET BRASILIA BR 100,00",
      "12/06 BOLOS DO FLAVIO BRASILIA BR 30,00",
      "Supermercados",
      "01/06 BIG BOX SUPERMERCADOS BRASILIA BR 108,24",
      "Viagens",
      "03/06 CONCEBRA GOIANIA BR 7,40",
    ];
    const page4 = [
      "03/06 CONCEBRA GOIANIA BR 5,40",
      "03/06 CONCEBRA GOIANIA BR 5,40",
      "03/06 CONCEBRA GOIANIA BR 7,40",
      "Outros lançamentos",
      "07/06 DL GOOGLE Google 1123958400 BR 96,99",
      "13/06 Amazon Music SAO PAULO BR 11,90",
      "18/06 ANUIDADE DIFERENCIADA ADC-PARC 05/12 BR 3,45",
      "Compras parceladas",
      "15/10 VIVO DF LJ D0 PARC 21/21 BRASILIA BR 142,80",
      "18/09 AMAZON MARKET PARC 09/10 SAO PAULO BR 95,62",
      "21/01 AMAZONMKTPLC PARC 05/12 SAO PAULO BR 67,64",
      "30/03 JIM COM GUSTA PARC 03/03 GOIANIA BR 468,15",
      "06/04 EC CIADO PARC 03/06 JOINVILLE BR 129,59",
      "06/04 AMAZONMKTPLC PARC 03/04 SANTO ANDRE BR 93,92",
      "06/04 OLFATI PARC 03/03 APARECIDA DE BR 76,13",
      "13/04 JS COMERCIO D PARC 03/03 BELO HORIZON BR 194,33",
      "27/05 LEROY MERLIN PARC 01/02 BRASILIA BR 148,72",
      "Subtotal 3.440,78",
      "Total 3.448,78",
      "Total da fatura: R$ 3.448,78",
    ];
    const source = [
      ...page2.map((text, index) => line(2, text, index)),
      ...page3.map((text, index) => line(3, text, index)),
      ...page4.map((text, index) => line(4, text, index)),
    ];

    const result = parseBancoDoBrasilInvoice(source);

    expect(result.bank).toBe("BANCO_DO_BRASIL");
    expect(result.dueDate).toBe("2026-07-01");
    expect(result.invoiceTotal).toBe(3448.78);
    expect(result.items).toHaveLength(35);
    expect(result.items.reduce((total, item) => total + item.amount, 0)).toBeCloseTo(3448.78, 2);
    expect(result.items.some((item) => item.description.includes("PGTO DEBITO"))).toBe(false);
    expect(result.items.filter((item) => item.description === "CONCEBRA GOIANIA" && item.amount === 5.4)).toHaveLength(2);
    expect(result.items.find((item) => item.description.includes("OPENAI"))).toMatchObject({
      transactionType: "INTERNATIONAL_PURCHASE",
      amount: 107.67,
      cardLastDigits: "7414",
    });
    expect(result.items.find((item) => item.description.startsWith("VIVO"))).toMatchObject({
      date: "2024-10-15",
      installment: "21/21",
    });
    expect(result.items.find((item) => item.description.startsWith("AMAZON MARKET"))).toMatchObject({
      date: "2025-09-18",
      installment: "9/10",
    });
    expect(result.items.find((item) => item.description.startsWith("LEROY MERLIN"))).toMatchObject({
      date: "2026-05-27",
      installment: "1/2",
    });
    expect(result.warnings).toEqual([]);
  });
});
