export type AuditSeverity = "CRITICAL" | "WARNING" | "INFO";
export type AuditFindingStatus =
  | "IDENTIFIED"
  | "DISMISSED"
  | "SENT"
  | "IN_PROGRESS"
  | "PENDING_VALIDATION"
  | "VALIDATED"
  | "RETURNED";

export type AuditMovement = {
  id: string;
  date: string;
  description: string;
  counterparty: string | null;
  category: string | null;
  situation: string | null;
  amount: number;
  balance: number | null;
  monthKey: string;
  sourcePage: number;
  sourceText: string;
};

export type AuditEvidence = {
  label: string;
  value: string;
};

export type AuditFindingDraft = {
  localId: string;
  ruleCode: string;
  title: string;
  description: string;
  severity: AuditSeverity;
  subject?: string | null;
  category?: string | null;
  competence?: string | null;
  amount?: number | null;
  evidence: AuditEvidence[];
};

export type AuditAnalysisResult = {
  movements: AuditMovement[];
  findings: AuditFindingDraft[];
  healthScore: number;
  passedChecks: number;
  totalChecks: number;
  periodStart: string | null;
  periodEnd: string | null;
  metrics: {
    critical: number;
    warnings: number;
    info: number;
    transactionCount: number;
    months: string[];
  };
};
