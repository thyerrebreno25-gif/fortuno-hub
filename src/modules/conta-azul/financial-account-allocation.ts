import type { ContaAzulOption, FinancialDirection } from "./financial-export";

export type AccountAllocationLine = {
  financialAccountId?: string | null;
  direction: FinancialDirection;
  amount: number;
};

export function invalidAccountAllocationLines<T extends AccountAllocationLine>(lines: T[], accounts: ContaAzulOption[]): T[] {
  const available = new Set(accounts.map((account) => account.value));
  return lines.filter((line) => !line.financialAccountId || !available.has(line.financialAccountId));
}

/** Destino persistido por linha; envios anteriores à funcionalidade usam a conta do lote. */
export function exportLineFinancialAccount(metadata: unknown, batchAccountId: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return batchAccountId;
  const id = (metadata as Record<string, unknown>).financialAccountId;
  return typeof id === "string" && id.trim() ? id : batchAccountId;
}

export function summarizeAccountAllocation(lines: AccountAllocationLine[], accounts: ContaAzulOption[]) {
  const grouped = new Map<string, { accountId: string; accountName: string; count: number; payableAmount: number; receivableAmount: number }>();
  for (const line of lines) {
    const accountId = line.financialAccountId || "";
    const group = grouped.get(accountId) || {
      accountId, accountName: accounts.find((account) => account.value === accountId)?.label || "Conta não localizada",
      count: 0, payableAmount: 0, receivableAmount: 0,
    };
    group.count += 1;
    const key = line.direction === "RECEIVABLE" ? "receivableAmount" : "payableAmount";
    group[key] = Math.round((group[key] + Math.abs(line.amount) + Number.EPSILON) * 100) / 100;
    grouped.set(accountId, group);
  }
  return [...grouped.values()];
}
