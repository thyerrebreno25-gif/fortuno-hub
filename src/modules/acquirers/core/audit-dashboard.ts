export type AuditDashboardLine = {
  id: number;
  eventType: "SALE" | "FEE" | "ADJUSTMENT" | "CANCELLATION" | "CHARGEBACK" | "ANTICIPATION";
  amount: number;
  cardBrand?: string;
  transactionType?: "DEBIT" | "CREDIT" | "PIX" | "VOUCHER" | "OTHER";
  installments?: number;
  chargedRate?: number;
  contractedRate?: number;
  rateValidation?: "MATCH" | "DIVERGENT" | "NOT_CONFIGURED" | "NOT_APPLICABLE";
  description: string;
};

export function transactionGroup(line: AuditDashboardLine): string {
  if (line.transactionType === "CREDIT") {
    return (line.installments ?? 1) > 1 ? "Crédito parcelado" : "Crédito à vista";
  }
  return {
    DEBIT: "Débito",
    PIX: "PIX",
    VOUCHER: "Voucher",
    OTHER: "Outro",
  }[line.transactionType ?? "OTHER"];
}

export function financialImpact(line: AuditDashboardLine): number | null {
  if (
    line.eventType !== "SALE" ||
    line.chargedRate == null ||
    line.contractedRate == null
  ) return null;

  return line.amount * (line.chargedRate - line.contractedRate) / 100;
}

export function buildAuditDashboard(lines: AuditDashboardLine[]) {
  const sales = lines.filter((line) => line.eventType === "SALE");
  const gross = sales.reduce((sum, line) => sum + line.amount, 0);
  const fees = lines
    .filter((line) => line.eventType === "FEE" || line.eventType === "ANTICIPATION")
    .reduce((sum, line) => sum + Math.abs(line.amount), 0);

  const byBrand = new Map<string, { count: number; gross: number }>();
  const byModality = new Map<string, { count: number; gross: number }>();

  for (const sale of sales) {
    const brand = sale.cardBrand || (sale.transactionType === "PIX" ? "PIX" : "Não identificada");
    const modality = transactionGroup(sale);
    const brandItem = byBrand.get(brand) ?? { count: 0, gross: 0 };
    brandItem.count += 1;
    brandItem.gross += sale.amount;
    byBrand.set(brand, brandItem);

    const modalityItem = byModality.get(modality) ?? { count: 0, gross: 0 };
    modalityItem.count += 1;
    modalityItem.gross += sale.amount;
    byModality.set(modality, modalityItem);
  }

  const divergences = sales
    .filter((line) => line.rateValidation === "DIVERGENT")
    .map((line) => ({ ...line, impact: financialImpact(line) ?? 0 }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  const pendingRules = Array.from(new Map(
    sales
      .filter((line) => line.rateValidation === "NOT_CONFIGURED")
      .map((line) => {
        const key = [line.transactionType, transactionGroup(line), line.cardBrand || "Todas"].join("|");
        return [key, {
          key,
          modality: transactionGroup(line),
          brand: line.cardBrand || (line.transactionType === "PIX" ? "PIX" : "Todas"),
        }] as const;
      }),
  ).values());

  const overpaid = sales.reduce((sum, line) => Math.max(financialImpact(line) ?? 0, 0) + sum, 0);
  const underpaid = sales.reduce((sum, line) => Math.min(financialImpact(line) ?? 0, 0) + sum, 0);

  return {
    gross,
    fees,
    averageRate: gross ? fees / gross * 100 : 0,
    salesCount: sales.length,
    matched: sales.filter((line) => line.rateValidation === "MATCH").length,
    divergent: divergences.length,
    notConfigured: sales.filter((line) => line.rateValidation === "NOT_CONFIGURED").length,
    overpaid,
    underpaid: Math.abs(underpaid),
    netImpact: overpaid + underpaid,
    byBrand: Array.from(byBrand, ([label, value]) => ({ label, ...value })).sort((a, b) => b.gross - a.gross),
    byModality: Array.from(byModality, ([label, value]) => ({ label, ...value })).sort((a, b) => b.gross - a.gross),
    divergences,
    pendingRules,
  };
}
