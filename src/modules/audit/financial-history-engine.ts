import type {
  AuditFindingDraft,
  AuditFinancialFlow,
  AuditSeverity,
} from "./types";

export type ContaAzulAuditEntry = {
  id: string;
  flow: Exclude<AuditFinancialFlow, "GENERAL">;
  description: string;
  counterparty: string | null;
  categories: string[];
  costCenters: string[];
  dueDate: string;
  competenceDate: string | null;
  status: string;
  total: number;
  paid: number;
  outstanding: number;
};

export type RecurringFinancialProfile = {
  key: string;
  flow: Exclude<AuditFinancialFlow, "GENERAL">;
  label: string;
  category: string | null;
  semanticCode: string | null;
  observedMonths: string[];
  expectedMonthlyCount: number;
  expectedCompetenceOffset: number | null;
  competenceConfidence: number;
  recurrenceConfidence: number;
};

export type FinancialHistoryAnalysis = {
  findings: Array<AuditFindingDraft & { flow: Exclude<AuditFinancialFlow, "GENERAL"> }>;
  profiles: RecurringFinancialProfile[];
  totalChecks: number;
  passedChecks: number;
  healthScore: number;
  metrics: {
    historyItems: number;
    currentItems: number;
    recurringProfiles: number;
    missingRecurring: number;
    overdue: number;
    open: number;
    competenceDivergences: number;
    categoryDivergences: number;
    duplicates: number;
    payableFindings: number;
    receivableFindings: number;
  };
};

type SemanticDefinition = {
  code: string;
  label: string;
  pattern: RegExp;
  critical?: boolean;
};

const SEMANTIC_DEFINITIONS: SemanticDefinition[] = [
  { code: "TAX_SIMPLES", label: "Simples Nacional / DAS", pattern: /\bSIMPLES\b|\bDAS\b/, critical: true },
  { code: "TAX_FGTS", label: "FGTS", pattern: /\bFGTS\b/, critical: true },
  { code: "TAX_INSS", label: "INSS / GPS", pattern: /\bINSS\b|\bGPS\b/, critical: true },
  { code: "TAX_DARF", label: "DARF e tributos federais", pattern: /\bDARF\b|\bIRPJ\b|\bCSLL\b|\bCOFINS\b|\bPIS\b|\bIRRF\b/, critical: true },
  { code: "TAX_STATE", label: "Tributos estaduais", pattern: /\bICMS\b|\bDARE\b/, critical: true },
  { code: "TAX_CITY", label: "Tributos municipais", pattern: /\bISS\b|\bDAM\b/, critical: true },
  { code: "PAYROLL", label: "Salários e folha de pagamento", pattern: /SALARI|FOLHA DE PAGAMENTO|ORDENADOS/, critical: true },
  { code: "PRO_LABORE", label: "Pró-labore", pattern: /PRO LABORE/ },
  { code: "VACATION", label: "Férias e décimo terceiro", pattern: /\bFERIAS\b|DECIMO TERCEIRO|13 SALARIO/ },
  { code: "ENERGY", label: "Energia elétrica", pattern: /ENERGIA|ELETRIC|NEOENERGIA|EQUATORIAL|ENEL|CEMIG|COPEL/ },
  { code: "WATER", label: "Água e saneamento", pattern: /\bAGUA\b|SANEAMENTO|SABESP|CAESB|COPASA/ },
  { code: "INTERNET", label: "Internet e telefonia", pattern: /INTERNET|TELEFON|TELECOM|\bVIVO\b|\bTIM\b|\bCLARO\b/ },
  { code: "RENT", label: "Aluguel e locação", pattern: /\bALUGUEL\b|LOCACAO|ARRENDAMENTO/, critical: true },
  { code: "ACCOUNTING", label: "Honorários contábeis", pattern: /HONORARIO|CONTABIL/ },
  { code: "LOAN", label: "Empréstimos e financiamentos", pattern: /EMPRESTIMO|FINANCIAMENTO|AMORTIZACAO/, critical: true },
  { code: "INSURANCE", label: "Seguros", pattern: /\bSEGURO\b|SEGURADORA/ },
  { code: "CONDOMINIUM", label: "Condomínio", pattern: /CONDOMINIO/ },
  { code: "SOFTWARE", label: "Sistemas e assinaturas", pattern: /ASSINATURA|LICENCA DE SOFTWARE|SOFTWARE|SISTEMA/ },
];

const GENERIC_ONE_OFF = /\bPIX\b|TRANSFERENCIA|\bTED\b|\bDOC\b|TARIFA|ESTORNO|AJUSTE|SAQUE|DEPOSITO|RECEBIMENTO GENERICO|PAGAMENTO GENERICO/;
const CLOSED_STATUS = /QUITADO|PAGO|RECEBIDO$|CANCELADO|PERDIDO/;
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

function normalizedDescription(value: string) {
  return normalize(value)
    .replace(/\b(?:NF|NFE|FATURA|PARCELA|DOC|NUMERO)\s*\d+\b/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordText(entry: ContaAzulAuditEntry) {
  return normalize([
    entry.description,
    entry.counterparty,
    ...entry.categories,
  ].filter(Boolean).join(" "));
}

function semanticDefinition(entry: ContaAzulAuditEntry) {
  const text = recordText(entry);
  return SEMANTIC_DEFINITIONS.find((definition) => definition.pattern.test(text)) ?? null;
}

function firstCategory(entry: ContaAzulAuditEntry) {
  return entry.categories.find((category) => category.trim())?.trim() || null;
}

function recurrenceIdentity(entry: ContaAzulAuditEntry) {
  const semantic = semanticDefinition(entry);
  if (semantic) {
    return {
      key: `${entry.flow}:SEMANTIC:${semantic.code}`,
      label: semantic.label,
      semantic,
    };
  }

  const text = recordText(entry);
  if (GENERIC_ONE_OFF.test(text)) return null;

  const counterparty = normalize(entry.counterparty);
  const category = normalize(firstCategory(entry));
  const description = normalizedDescription(entry.description);
  if (!counterparty && !category && description.length < 5) return null;

  const identity = counterparty
    ? `PARTY:${counterparty}|CATEGORY:${category || "SEM CATEGORIA"}`
    : `DESCRIPTION:${description}|CATEGORY:${category || "SEM CATEGORIA"}`;
  return {
    key: `${entry.flow}:${identity}`,
    label: entry.counterparty?.trim() || entry.description.trim() || firstCategory(entry) || "Recorrência",
    semantic: null,
  };
}

function dateOnly(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKey(value: string) {
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}

function monthDifference(later: string, earlier: string) {
  const a = /^([0-9]{4})-([0-9]{2})/.exec(later);
  const b = /^([0-9]{4})-([0-9]{2})/.exec(earlier);
  if (!a || !b) return null;
  return (Number(a[1]) - Number(b[1])) * 12 + Number(a[2]) - Number(b[2]);
}

function monthsBetween(start: string, end: string) {
  const startDate = dateOnly(`${start.slice(0, 7)}-01`);
  const endDate = dateOnly(`${end.slice(0, 7)}-01`);
  if (!startDate || !endDate || startDate > endDate) return [];
  const months: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate && months.length < 24) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function mode(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function competencePattern(offset: number) {
  if (offset === 0) return "a própria competência do vencimento";
  if (offset === 1) return "a competência do mês anterior";
  if (offset > 1) return `a competência de ${offset} meses antes`;
  if (offset === -1) return "a competência do mês seguinte";
  return `a competência de ${Math.abs(offset)} meses depois`;
}

function findingId(rule: string, suffix: string) {
  return `${rule}_${suffix}`.replace(/[^A-Z0-9_-]/gi, "-");
}

function isOpen(entry: ContaAzulAuditEntry) {
  const status = normalize(entry.status);
  if (CLOSED_STATUS.test(status)) return false;
  if (/EM ABERTO|PENDENTE|ATRASADO|PARCIAL|RENEGOCIADO/.test(status)) return true;
  return entry.outstanding > 0.009;
}

function isOverdue(entry: ContaAzulAuditEntry, today: string) {
  return isOpen(entry) && Boolean(entry.dueDate) && entry.dueDate.slice(0, 10) < today;
}

function severityForProfile(profile: RecurringFinancialProfile): AuditSeverity {
  const critical = SEMANTIC_DEFINITIONS.find((item) => item.code === profile.semanticCode)?.critical;
  return critical ? "CRITICAL" : "WARNING";
}

function buildProfiles(
  history: ContaAzulAuditEntry[],
  historyStart: string,
  historyEnd: string,
) {
  const expectedMonths = monthsBetween(historyStart, historyEnd);
  const groups = new Map<string, {
    identity: NonNullable<ReturnType<typeof recurrenceIdentity>>;
    entries: ContaAzulAuditEntry[];
  }>();

  history.forEach((entry) => {
    if (/CANCELADO|PERDIDO/.test(normalize(entry.status))) return;
    const identity = recurrenceIdentity(entry);
    if (!identity) return;
    const group = groups.get(identity.key) ?? { identity, entries: [] };
    group.entries.push(entry);
    groups.set(identity.key, group);
  });

  return [...groups.values()].flatMap(({ identity, entries }) => {
    const observedMonths = [...new Set(entries.map((entry) => monthKey(entry.dueDate)).filter(Boolean))].sort();
    const coverage = expectedMonths.length ? observedMonths.length / expectedMonths.length : 0;
    const recentMonths = expectedMonths.slice(-2);
    const appearedRecently = observedMonths.some((month) => recentMonths.includes(month));
    const isSemantic = Boolean(identity.semantic);
    const recurring = appearedRecently && (
      (isSemantic && observedMonths.length >= 2)
      || (observedMonths.length >= 3 && coverage >= 0.5)
    );
    if (!recurring) return [];

    const countByMonth = observedMonths.map((month) => entries.filter((entry) => monthKey(entry.dueDate) === month).length);
    const offsets = entries.flatMap((entry) => {
      if (!entry.competenceDate) return [];
      const value = monthDifference(entry.dueDate, entry.competenceDate);
      return value == null || Math.abs(value) > 12 ? [] : [String(value)];
    });
    const expectedOffset = mode(offsets);
    const category = mode(entries.flatMap((entry) => entry.categories.map(normalize)).filter(Boolean));

    return [{
      key: identity.key,
      flow: entries[0].flow,
      label: identity.label,
      category: category?.[0] || firstCategory(entries[0]),
      semanticCode: identity.semantic?.code ?? null,
      observedMonths,
      expectedMonthlyCount: Math.max(1, median(countByMonth)),
      expectedCompetenceOffset: expectedOffset ? Number(expectedOffset[0]) : null,
      competenceConfidence: expectedOffset && offsets.length ? expectedOffset[1] / offsets.length : 0,
      recurrenceConfidence: coverage,
    } satisfies RecurringFinancialProfile];
  });
}

export function analyzeFinancialHistory(input: {
  history: ContaAzulAuditEntry[];
  current: ContaAzulAuditEntry[];
  historyStart: string;
  historyEnd: string;
  periodStart: string;
  periodEnd: string;
  today?: string;
}): FinancialHistoryAnalysis {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const profiles = buildProfiles(input.history, input.historyStart, input.historyEnd);
  const findings: FinancialHistoryAnalysis["findings"] = [];
  const currentByIdentity = new Map<string, ContaAzulAuditEntry[]>();

  input.current.forEach((entry) => {
    const identity = recurrenceIdentity(entry);
    if (!identity) return;
    const list = currentByIdentity.get(identity.key) ?? [];
    list.push(entry);
    currentByIdentity.set(identity.key, list);
  });

  profiles.forEach((profile) => {
    const matches = currentByIdentity.get(profile.key) ?? [];
    if (matches.length < profile.expectedMonthlyCount) {
      const missingCount = profile.expectedMonthlyCount - matches.length;
      findings.push({
        localId: findingId("CA_MISSING_RECURRING", profile.key),
        ruleCode: "CA_MISSING_RECURRING",
        flow: profile.flow,
        title: `${profile.label} não identificado no período`,
        description: matches.length
          ? `O histórico indica aproximadamente ${profile.expectedMonthlyCount} lançamento(s) por mês, mas apenas ${matches.length} foi identificado no período. Confirme os ${missingCount} lançamento(s) possivelmente ausentes.`
          : "O lançamento aparece de forma recorrente no histórico do cliente, mas não foi localizado no período validado.",
        severity: severityForProfile(profile),
        subject: profile.label,
        category: profile.category,
        competence: `${input.periodStart} a ${input.periodEnd}`,
        evidence: [
          { label: "Meses com ocorrência", value: profile.observedMonths.join(", ") },
          { label: "Frequência histórica", value: `${Math.round(profile.recurrenceConfidence * 100)}% dos meses analisados` },
          { label: "Quantidade esperada", value: String(profile.expectedMonthlyCount) },
          { label: "Quantidade localizada", value: String(matches.length) },
        ],
      });
    }

    if (profile.expectedCompetenceOffset == null || profile.competenceConfidence < 0.67) return;
    const expectedCompetenceOffset = profile.expectedCompetenceOffset;
    matches.forEach((entry) => {
      if (!entry.competenceDate) {
        findings.push({
          localId: findingId("CA_COMPETENCE_MISSING", entry.id),
          ruleCode: "CA_COMPETENCE_MISSING",
          flow: entry.flow,
          title: `Competência ausente em ${profile.label}`,
          description: `O histórico indica ${competencePattern(expectedCompetenceOffset)}, mas o lançamento atual não informou competência.`,
          severity: "WARNING",
          subject: profile.label,
          category: firstCategory(entry) || profile.category,
          competence: null,
          amount: entry.total,
          evidence: [
            { label: "Vencimento", value: entry.dueDate },
            { label: "Padrão aprendido", value: competencePattern(expectedCompetenceOffset) },
          ],
        });
        return;
      }
      const actualOffset = monthDifference(entry.dueDate, entry.competenceDate);
      if (actualOffset === expectedCompetenceOffset) return;
      findings.push({
        localId: findingId("CA_COMPETENCE_DIVERGENCE", entry.id),
        ruleCode: "CA_COMPETENCE_DIVERGENCE",
        flow: entry.flow,
        title: `Competência fora do padrão em ${profile.label}`,
        description: `O histórico indica ${competencePattern(expectedCompetenceOffset)}, mas este lançamento está com competência ${entry.competenceDate}.`,
        severity: "WARNING",
        subject: profile.label,
        category: firstCategory(entry) || profile.category,
        competence: entry.competenceDate,
        amount: entry.total,
        evidence: [
          { label: "Vencimento", value: entry.dueDate },
          { label: "Competência informada", value: entry.competenceDate },
          { label: "Padrão aprendido", value: competencePattern(expectedCompetenceOffset) },
          { label: "Confiança do padrão", value: `${Math.round(profile.competenceConfidence * 100)}%` },
        ],
      });
    });

    const expectedCategory = normalize(profile.category);
    if (!expectedCategory) return;
    matches.forEach((entry) => {
      const categories = entry.categories.map(normalize).filter(Boolean);
      if (!categories.length || categories.includes(expectedCategory)) return;
      findings.push({
        localId: findingId("CA_CATEGORY_DIVERGENCE", entry.id),
        ruleCode: "CA_CATEGORY_DIVERGENCE",
        flow: entry.flow,
        title: `Categoria diferente do histórico em ${profile.label}`,
        description: `O histórico usa principalmente “${profile.category}”, mas o lançamento atual está em “${entry.categories.join(", ")}”.`,
        severity: "WARNING",
        subject: profile.label,
        category: entry.categories.join(", "),
        competence: entry.competenceDate,
        amount: entry.total,
        evidence: [
          { label: "Categoria histórica", value: profile.category || "—" },
          { label: "Categoria atual", value: entry.categories.join(", ") },
        ],
      });
    });
  });

  input.current.forEach((entry) => {
    if (!isOpen(entry)) return;
    const overdue = isOverdue(entry, today);
    const semantic = semanticDefinition(entry);
    findings.push({
      localId: findingId(overdue ? "CA_OVERDUE" : "CA_OPEN", entry.id),
      ruleCode: overdue ? "CA_OVERDUE" : "CA_OPEN",
      flow: entry.flow,
      title: overdue
        ? `${entry.flow === "PAYABLE" ? "Pagamento" : "Recebimento"} vencido`
        : `${entry.flow === "PAYABLE" ? "Pagamento" : "Recebimento"} ainda em aberto`,
      description: overdue
        ? `${entry.description} venceu em ${entry.dueDate} e continua com ${money(entry.outstanding || entry.total)} em aberto.`
        : `${entry.description} está em aberto com vencimento em ${entry.dueDate}.`,
      severity: overdue && semantic?.critical ? "CRITICAL" : overdue ? "WARNING" : "INFO",
      subject: entry.counterparty || entry.description,
      category: firstCategory(entry),
      competence: entry.competenceDate,
      amount: entry.outstanding || entry.total,
      evidence: [
        { label: "Status no Conta Azul", value: entry.status || "Não informado" },
        { label: "Vencimento", value: entry.dueDate },
        { label: "Valor total", value: money(entry.total) },
        { label: "Saldo em aberto", value: money(entry.outstanding) },
      ],
    });
  });

  const duplicateGroups = new Map<string, ContaAzulAuditEntry[]>();
  input.current.forEach((entry) => {
    if (/CANCELADO/.test(normalize(entry.status))) return;
    const key = [entry.flow, entry.dueDate, normalize(entry.description), normalize(entry.counterparty), entry.total.toFixed(2)].join("|");
    const list = duplicateGroups.get(key) ?? [];
    list.push(entry);
    duplicateGroups.set(key, list);
  });
  [...duplicateGroups.entries()].filter(([, entries]) => entries.length > 1).forEach(([key, entries]) => {
    const entry = entries[0];
    findings.push({
      localId: findingId("CA_POSSIBLE_DUPLICATE", key),
      ruleCode: "CA_POSSIBLE_DUPLICATE",
      flow: entry.flow,
      title: "Possível lançamento duplicado",
      description: `${entries.length} lançamentos com a mesma descrição, vencimento, contato e valor foram encontrados.`,
      severity: "CRITICAL",
      subject: entry.counterparty || entry.description,
      category: firstCategory(entry),
      competence: entry.competenceDate,
      amount: entry.total,
      evidence: entries.map((item) => ({ label: item.id, value: `${item.dueDate} — ${money(item.total)}` })),
    });
  });

  const unique = [...new Map(findings.map((finding) => [finding.localId, finding])).values()];
  const penalty = unique.reduce((sum, finding) => sum + weights[finding.severity], 0);
  const totalChecks = Math.max(1, profiles.length + input.current.length * 2 + 1);
  const failedChecks = unique.filter((finding) => finding.severity !== "INFO").length;

  return {
    findings: unique,
    profiles,
    totalChecks,
    passedChecks: Math.max(0, totalChecks - failedChecks),
    healthScore: Math.max(0, 100 - penalty),
    metrics: {
      historyItems: input.history.length,
      currentItems: input.current.length,
      recurringProfiles: profiles.length,
      missingRecurring: unique.filter((finding) => finding.ruleCode === "CA_MISSING_RECURRING").length,
      overdue: unique.filter((finding) => finding.ruleCode === "CA_OVERDUE").length,
      open: unique.filter((finding) => finding.ruleCode === "CA_OPEN").length,
      competenceDivergences: unique.filter((finding) => finding.ruleCode.startsWith("CA_COMPETENCE")).length,
      categoryDivergences: unique.filter((finding) => finding.ruleCode === "CA_CATEGORY_DIVERGENCE").length,
      duplicates: unique.filter((finding) => finding.ruleCode === "CA_POSSIBLE_DUPLICATE").length,
      payableFindings: unique.filter((finding) => finding.flow === "PAYABLE").length,
      receivableFindings: unique.filter((finding) => finding.flow === "RECEIVABLE").length,
    },
  };
}
