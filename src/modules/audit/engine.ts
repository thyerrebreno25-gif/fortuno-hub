import type { AuditAnalysisResult, AuditDreAnalysisResult, AuditMovement } from "./types";
import { filterCompensatingMovements } from "./internal-transfer-filter";
import {
  filterGenericAuditMovements,
  isPriorityAuditMovement,
} from "./movement-classifier";
import {
  duplicateRule,
  monthlyObligationCoverageRule,
  negativeEndingBalanceRule,
} from "./rules";

const weights = { CRITICAL: 12, WARNING: 5, INFO: 1 } as const;

export function analyzeAuditMovements(movements: AuditMovement[]): AuditAnalysisResult {
  const {
    auditableMovements: uncompensatedMovements,
    compensatedMovements,
    compensatedPairs,
  } = filterCompensatingMovements(
    movements,
    (movement) => !isPriorityAuditMovement(movement),
  );
  const {
    auditableMovements,
    ignoredMovements: genericIgnoredMovements,
  } = filterGenericAuditMovements(uncompensatedMovements);
  const priorityMovements = auditableMovements.filter(isPriorityAuditMovement);
  const dates = movements.map((item) => item.date).sort();
  const months = [...new Set(movements.map((item) => item.monthKey))].sort();
  const ruleResults = [
    duplicateRule(priorityMovements),
    monthlyObligationCoverageRule(auditableMovements, months),
    negativeEndingBalanceRule(movements),
  ];
  const findings = ruleResults.flat();
  const unique = new Map(findings.map((finding) => [finding.localId, finding]));
  const result = [...unique.values()];
  const penalty = result.reduce((sum, finding) => sum + weights[finding.severity], 0);
  const healthScore = Math.max(0, Math.min(100, 100 - penalty));
  const totalChecks = ruleResults.length;
  const passedChecks = ruleResults.filter((ruleFindings) => ruleFindings.length === 0).length;
  const entries = auditableMovements.filter((item) => item.amount > 0);
  const exits = auditableMovements.filter((item) => item.amount < 0);

  return {
    movements: auditableMovements,
    findings: result,
    healthScore,
    totalChecks,
    passedChecks,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    metrics: {
      critical: result.filter((item) => item.severity === "CRITICAL").length,
      warnings: result.filter((item) => item.severity === "WARNING").length,
      info: result.filter((item) => item.severity === "INFO").length,
      sourceTransactionCount: movements.length,
      transactionCount: auditableMovements.length,
      entryCount: entries.length,
      exitCount: exits.length,
      entryTotal: entries.reduce((sum, item) => sum + item.amount, 0),
      exitTotal: exits.reduce((sum, item) => sum + Math.abs(item.amount), 0),
      priorityTransactionCount: priorityMovements.length,
      compensatedPairCount: compensatedPairs.length,
      compensatedTransactionCount: compensatedMovements.length,
      genericIgnoredTransactionCount: genericIgnoredMovements.length,
      months,
      sourcesAnalyzed: ["MOVEMENTS"],
    },
  };
}

export function combineAuditAnalyses(
  movements: AuditAnalysisResult,
  dre: AuditDreAnalysisResult | null,
): AuditAnalysisResult {
  if (!dre) return movements;

  const movementMonths = [...movements.metrics.months].sort();
  const dreMonths = [...dre.months].sort();
  const sameCompetences = movementMonths.length === dreMonths.length
    && movementMonths.every((month, index) => month === dreMonths[index]);
  const coverageFinding = sameCompetences ? [] : [{
    localId: `REPORT_PERIOD_MISMATCH_${movementMonths.join("_")}_${dreMonths.join("_")}`,
    ruleCode: "REPORT_PERIOD_MISMATCH",
    title: "Relatórios cobrem competências diferentes",
    description: "O Extrato de Movimentações e a DRE não cobrem exatamente as mesmas competências. Confirme se os arquivos corretos foram enviados antes de concluir a auditoria.",
    severity: "WARNING" as const,
    subject: "Período dos relatórios",
    category: "Base da auditoria",
    competence: [...new Set([...movementMonths, ...dreMonths])].sort().join(", "),
    evidence: [
      { label: "Extrato", value: movementMonths.join(" → ") },
      { label: "DRE", value: dreMonths.join(" → ") },
    ],
  }];
  const findings = [...movements.findings, ...dre.findings, ...coverageFinding];
  const penalty = findings.reduce((sum, finding) => sum + weights[finding.severity], 0);

  return {
    ...movements,
    findings,
    healthScore: Math.max(0, Math.min(100, 100 - penalty)),
    passedChecks: movements.passedChecks + dre.passedChecks + (sameCompetences ? 1 : 0),
    totalChecks: movements.totalChecks + dre.totalChecks + 1,
    periodStart: [movements.periodStart, dre.periodStart].filter(Boolean).sort()[0] ?? null,
    periodEnd: [movements.periodEnd, dre.periodEnd].filter(Boolean).sort().at(-1) ?? null,
    metrics: {
      ...movements.metrics,
      critical: findings.filter((item) => item.severity === "CRITICAL").length,
      warnings: findings.filter((item) => item.severity === "WARNING").length,
      info: findings.filter((item) => item.severity === "INFO").length,
      dreCategoryCount: dre.metrics.categoryCount,
      dreRecurringGroupsChecked: dre.metrics.recurringGroupsChecked,
      dreMissingRecurringGroups: dre.metrics.missingRecurringGroups,
      dreMaterialVariations: dre.metrics.materialVariations,
      dreResultAlerts: dre.metrics.resultAlerts,
      dreMonths: dre.months,
      dreCompany: dre.company,
      sourcesAnalyzed: ["MOVEMENTS", "DRE"],
    },
  };
}
