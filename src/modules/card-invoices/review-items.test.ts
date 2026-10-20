import { expect, it } from "vitest";
import { invoiceReviewItems } from "./review-items";
import type { ParsedInvoiceItem } from "./types";

it("mantém o crédito conciliado e continua excluindo pagamentos anteriores", () => {
  const base: ParsedInvoiceItem = { id: 1, date: "2026-05-11", amount: -10, description: "PAGAMENTO DEBITO MINIMO - CREDITO NA FATURA", transactionType: "INVOICE_CREDIT", exportable: true };
  expect(invoiceReviewItems([
    base,
    { ...base, id: 2, description: "PAGAMENTO", transactionType: "INVOICE_PAYMENT", amount: -50 },
    { ...base, id: 3, description: "PAGAMENTO ONLINE", transactionType: "PURCHASE" },
    { ...base, id: 4, exportable: false },
    { ...base, id: 5, amount: 10 },
    { ...base, id: 6, description: "COMPRA", transactionType: "PURCHASE", amount: 110 },
  ]).map((item) => item.id)).toEqual([1, 6]);
});
