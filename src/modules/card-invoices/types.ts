export type ParsedInvoiceItem = {
  id: number;
  date: string;
  description: string;
  amount: number;
  installment?: string;
  cardLastDigits?: string;
  transactionType: "PURCHASE" | "INSTALLMENT_PURCHASE" | "INTERNATIONAL_PURCHASE" | "INTERNATIONAL_IOF" | "INVOICE_PAYMENT";
  exportable: boolean;
};

export type ParsedInvoice = {
  bank: string;
  invoiceTotal: number | null;
  dueDate: string | null;
  items: ParsedInvoiceItem[];
  warnings: string[];
};
