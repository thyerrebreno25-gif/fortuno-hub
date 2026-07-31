import type { BrasilmedEmployeeRow } from "./types";

type BrasilmedPayrollResult = {
  rows: BrasilmedEmployeeRow[];
  expectedTotal: number | null;
  warnings: string[];
  employeeCount: number;
};

export function parseBrasilmedPayroll(
  _rawText: string,
): BrasilmedPayrollResult {
  return {
    rows: [],
    expectedTotal: 0,
    warnings: [
      "O módulo BrasilMed está temporariamente indisponível.",
    ],
    employeeCount: 0,
  };
}