import type { AuditAnalysisResult, AuditMovement } from "./types";
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
    },
  };
}
