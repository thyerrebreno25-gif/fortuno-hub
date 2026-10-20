import type { ParsedInvoiceItem } from "./types";

export function invoiceReviewItems(items: ParsedInvoiceItem[]) {
  return items.filter((item) => {
    if (!item.exportable) return false;
    // Explicitly reconciled carried credit is a deduction, not settlement of the prior bill.
    if (item.transactionType === "INVOICE_CREDIT") return item.amount < 0;
    const description = item.description.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return !/PAGAMENTO\s+ON\s*LINE|PAGAMENTO\s+ONLINE|PAGAMENTO\s+DA\s+FATURA|^PAGAMENTO\b/i.test(description);
  });
}
