import { describe, expect, it } from "vitest";
import { analyzeFinancialHistory, type ContaAzulAuditEntry } from "./financial-history-engine";

function entry(overrides: Partial<ContaAzulAuditEntry> = {}): ContaAzulAuditEntry {
  return {
    id: "entry",
    flow: "PAYABLE",
    description: "Conta de energia",
    counterparty: "NEOENERGIA",
    categories: ["Energia elétrica"],
    costCenters: [],
    dueDate: "2026-01-10",
    competenceDate: "2025-12-01",
    status: "PAGO",
    total: 500,
    paid: 500,
    outstanding: 0,
    ...overrides,
  };
}

function analyze(history: ContaAzulAuditEntry[], current: ContaAzulAuditEntry[]) {
  return analyzeFinancialHistory({
    history,
    current,
    historyStart: "2026-01-01",
    historyEnd: "2026-03-31",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    today: "2026-04-20",
  });
}

describe("analyzeFinancialHistory", () => {
  it("aprende uma obrigação mensal e aponta a ausência no período atual", () => {
    const result = analyze([
      entry({ id: "jan", dueDate: "2026-01-10" }),
      entry({ id: "fev", dueDate: "2026-02-10", competenceDate: "2026-01-01" }),
      entry({ id: "mar", dueDate: "2026-03-10", competenceDate: "2026-02-01" }),
    ], []);

    expect(result.profiles).toHaveLength(1);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "CA_MISSING_RECURRING", flow: "PAYABLE", severity: "WARNING" }),
    ]));
  });

  it("não transforma PIX, transferência ou tarifa em recorrência", () => {
    const history = ["01", "02", "03"].flatMap((month, index) => [
      entry({ id: `pix-${month}`, description: "PAGAMENTO PIX", counterparty: null, categories: [], dueDate: `2026-${month}-10`, competenceDate: `2026-${month}-01`, total: 100 + index }),
      entry({ id: `fee-${month}`, description: "TARIFA BANCARIA", counterparty: "BANCO", categories: ["Tarifas"], dueDate: `2026-${month}-11`, competenceDate: `2026-${month}-01`, total: 20 }),
    ]);

    const result = analyze(history, []);
    expect(result.profiles).toHaveLength(0);
    expect(result.findings.some((finding) => finding.ruleCode === "CA_MISSING_RECURRING")).toBe(false);
  });

  it("aprende competência do mês anterior e aponta lançamento no mês errado", () => {
    const result = analyze([
      entry({ id: "jan", dueDate: "2026-01-10" }),
      entry({ id: "fev", dueDate: "2026-02-10", competenceDate: "2026-01-01" }),
      entry({ id: "mar", dueDate: "2026-03-10", competenceDate: "2026-02-01" }),
    ], [
      entry({ id: "apr", dueDate: "2026-04-10", competenceDate: "2026-04-01" }),
    ]);

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "CA_COMPETENCE_DIVERGENCE", competence: "2026-04-01" }),
    ]));
  });

  it("separa alertas vencidos e abertos entre pagar e receber", () => {
    const result = analyze([], [
      entry({ id: "payable-overdue", dueDate: "2026-04-10", status: "ATRASADO", paid: 0, outstanding: 500 }),
      entry({ id: "receivable-open", flow: "RECEIVABLE", description: "Mensalidade", counterparty: "CLIENTE A", categories: ["Receita de serviços"], dueDate: "2026-04-25", competenceDate: "2026-04-01", status: "EM_ABERTO", paid: 0, outstanding: 800 }),
    ]);

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "CA_OVERDUE", flow: "PAYABLE" }),
      expect.objectContaining({ ruleCode: "CA_OPEN", flow: "RECEIVABLE" }),
    ]));
    expect(result.metrics.payableFindings).toBe(1);
    expect(result.metrics.receivableFindings).toBe(1);
  });

  it("aprende também a quantidade mensal esperada", () => {
    const history = ["01", "02", "03"].flatMap((month) => [
      entry({ id: `${month}-a`, dueDate: `2026-${month}-10`, description: "Energia unidade A" }),
      entry({ id: `${month}-b`, dueDate: `2026-${month}-15`, description: "Energia unidade B" }),
    ]);
    const result = analyze(history, [
      entry({ id: "apr-a", dueDate: "2026-04-10", competenceDate: "2026-03-01" }),
    ]);

    const missing = result.findings.find((finding) => finding.ruleCode === "CA_MISSING_RECURRING");
    expect(result.profiles[0].expectedMonthlyCount).toBe(2);
    expect(missing?.description).toContain("apenas 1");
  });
});
