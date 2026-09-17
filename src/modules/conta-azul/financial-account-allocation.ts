import type { ContaAzulOption, FinancialDirection } from "./financial-export";

export type AccountAllocationLine = {
  destinationClientId?: string | null;
  destinationClientName?: string | null;
  financialAccountId?: string | null;
  direction: FinancialDirection;
  amount: number;
};

export type DestinationCatalog = {
  clientName: string;
  financialAccounts: ContaAzulOption[];
  categories?: ContaAzulOption[];
  costCenters?: ContaAzulOption[];
};

export function allocationClientId(line: Pick<AccountAllocationLine, "destinationClientId">, sourceClientId: string): string {
  return line.destinationClientId || sourceClientId;
}

export function changeAllocationDestination<T extends { financialAccountId?: string | null; financialAccountName?: string | null }>(line: T, destination: { value: string; label: string }) {
  return { ...line, destinationClientId: destination.value, destinationClientName: destination.label, financialAccountId: null, financialAccountName: null };
}

export function fillPendingAllocationAccounts<T extends { destinationClientId?: string | null; financialAccountId?: string | null }>(lines: T[], sourceClientId: string, destinationClientId: string, account: ContaAzulOption): T[] {
  return lines.map((line) => line.financialAccountId || allocationClientId(line, sourceClientId) !== destinationClientId
    ? line : { ...line, financialAccountId: account.value, financialAccountName: account.label });
}

export function allocationCategoryKey(clientId: string, direction: FinancialDirection, categoryName: string): string {
  return JSON.stringify([clientId, direction, categoryName]);
}

export function allocationCostCenterKey(clientId: string, costCenterName?: string | null): string {
  return JSON.stringify([clientId, costCenterName]);
}

export function applyAllocationClassifications<T extends { destinationClientId?: string | null; categoryName: string; costCenterName?: string | null; direction: FinancialDirection }>(
  lines: T[], catalogs: Record<string, DestinationCatalog>, sourceClientId: string, useLineAccounts: boolean,
  categoryOverrides: Record<string, string>, costCenterOverrides: Record<string, string>,
): T[] {
  return lines.map((line) => {
    const targetId = useLineAccounts ? allocationClientId(line, sourceClientId) : sourceClientId;
    const catalog = catalogs[targetId];
    const categoryId = categoryOverrides[allocationCategoryKey(targetId, line.direction, line.categoryName)];
    const category = catalog?.categories?.find((option) => option.value === categoryId && (!option.type || option.type === (line.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA")));
    const centerId = costCenterOverrides[allocationCostCenterKey(targetId, line.costCenterName)];
    const center = catalog?.costCenters?.find((option) => option.value === centerId);
    return { ...line, ...(category ? { categoryName: category.label } : {}), ...(center ? { costCenterName: center.label } : {}) };
  });
}

/** Metadados antigos pertencem ao cliente de origem, nunca ao destino solicitado na retomada. */
export function exportLineDestinationClient(metadata: unknown, sourceClientId: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return sourceClientId;
  const id = (metadata as Record<string, unknown>).destinationClientId;
  return typeof id === "string" && id.trim() ? id : sourceClientId;
}

export function invalidDestinationAllocationLines<T extends AccountAllocationLine>(lines: T[], catalogs: Record<string, DestinationCatalog>, sourceClientId: string): T[] {
  return lines.filter((line) => {
    const catalog = catalogs[allocationClientId(line, sourceClientId)];
    return !catalog || invalidAccountAllocationLines([line], catalog.financialAccounts).length > 0;
  });
}

export function summarizeDestinationAllocation(lines: AccountAllocationLine[], catalogs: Record<string, DestinationCatalog>, sourceClientId: string) {
  const clients = [...new Set(lines.map((line) => allocationClientId(line, sourceClientId)))];
  return clients.flatMap((clientId) => summarizeAccountAllocation(
    lines.filter((line) => allocationClientId(line, sourceClientId) === clientId), catalogs[clientId]?.financialAccounts || [],
  ).map((group) => ({ ...group, clientId, clientName: catalogs[clientId]?.clientName || "Cadastro não localizado" })));
}

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
