export interface BrasilmedEmployeeRow {
  name: string;
  section: string;
  role?: string;
  bankCode?: string;
  bankName?: string;
  account?: string;
  cpf?: string;
  pixKey?: string;
  netAmount: number;
  costCenter?: string;
  expenseType?: string;
  category?: string;
  sourceText?: string;
}

export interface BrasilmedParseResult {
  rows: BrasilmedEmployeeRow[];
  employeeCount: number;
  expectedTotal: number;
  parsedTotal: number;
  difference: number;
  warnings: string[];
}
