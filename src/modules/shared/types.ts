export type Money = number;

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: Money;
  type: "CREDIT" | "DEBIT";
  document?: string;
  sourcePage?: number;
  sourceText?: string;
  metadata?: Record<string, unknown>;
}

export interface ParserDiagnostic {
  parserId: string;
  parserVersion: string;
  confidence: number;
  linesFound: number;
  linesIgnored: number;
  warnings: string[];
}

export interface ParserResult<T> {
  rows: T[];
  expectedTotal?: number;
  parsedTotal: number;
  difference?: number;
  diagnostic: ParserDiagnostic;
}
