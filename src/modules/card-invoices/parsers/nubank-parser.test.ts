import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseNubankInvoice } from "./nubank-parser";

function line(text: string, page = 1): PdfTextLine {
  return { page, y: 100, text };
}

describe("leitor de fatura Nubank", () => {
  it("lê cartões, NuPay, parcelas e estornos sem importar o pagamento anterior", () => {
    const source: PdfTextLine[] = [
      line("Data de vencimento: 24 AGO 2026"),
      line("FATURA 24 AGO 2026 EMISSÃO E ENVIO 16 AGO 2026"),
      line("Total a pagar R$ 1.014,10", 4),
      line("TRANSAÇÕES", 5),
      line("16 JUL", 5),
      line("•••• 6777 iPhone 17 - Parcela 7/12 R$ 888,00", 5),
      line("01 AGO", 5),
      line("Amazon BR III - NuPay R$ 57,69", 5),
      line("07 AGO", 6),
      line('Estorno de "Shopee *Forallvariedad" −R$ 89,89', 6),
      line("10 AGO", 6),
      line("•••• 8403 Shopee *Laspanehome - Parcela 1/4 R$ 158,30", 6),
      line("Pagamentos e Financiamentos -R$ 15.294,90", 6),
      line("23 JUL", 6),
      line("Pagamento em 23 JUL −R$ 15.294,90", 6),
    ];

    const result = parseNubankInvoice(source);

    expect(result.bank).toBe("NUBANK");
    expect(result.dueDate).toBe("2026-08-24");
    expect(result.invoiceTotal).toBe(1014.1);
    expect(result.items).toHaveLength(4);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(1014.1, 2);
    expect(result.items[0]).toMatchObject({
      date: "2026-07-16",
      description: "iPhone 17",
      installment: "7/12",
      cardLastDigits: "6777",
      transactionType: "INSTALLMENT_PURCHASE",
    });
    expect(result.items[1]).toMatchObject({ description: "Amazon BR III - NuPay", cardLastDigits: undefined });
    expect(result.items[2]).toMatchObject({ amount: -89.89, description: 'Estorno de "Shopee *Forallvariedad"' });
    expect(result.items.some((item) => item.description.startsWith("Pagamento em"))).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("resolve corretamente lançamentos de dezembro em uma fatura fechada em janeiro", () => {
    const result = parseNubankInvoice([
      line("Data de vencimento: 24 JAN 2027"),
      line("FATURA 24 JAN 2027 EMISSÃO E ENVIO 16 JAN 2027"),
      line("Total a pagar R$ 10,00"),
      line("TRANSAÇÕES"),
      line("28 DEZ"),
      line("•••• 1234 Compra teste R$ 10,00"),
    ]);

    expect(result.items[0].date).toBe("2026-12-28");
  });
});
