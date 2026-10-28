import { apiItems, normalizeContaAzulLabel } from "./financial-export";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const cents = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
export type ExpectedFinancialLine = { direction: string; description: string; amount: number; competenceDate: string; dueDate: string; categoryId?: string | null; financialAccountId: string };
export function confirmFinancialInstallment(value: unknown, expected: ExpectedFinancialLine) {
  const item = object(value), event = object(item.evento);
  const id = typeof item.id === "string" ? item.id : null;
  const amount = item.valor_liquido ?? item.valor_total_liquido ?? object(item.valor_composicao).valor_liquido ?? object(item.composicao_valor).valor_liquido;
  const accountId = item.id_conta_financeira || (typeof item.conta_financeira === "string" ? item.conta_financeira : object(item.conta_financeira).id);
  if (!id || ["CANCELADO", "RENEGOCIADO", "PERDIDO"].includes(String(item.status)) || cents(amount) !== Math.round(expected.amount * 100) || String(item.data_vencimento).slice(0, 10) !== expected.dueDate || String(event.data_competencia).slice(0, 10) !== expected.competenceDate || accountId !== expected.financialAccountId || event.tipo !== (expected.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA") || normalizeContaAzulLabel(String(item.descricao || "")) !== normalizeContaAzulLabel(expected.description)) throw new Error("A parcela no CA não confere com o valor, data, descrição ou conta do envio. Confira o histórico antes de continuar.");
  const allocations = apiItems(event.rateio);
  if (expected.categoryId && (allocations.length !== 1 || allocations[0].id_categoria !== expected.categoryId || cents(allocations[0].valor ?? allocations[0].valor_bruto) !== Math.round(expected.amount * 100))) throw new Error("A categoria da parcela no CA diverge do envio aprovado.");
  return { id, eventId: typeof event.id === "string" ? event.id : null };
}
export function confirmFinancialSettlement(value: unknown, expected: { amount: number; accountId: string; date: string }) {
  if (!Array.isArray(value) && !Array.isArray(object(value).itens)) throw new Error("Não foi possível confirmar as baixas no CA.");
  const rows = apiItems(value);
  if (!rows.length) return null;
  if (rows.length !== 1) throw new Error("A parcela possui múltiplas baixas. Confira no CA antes de continuar.");
  const item = rows[0];
  const account = typeof item.conta_financeira === "string" ? item.conta_financeira : object(item.conta_financeira).id;
  if (account !== expected.accountId || String(item.data_pagamento).slice(0, 10) !== expected.date || cents(object(item.valor_composicao ?? item.composicao_valor).valor_liquido) !== Math.round(expected.amount * 100) || typeof item.id !== "string") throw new Error("A baixa encontrada no CA tem valor, data ou conta diferente. Nenhuma nova baixa será feita.");
  return item.id;
}
