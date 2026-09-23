export type AuditSeverity = "CRITICAL" | "WARNING" | "INFO";
export type AuditFinancialFlow = "PAYABLE" | "RECEIVABLE" | "GENERAL";
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
  flow?: AuditFinancialFlow;
  subject?: string | null;
  category?: string | null;
  competence?: string | null;
  amount?: number | null;
  evidence: AuditEvidence[];
};

export type AuditDreRow = {
  category: string;
  values: Record<string, number>;
  level: number;
  sourcePage: number;
  sourceText: string;
};

export type AuditDreAnalysisResult = {
  company: string | null;
  months: string[];
  rows: AuditDreRow[];
  findings: AuditFindingDraft[];
  healthScore: number;
  passedChecks: number;
  totalChecks: number;
  periodStart: string | null;
  periodEnd: string | null;
  metrics: {
    categoryCount: number;
    recurringGroupsChecked: number;
    missingRecurringGroups: number;
    materialVariations: number;
    resultAlerts: number;
  };
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
    sourceTransactionCount: number;
    transactionCount: number;
    entryCount: number;
    exitCount: number;
    entryTotal: number;
    exitTotal: number;
    priorityTransactionCount: number;
    compensatedPairCount: number;
    compensatedTransactionCount: number;
    genericIgnoredTransactionCount: number;
    months: string[];
    dreCategoryCount?: number;
    dreRecurringGroupsChecked?: number;
    dreMissingRecurringGroups?: number;
    dreMaterialVariations?: number;
    dreResultAlerts?: number;
    dreMonths?: string[];
    dreCompany?: string | null;
    sourcesAnalyzed?: Array<"MOVEMENTS" | "DRE">;
  };
};
