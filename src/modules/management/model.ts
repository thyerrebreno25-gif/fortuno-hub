import { z } from "zod";

export type OverdueItem = { id: string; description: string; dueAt: string; amount: number; contact: string };
export type FlowSnapshot = { count: number; amount: number; items: OverdueItem[]; complete: boolean; error: string | null };
export type AccountSnapshot = { id: string; name: string; bank: string; balance: number | null; queriedAt: string; error: string | null };
export type ManagementSnapshot = { queriedAt: string; start: string; end: string; payable: FlowSnapshot; receivable: FlowSnapshot; accounts: AccountSnapshot[]; accountsComplete: boolean; accountsError: string | null };
export type AccountCheck = { bankBalance: number | null; balanceAt: string | null; lastImportAt: string | null; pendingPayable: number | null; pendingReceivable: number | null; checkedAt: string; checkedBy: string; note: string };
export const accountCheckInput = z.object({
  accountId: z.string().min(1).max(100), revision: z.number().int().positive(),
  bankBalance: z.number().finite().min(-1e12).max(1e12).nullable(),
  balanceAt: z.string().datetime({ offset: true }).nullable(),
  lastImportAt: z.string().datetime({ offset: true }).nullable(),
  pendingPayable: z.number().int().min(0).max(10000000).nullable(),
  pendingReceivable: z.number().int().min(0).max(10000000).nullable(),
  note: z.string().trim().max(1000).default(""),
}).refine((value) => (value.bankBalance === null) === (value.balanceAt === null), { message: "Informe saldo bancário e data de referência juntos." })
  .refine((value) => [value.balanceAt, value.lastImportAt].every((date) => !date || new Date(date).getTime() <= Date.now() + 60000), { message: "A conferência não pode usar datas futuras." });

export const localDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function finiteMoney(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string" || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function overdueItem(value: unknown, today: string): OverdueItem | null {
  const item = record(value), dueAt = typeof item.data_vencimento === "string" ? item.data_vencimento.slice(0, 10) : "";
  const status = String(item.status_traduzido || item.status || "").toUpperCase();
  const amount = finiteMoney(item.nao_pago);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt) || dueAt >= today || amount === null || amount <= 0 || ["CANCELADO", "CANCELLED", "RENEGOCIADO", "RENEGOTIATED", "PERDIDO", "LOST", "PAID", "RECEIVED", "RECEBIDO", "QUITADO"].includes(status)) return null;
  const contact = record(item.fornecedor || item.cliente);
  return { id: String(item.id || ""), description: String(item.descricao || "Sem descrição"), dueAt, amount: Math.round(amount * 100) / 100, contact: String(contact.nome || contact.razao_social || "") };
}
export function balanceValidation(account: AccountSnapshot, check?: AccountCheck, now = new Date()) {
  if (account.balance === null || !check || check.bankBalance === null || !check.balanceAt) return { status: "UNKNOWN" as const, difference: null };
  const bankAt = new Date(check.balanceAt), caAt = new Date(account.queriedAt);
  if (![bankAt, caAt].every((date) => Number.isFinite(+date)) || localDay(bankAt) !== localDay(caAt) || localDay(bankAt) !== localDay(now) || Math.abs(+caAt - +bankAt) > 15 * 60000) return { status: "STALE" as const, difference: null };
  const difference = Math.round((account.balance - check.bankBalance) * 100) / 100;
  return { status: difference === 0 ? "OK" as const : "DIVERGENT" as const, difference };
}
export function reconciliationStatus(check?: AccountCheck, now = new Date()) {
  if (!check || check.pendingPayable === null || check.pendingReceivable === null) return "UNKNOWN";
  if (localDay(new Date(check.checkedAt)) !== localDay(now)) return "STALE";
  return check.pendingPayable + check.pendingReceivable > 0 ? "PENDING" : "OK";
}
