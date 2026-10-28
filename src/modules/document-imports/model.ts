import { z } from "zod";

export const importKinds = ["INVESTMENT", "CONTRACT"] as const;
export type ImportKind = typeof importKinds[number];
const text = z.string().max(500);
const cents = z.number().int().min(0).max(100_000_000_000);
const date = z.string().max(10).refine((s) => !s || validDate(s), "Data inválida");
export const investmentSchema = z.object({
  kind: z.literal("INVESTMENT"), periodStart: date, periodEnd: date, bankAccount: text,
  customerId: text.default(""), serviceId: text.default(""),
  rows: z.array(z.object({ key: text, description: text, date, amountCents: cents, categoryId: text, accountId: text,
    evidence: z.array(z.object({ page: z.number().int().positive(), text, amountCents: cents })).max(2000),
  })).max(100), warnings: z.array(text).max(50),
});
export const contractSchema = z.object({
  kind: z.literal("CONTRACT"), buyer: text, buyerDocument: text, seller: text, sellerDocument: text,
  description: text, originalDate: date, firstDueDate: date, startMonth: date,
  installments: z.number().int().min(0).max(240), amountCents: cents, totalCents: cents,
  frequency: z.enum(["MONTHLY", "YEARLY"]), interval: z.number().int().min(1).max(120), dueDay: z.number().int().min(0).max(31),
  paymentMethod: z.enum(["BOLETO_BANCARIO", "PIX_PAGAMENTO_INSTANTANEO", "TRANSFERENCIA_BANCARIA", "CARTAO_CREDITO", "OUTRO", ""]),
  categoryId: text, accountId: text, customerId: text, warnings: z.array(text).max(50),
});
export const reviewSchema = z.discriminatedUnion("kind", [investmentSchema, contractSchema]);
export type Review = z.infer<typeof reviewSchema>;
export type InvestmentReview = z.infer<typeof investmentSchema>;
export type ContractReview = z.infer<typeof contractSchema>;
export type Option = { value: string; label: string; document?: string | null; type?: string };
export const digits = (s: string) => s.replace(/\D/g, "");
export const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function brDate(s: string) {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const value = m ? `${m[3]}-${m[2]}-${m[1]}` : "";
  return validDate(value) ? value : "";
}
export const moneyCents = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
export const money = (n: number) => (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const displayDate = (s: string) => validDate(s) ? s.split("-").reverse().join("/") : "—";
export function monthDate(start: string, offset: number, day: number | "last") {
  if (!validDate(start)) return "";
  const [y, m] = start.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day === "last" ? last : Math.min(day, last)));
  return result.toISOString().slice(0, 10);
}
export function schedule(review: ContractReview) {
  if (!validDate(review.startMonth) || review.installments < 1 || review.dueDay < 1) return [];
  const step = review.interval * (review.frequency === "YEARLY" ? 12 : 1);
  return Array.from({ length: review.installments }, (_, i) => ({ number: i + 1, saleDate: monthDate(review.startMonth, i * step, 1), dueDate: monthDate(review.startMonth, i * step, review.dueDay), amountCents: review.amountCents }));
}
export function reviewIssues(review: Review, requireLinks = false): string[] {
  const errors: string[] = [];
  if (review.kind === "INVESTMENT") {
    if (requireLinks && (!review.customerId || !review.serviceId)) errors.push("Selecione o cliente e o serviço cadastrados no CA para as vendas de rendimento.");
    if (!review.rows.length) errors.push("Nenhuma linha de rendimento foi identificada. O PDF precisa conter texto selecionável.");
    if (!validDate(review.periodStart) || !validDate(review.periodEnd)) errors.push("Confira o período do extrato.");
    if (review.periodStart > review.periodEnd) errors.push("O início do período deve anteceder o término.");
    for (const row of review.rows) {
      if (!row.description.trim() || row.amountCents <= 0 || !validDate(row.date)) errors.push(`Confira descrição, valor e data de ${row.description || "rendimento"}.`);
      if (validDate(row.date) && (row.date < review.periodStart || row.date > review.periodEnd)) errors.push(`A data de ${row.description} está fora do período do extrato.`);
      if (requireLinks && (!row.categoryId || !row.accountId)) errors.push(`Selecione categoria e conta para ${row.description}.`);
    }
  } else {
    if (!review.buyer.trim() || digits(review.buyerDocument).length !== 14 && digits(review.buyerDocument).length !== 11) errors.push("Confira o cliente comprador e seu CPF/CNPJ.");
    if (!review.description.trim()) errors.push("Preencha a descrição do serviço.");
    if (review.amountCents <= 0 || review.installments < 1) errors.push("Informe o valor por venda e a quantidade de cobranças.");
    if (review.amountCents * review.installments !== review.totalCents) errors.push("O valor das cobranças não confere com o total do contrato.");
    if (!validDate(review.startMonth) || review.startMonth.slice(-2) !== "01") errors.push("O início das vendas deve ser no dia 01.");
    if (!validDate(review.firstDueDate) || review.dueDay < 1) errors.push("Confira a primeira data de vencimento e o dia de vencimento.");
    const dates = schedule(review);
    if (dates[0] && dates[0].dueDate !== review.firstDueDate) errors.push("O primeiro vencimento deve coincidir com o mês inicial e o dia escolhido.");
    if (!review.paymentMethod) errors.push("Selecione a forma de pagamento.");
    if (requireLinks && (!review.categoryId || !review.accountId || !review.customerId)) errors.push("Selecione categoria, conta financeira e comprador no CA.");
  }
  return [...new Set(errors)];
}
