import type {
  AuditDreAnalysisResult,
  AuditDreRow,
  AuditFindingDraft,
  AuditSeverity,
} from "./types";
import type { ParsedContaAzulDre } from "./parsers/conta-azul-dre-parser";

const weights = { CRITICAL: 12, WARNING: 5, INFO: 1 } as const;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function percent(value: number) {
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

type RecurringDefinition = {
  code: string;
  label: string;
  pattern: RegExp;
  severity: AuditSeverity;
};

const RECURRING: RecurringDefinition[] = [
  { code: "WATER", label: "Água e saneamento", pattern: /\bAGUA\b|SANEAMENTO/, severity: "WARNING" },
  { code: "ENERGY", label: "Energia elétrica", pattern: /ENERGIA|ELETRIC/, severity: "WARNING" },
  { code: "INTERNET", label: "Internet e telefonia", pattern: /INTERNET|TELEFONIA/, severity: "WARNING" },
  { code: "RENT", label: "Aluguel", pattern: /\bALUGUEL\b|LOCACAO/, severity: "WARNING" },
  { code: "TAXES", label: "Impostos e encargos", pattern: /SIMPLES NACIONAL|\bDAS\b|FGTS|INSS|IRRF|DARF|IMPOSTOS RETIDOS/, severity: "CRITICAL" },
  { code: "PAYROLL", label: "Salários", pattern: /^SALARIOS$|FOLHA DE PAGAMENTO/, severity: "CRITICAL" },
  { code: "PRO_LABORE", label: "Pró-labore", pattern: /^PRO LABORE$/, severity: "WARNING" },
  { code: "ACCOUNTING", label: "Honorários recorrentes", pattern: /HONORARIOS|CONTABILIDADE/, severity: "WARNING" },
];

function rowValue(row: AuditDreRow, month: string) {
  return Math.abs(row.values[month] ?? 0);
}

function recurringFindings(rows: AuditDreRow[], months: string[]) {
  const findings: AuditFindingDraft[] = [];
  let checked = 0;
  let missing = 0;
  let variations = 0;

  for (const definition of RECURRING) {
    const matched = rows.filter((row) => row.level === 2 && definition.pattern.test(normalize(row.category)));
    if (!matched.length) continue;
    checked += 1;
    const totals = new Map(months.map((month) => [
      month,
      matched.reduce((sum, row) => sum + rowValue(row, month), 0),
    ]));
    const missingMonths = months.filter((month) => (totals.get(month) ?? 0) === 0);

    if (missingMonths.length) {
      missing += 1;
      findings.push({
        localId: `DRE_MISSING_${definition.code}_${missingMonths.join("_")}`,
        ruleCode: `DRE_MISSING_${definition.code}`,
        title: `${definition.label} sem movimento em parte do período`,
        description: `${definition.label} aparece na DRE, mas não foi identificado em ${missingMonths.join(", ")}. O líder deve confirmar se houve ausência, erro de competência ou classificação.`,
        severity: definition.severity,
        subject: definition.label,
        category: definition.label,
        competence: missingMonths.join(", "),
        evidence: months.map((month) => ({ label: month, value: (totals.get(month) ?? 0) ? money(totals.get(month) ?? 0) : "Não identificado" })),
      });
      continue;
    }

    const previous = totals.get(months[months.length - 2]) ?? 0;
    const current = totals.get(months[months.length - 1]) ?? 0;
    const variation = previous ? (current - previous) / previous : 0;
    if (Math.abs(variation) >= 0.3 && Math.abs(current - previous) >= 100) {
      variations += 1;
      findings.push({
        localId: `DRE_VARIATION_${definition.code}_${months.at(-1)}`,
        ruleCode: `DRE_VARIATION_${definition.code}`,
        title: `Variação relevante em ${definition.label.toLowerCase()}`,
        description: `${definition.label} variou ${percent(variation)} entre as duas últimas competências. Revise valor, competência e eventual duplicidade.`,
        severity: "WARNING",
        subject: definition.label,
        category: definition.label,
        competence: months.at(-1),
        amount: current,
        evidence: [
          { label: months[months.length - 2], value: money(previous) },
          { label: months[months.length - 1], value: money(current) },
          { label: "Variação", value: percent(variation) },
        ],
      });
    }
  }

  return { findings, checked, missing, variations };
}

function findRow(rows: AuditDreRow[], pattern: RegExp) {
  return rows.find((row) => pattern.test(normalize(row.category)));
}

function performanceFindings(rows: AuditDreRow[], months: string[]) {
  const findings: AuditFindingDraft[] = [];
  const previousMonth = months[months.length - 2];
  const currentMonth = months[months.length - 1];
  const definitions = [
    { code: "REVENUE", label: "Receita bruta", pattern: /RECEITA BRUTA DE VENDAS/, severity: "WARNING" as AuditSeverity },
    { code: "OPERATING_RESULT", label: "Resultado operacional", pattern: /LUCRO PREJUIZO OPERACIONAL/, severity: "CRITICAL" as AuditSeverity },
    { code: "FINAL_RESULT", label: "Resultado final", pattern: /LUCRO PREJUIZO FINAL/, severity: "CRITICAL" as AuditSeverity },
  ];

  for (const definition of definitions) {
    const row = findRow(rows, definition.pattern);
    if (!row) continue;
    const previous = row.values[previousMonth] ?? 0;
    const current = row.values[currentMonth] ?? 0;
    const variation = previous ? (current - previous) / Math.abs(previous) : 0;
    const changedToLoss = previous > 0 && current < 0;
    const materialDrop = variation <= -0.25 && Math.abs(current - previous) >= 1_000;
    if (!changedToLoss && !materialDrop) continue;

    findings.push({
      localId: `DRE_${definition.code}_${currentMonth}`,
      ruleCode: `DRE_${definition.code}`,
      title: changedToLoss ? `${definition.label} passou para prejuízo` : `Queda relevante em ${definition.label.toLowerCase()}`,
      description: changedToLoss
        ? `${definition.label} passou de ${money(previous)} para ${money(current)}. A mudança de sinal exige validação do líder.`
        : `${definition.label} caiu ${percent(Math.abs(variation))} entre as duas últimas competências.`,
      severity: definition.severity,
      subject: definition.label,
      category: "DRE Gerencial",
      competence: currentMonth,
      amount: current,
      evidence: [
        { label: previousMonth, value: money(previous) },
        { label: currentMonth, value: money(current) },
      ],
    });
  }

  return findings;
}

export function analyzeContaAzulDre(parsed: ParsedContaAzulDre): AuditDreAnalysisResult {
  const recurring = recurringFindings(parsed.rows, parsed.months);
  const performance = performanceFindings(parsed.rows, parsed.months);
  const findings = [...recurring.findings, ...performance];
  const totalChecks = RECURRING.length + 3;
  const failedChecks = recurring.missing + recurring.variations + performance.length;
  const penalty = findings.reduce((sum, finding) => sum + weights[finding.severity], 0);

  return {
    company: parsed.company,
    months: parsed.months,
    rows: parsed.rows,
    findings,
    healthScore: Math.max(0, 100 - penalty),
    passedChecks: Math.max(0, totalChecks - failedChecks),
    totalChecks,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    metrics: {
      categoryCount: parsed.rows.length,
      recurringGroupsChecked: recurring.checked,
      missingRecurringGroups: recurring.missing,
      materialVariations: recurring.variations,
      resultAlerts: performance.length,
    },
  };
}
