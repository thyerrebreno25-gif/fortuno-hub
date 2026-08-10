import type { AuditAnalysisResult, AuditMovement } from "./types";
import { auditRules } from "./rules";

const weights = { CRITICAL: 12, WARNING: 5, INFO: 1 } as const;

export function analyzeAuditMovements(movements: AuditMovement[]): AuditAnalysisResult {
  const findings = auditRules.flatMap((rule) => rule(movements));
  const unique = new Map(findings.map((finding) => [finding.localId, finding]));
  const result = [...unique.values()];
  const penalty = result.reduce((sum, finding) => sum + weights[finding.severity], 0);
  const healthScore = Math.max(0, Math.min(100, 100 - penalty));
  const dates = movements.map((item) => item.date).sort();
  const months = [...new Set(movements.map((item) => item.monthKey))].sort();
  const totalChecks = auditRules.length;
  const rulesWithFinding = new Set(result.map((item) => item.ruleCode)).size;
  return {
    movements,
    findings: result,
    healthScore,
    totalChecks,
    passedChecks: Math.max(0, totalChecks - rulesWithFinding),
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    metrics: {
      critical: result.filter((item) => item.severity === "CRITICAL").length,
      warnings: result.filter((item) => item.severity === "WARNING").length,
      info: result.filter((item) => item.severity === "INFO").length,
      transactionCount: movements.length,
      months,
    },
  };
}
