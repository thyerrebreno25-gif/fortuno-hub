import { moneyCents, type InvestmentReview } from "./model";

export type AccountClosingBalance = { accountId: string; date: string; balanceCents: number | null; method: "CURRENT" | "RECONSTRUCTED" | "UNAVAILABLE"; checkedAt: string; reason?: string };
export type BalanceComparison = { accountId: string; incomeCents: number; statementCents: number | null; caCents: number | null; projectedCents: number | null; differenceCents: number | null; status: "OK" | "DIVERGENT" | "ALREADY_MATCHES" | "UNAVAILABLE"; source: AccountClosingBalance | null };

export function statementClosingCents(row: InvestmentReview["rows"][number]): number | null {
  if (!row.evidence.length) return null;
  let total = 0;
  for (const item of row.evidence) {
    // Existing saved reviews retain the full source line, so they need no reimport.
    const match = item.text.match(/Rendimento\s+at[eé]\s+esta\s+data\s+R\$\s*[\d.]+,\d{2}\s+\S+\s+R\$\s*([\d.]+,\d{2})/i);
    if (!match) return null;
    total += moneyCents(match[1]);
  }
  return total;
}
export function compareBalances(review: InvestmentReview, balances: AccountClosingBalance[]): BalanceComparison[] {
  const groups = new Map<string, BalanceComparison>();
  for (const row of review.rows) {
    if (!row.accountId) continue;
    const group = groups.get(row.accountId) || { accountId: row.accountId, incomeCents: 0, statementCents: 0, caCents: null, projectedCents: null, differenceCents: null, status: "UNAVAILABLE", source: null };
    const closing = row.date === review.periodEnd ? statementClosingCents(row) : null;
    group.incomeCents += row.amountCents;
    group.statementCents = group.statementCents === null || closing === null ? null : group.statementCents + closing;
    groups.set(row.accountId, group);
  }
  return [...groups.values()].map((group) => {
    const source = balances.find((item) => item.accountId === group.accountId && item.date === review.periodEnd) || null;
    const caCents = source?.balanceCents ?? null;
    if (caCents === null || group.statementCents === null || source?.method === "UNAVAILABLE") return { ...group, caCents, source };
    const projectedCents = caCents + group.incomeCents;
    const differenceCents = projectedCents - group.statementCents;
    return { ...group, caCents, projectedCents, differenceCents, source,
      status: differenceCents === 0 ? "OK" : caCents === group.statementCents ? "ALREADY_MATCHES" : "DIVERGENT" };
  });
}
