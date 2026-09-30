export type SalesSpreadsheetEntry = {
  id: string;
  sourceRow: number;
  eventDate: string | null;
  customer: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  seller: string;
  product: string;
  documentNumber: string;
  destinationLabel: string;
  reconciledMarker: string;
  receiptName: string;
};

export type SalesWorkbookPreview = {
  fileName: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  missingPaymentDate: number;
  invalidAmount: number;
  dateRange: { start: string; end: string } | null;
  destinations: string[];
  productsByDestination: Record<string, string[]>;
  entries: SalesSpreadsheetEntry[];
};

export type ContaAzulReceivable = {
  id: string;
  description: string;
  counterparty: string;
  categoryNames: string[];
  competenceDate: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  amount: number;
  status: string;
};

export type SalesDestinationRule = {
  sourceLabel: string;
  clientId: string;
  expectedCategoryName?: string | null;
  productCategories?: Record<string, string>;
};

export type SalesReconciliationStatus =
  | "OK"
  | "WRONG_CATEGORY"
  | "NOT_FOUND"
  | "NEARBY_DATE"
  | "AMBIGUOUS"
  | "UNMAPPED_DESTINATION"
  | "NEGATIVE_REVIEW";

export type SalesReconciliationRow = SalesSpreadsheetEntry & {
  status: SalesReconciliationStatus;
  statusDetail: string;
  expectedCategory: string | null;
  matchedDateField: "PAYMENT" | "COMPETENCE" | "DUE" | null;
  contaAzul: ContaAzulReceivable | null;
};

export type SalesReconciliationResult = {
  rows: SalesReconciliationRow[];
  extraContaAzul: Array<ContaAzulReceivable & { clientId: string; clientName: string }>;
  summary: {
    spreadsheetRows: number;
    ok: number;
    wrongCategory: number;
    notFound: number;
    nearbyDate: number;
    ambiguous: number;
    unmapped: number;
    negativeReview: number;
    extraContaAzul: number;
    spreadsheetAmount: number;
    matchedAmount: number;
  };
};
