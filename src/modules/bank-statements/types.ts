export type StatementTransaction = {
  id: number;
  selected: boolean;
  date: string;
  accountingDate?: string;
  description: string;
  document: string;
  sourceType?: string;
  type: "CREDIT" | "DEBIT";
  amount: number;
  balance: number | null;
  status: "OK" | "REVIEW" | "ERROR" | "CORRECTED";
  warning?: string;
};

export type ParsedStatement = {
  bank: string;
  accountHolder?: string;
  branch?: string;
  account?: string;
  periodStart?: string;
  periodEnd?: string;
  detectedOpeningBalance?: number;
  detectedClosingBalance?: number;
  transactions: StatementTransaction[];
};
