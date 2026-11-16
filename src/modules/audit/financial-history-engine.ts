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
  paymentDate?: string | null;
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
  expectedDueDays: number[];
  expectedCompetenceOffset: number | null;
  competenceConfidence: number;
  recurrenceConfidence: number;
  categoryConfidence?:number;
  latestMonthAmount?:number;
  latestMonth?:string;
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
    amountVariations:number;
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
  {code:"TAX_IRPJ",label:"IRPJ",pattern:/\bIRPJ\b/,critical:true},
  {code:"TAX_CSLL",label:"CSLL",pattern:/\bCSLL\b/,critical:true},
  {code:"TAX_COFINS",label:"COFINS",pattern:/\bCOFINS\b/,critical:true},
  {code:"TAX_PIS",label:"PIS",pattern:/\bPIS\b/,critical:true},
  {code:"TAX_IRRF",label:"IRRF",pattern:/\bIRRF\b/,critical:true},
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
  return normalize(value.replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g," "))
    .replace(/\b(?:JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\b/g," ")
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
  // The chosen category cannot override the meaning of the payment description.
  for(const value of [entry.description,entry.counterparty,entry.categories.join(" ")]){
    const match=SEMANTIC_DEFINITIONS.find(definition=>definition.pattern.test(normalize(value)));
    if(match)return match;
  }
  return null;
}

function firstCategory(entry: ContaAzulAuditEntry) {
  return entry.categories.find((category) => category.trim())?.trim() || null;
}

function recurrenceIdentity(entry: ContaAzulAuditEntry) {
  const semantic = semanticDefinition({...entry,categories:[]});
  if (semantic) {
    return {
      key: `${entry.flow}:SEMANTIC:${semantic.code}:${normalize(entry.counterparty) || "SEM CONTATO"}`,
      label: semantic.label,
      semantic,
    };
  }

  const text = recordText(entry);
  if (GENERIC_ONE_OFF.test(text)) return null;

  const counterparty = normalize(entry.counterparty);

  const description = normalizedDescription(entry.description);
  if (!counterparty && description.length < 5) return null;

  const identity = counterparty
    ? `PARTY:${counterparty}|DESCRIPTION:${description}`
    : `DESCRIPTION:${description}`;
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

function dayOfMonth(value: string) {
  const match = /^\d{4}-\d{2}-(\d{2})/.exec(value);
  return match ? Number(match[1]) : null;
}

function expectedDueDays(
  entries: ContaAzulAuditEntry[],
  observedMonths: string[],
  expectedMonthlyCount: number,
) {
  const daysByMonth = observedMonths.map((month) => entries
    .filter((entry) => monthKey(entry.dueDate) === month)
    .map((entry) => dayOfMonth(entry.dueDate))
    .filter((day): day is number => day != null)
    .sort((left, right) => left - right));

  return Array.from({ length: expectedMonthlyCount }, (_, index) => {
    const slotDays = daysByMonth.flatMap((days) => (
      days[index] == null ? [] : [days[index]]
    ));
    return slotDays.length ? median(slotDays) : null;
  }).filter((day): day is number => day != null);
}

function expectedOccurrencesInPeriod(
  profile: RecurringFinancialProfile,
  periodStart: string,
  periodEnd: string,
) {
  return monthsBetween(periodStart, periodEnd).reduce((total, month) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
    const intervalStart = periodStart > monthStart ? periodStart : monthStart;
    const intervalEnd = periodEnd < monthEnd ? periodEnd : monthEnd;
    if (intervalStart > intervalEnd) return total;

    const firstIncludedDay = Number(intervalStart.slice(8, 10));
    const lastIncludedDay = Number(intervalEnd.slice(8, 10));
    const occurrences = profile.expectedDueDays.filter((day) => {
      const effectiveDay = Math.min(day, lastDay);
      return effectiveDay >= firstIncludedDay && effectiveDay <= lastIncludedDay;
    }).length;
    return total + occurrences;
  }, 0);
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
    const appearedRecently = recentMonths.length>=2&&recentMonths.every((month) => observedMonths.includes(month));
    const isSemantic = Boolean(identity.semantic);
    const recurring = appearedRecently && (
      (isSemantic && observedMonths.length >= 2)
      || (observedMonths.length >= 2 && coverage >= 0.5)
    );
    if (!recurring) return [];

    const countByMonth = observedMonths.map((month) => entries.filter((entry) => monthKey(entry.dueDate) === month).length);
    const expectedMonthlyCount = Math.max(1, median(countByMonth));
    const offsets = entries.flatMap((entry) => {
      if (!entry.competenceDate) return [];
      const value = monthDifference(entry.dueDate, entry.competenceDate);
      return value == null || Math.abs(value) > 12 ? [] : [String(value)];
    });
    const expectedOffset = mode(offsets);
    const category = mode(entries.map(entry=>entry.categories.map(normalize).filter(Boolean).sort().join(" | ")).filter(Boolean));
    const latestMonth=observedMonths.at(-1)!;
    const latestMonthAmount=entries.filter(entry=>monthKey(entry.dueDate)===latestMonth).reduce((sum,entry)=>sum+entry.total,0);

    return [{
      key: identity.key,
      flow: entries[0].flow,
      label: identity.label,
      category: category?.[0] || firstCategory(entries[0]),
      semanticCode: identity.semantic?.code ?? null,
      observedMonths,
      expectedMonthlyCount,
      expectedDueDays: expectedDueDays(entries, observedMonths, expectedMonthlyCount),
      expectedCompetenceOffset: expectedOffset ? Number(expectedOffset[0]) : null,
      competenceConfidence: expectedOffset && offsets.length ? expectedOffset[1] / offsets.length : 0,
      recurrenceConfidence: coverage,
      categoryConfidence: category?category[1]/entries.length:0,latestMonth,latestMonthAmount,
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
  variationPercent?:number;
  overdueEntries?:ContaAzulAuditEntry[];
}): FinancialHistoryAnalysis {
  const today = input.today ?? new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const profiles = buildProfiles(input.history, input.historyStart, input.historyEnd);
  const findings: FinancialHistoryAnalysis["findings"] = [];
  const currentByIdentity = new Map<string, ContaAzulAuditEntry[]>();

  input.current.forEach((entry) => {
    if (/CANCELADO|PERDIDO/.test(normalize(entry.status))) return;
    const identity = recurrenceIdentity(entry);
    if (!identity) return;
    const list = currentByIdentity.get(identity.key) ?? [];
    list.push(entry);
    currentByIdentity.set(identity.key, list);
  });

  const validCurrent=input.current.filter(entry=>!/CANCELADO|PERDIDO/.test(normalize(entry.status)));
  const threshold=input.variationPercent??25;
  for(const profile of profiles){
    const matches=(currentByIdentity.get(profile.key)||[]).filter(entry=>!/CANCELADO|PERDIDO/.test(normalize(entry.status)));
    for(const month of monthsBetween(input.periodStart,input.periodEnd)){
      const lastDay=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
      const from=input.periodStart>month+"-01"?input.periodStart:month+"-01",to=input.periodEnd<`${month}-${String(lastDay).padStart(2,"0")}`?input.periodEnd:`${month}-${String(lastDay).padStart(2,"0")}`;
      const expected=from>today?0:expectedOccurrencesInPeriod(profile,from,to>today?today:to),found=matches.filter(entry=>entry.dueDate>=from&&entry.dueDate<=to);
      if(expected>found.length)findings.push({localId:findingId("CA_MISSING_RECURRING",profile.key+month),ruleCode:"CA_MISSING_RECURRING",flow:profile.flow,title:`${profile.label} não identificado em ${month}`,description:`O histórico indica ${expected} lançamento(s) esperado(s) no intervalo, mas apenas ${found.length} foi identificado. Confirme se faltam pagamentos ou se a obrigação deixou de se aplicar.`,severity:severityForProfile(profile),subject:profile.label,category:profile.category,competence:month,evidence:[{label:"Meses com ocorrência",value:profile.observedMonths.join(", ")},{label:"Dias habituais de vencimento",value:profile.expectedDueDays.join(", ")},{label:"Quantidade esperada no intervalo",value:String(expected)},{label:"Quantidade localizada",value:String(found.length)}]});
      const completeMonth=from===month+"-01"&&to===`${month}-${String(lastDay).padStart(2,"0")}`;
      const previousMonth=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-2,1,12)).toISOString().slice(0,7);
      const previousEntries=[...input.history,...input.current].filter(entry=>monthKey(entry.dueDate)===previousMonth&&recurrenceIdentity(entry)?.key===profile.key&&!/CANCELADO|PERDIDO/.test(normalize(entry.status)));
      const previous=previousEntries.reduce((sum,entry)=>sum+entry.total,0),current=found.reduce((sum,entry)=>sum+entry.total,0),difference=current-previous;
      if(completeMonth&&found.length&&previous>0&&Math.abs(difference)>=100&&Math.abs(difference)/previous*100>=threshold)findings.push({localId:findingId("CA_AMOUNT_VARIATION",profile.key+month),ruleCode:"CA_AMOUNT_VARIATION",flow:profile.flow,title:`Valor fora do padrão em ${profile.label}`,description:`O valor mensal passou de ${money(previous)} para ${money(current)} (${(difference/previous*100).toFixed(1)}%). Confirme reajuste, cobrança extra ou lançamento incorreto.`,severity:"WARNING",subject:profile.label,category:profile.category,competence:month,amount:current,evidence:[{label:"Mês anterior observado",value:previousMonth},{label:"Valor anterior",value:money(previous)},{label:"Valor atual",value:money(current)},{label:"Diferença",value:money(difference)},{label:"Critério",value:`Variação de pelo menos ${threshold}% e R$ 100,00; comparação de meses completos.`}]});
    }
    // Category validation must not depend on learning a competence offset.
    if(profile.category&&(profile.categoryConfidence||0)>=0.67){
      for(const entry of matches){const actual=entry.categories.map(normalize).filter(Boolean).sort().join(" | ");
        if(actual===profile.category)continue;
        findings.push({localId:findingId("CA_CATEGORY_DIVERGENCE",entry.id),ruleCode:"CA_CATEGORY_DIVERGENCE",flow:entry.flow,title:`Categoria diferente do histórico em ${profile.label}`,description:`O histórico utiliza “${profile.category}”, mas o lançamento atual está em “${entry.categories.join(", ")||"Sem categoria"}”. Valide a classificação.`,severity:"WARNING",subject:profile.label,category:entry.categories.join(", "),competence:entry.competenceDate,amount:entry.total,evidence:[{label:"Categoria histórica",value:profile.category},{label:"Categoria atual",value:entry.categories.join(", ")||"Sem categoria"},{label:"Identificador no CA",value:entry.id}]});
      }
    }
  }
  const services=new Set(["ENERGY","WATER","INTERNET","RENT","ACCOUNTING","CONDOMINIUM","SOFTWARE","INSURANCE"]);
  for(const entry of validCurrent){
    const semantic=semanticDefinition(entry),oneOff=/\bCOMPRA\b|AQUISICAO|\bAVULS[OA]\b|EQUIPAMENTO/.test(normalize(entry.description));
    const profile=profiles.find(row=>row.key===recurrenceIdentity(entry)?.key);
    const monthlyService=entry.flow==="PAYABLE"&&!oneOff&&!!semantic&&services.has(semantic.code);
    const cashPurchase=entry.flow==="PAYABLE"&&!monthlyService&&(oneOff||GENERIC_ONE_OFF.test(normalize(entry.description)));
    const offset=monthlyService?1:!cashPurchase&&profile&&profile.competenceConfidence>=0.67?profile.expectedCompetenceOffset:null;
    if(offset===null&&!cashPurchase)continue;
    const reference=entry.paymentDate||entry.dueDate;
    const expected=cashPurchase?entry.paymentDate:null;
    if(cashPurchase&&!expected){
      if(entry.paid>0)findings.push({localId:findingId("CA_COMPETENCE_PAYMENT_UNAVAILABLE",entry.id),ruleCode:"CA_COMPETENCE_PAYMENT_UNAVAILABLE",flow:entry.flow,title:"Data de pagamento indisponível para conferir competência",description:"Este pagamento avulso não informou uma data de baixa confiável. Confira o dia do pagamento e a competência manualmente; o vencimento não foi usado como substituto.",severity:"WARNING",subject:entry.counterparty||entry.description,evidence:[{label:"Identificador no CA",value:entry.id},{label:"Competência",value:entry.competenceDate||"Não informada"}]});
      continue;
    }
    const valid=cashPurchase?entry.competenceDate===expected:entry.competenceDate&&monthDifference(reference,entry.competenceDate)===offset;
    if(valid)continue;
    const rule=entry.competenceDate?"CA_COMPETENCE_DIVERGENCE":"CA_COMPETENCE_MISSING";
    findings.push({localId:findingId(rule,entry.id),ruleCode:rule,flow:entry.flow,title:`Competência ${entry.competenceDate?"fora do padrão":"ausente"} em ${semantic?.label||entry.description}`,description:cashPurchase?`Para este pagamento avulso, confira a competência na mesma data do pagamento: ${expected}.`:`Confira a competência: ${monthlyService?"a política de serviços mensais utiliza o mês anterior":`o histórico indica ${competencePattern(offset!)}`}. Trata-se de uma possível necessidade de ajuste; valide o documento.`,severity:"WARNING",subject:entry.counterparty||entry.description,category:firstCategory(entry),competence:entry.competenceDate,amount:entry.total,evidence:[{label:entry.paymentDate?"Data do pagamento":"Vencimento (data de pagamento indisponível)",value:reference},{label:"Competência informada",value:entry.competenceDate||"Não informada"},{label:"Padrão esperado",value:cashPurchase?expected!:competencePattern(offset!)},{label:"Identificador no CA",value:entry.id}]});
  }

  [...new Map([...input.current,...(input.overdueEntries||[])].map(entry=>[entry.flow+":"+entry.id,entry])).values()].forEach((entry) => {
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
  const applicableProfiles = profiles.filter((profile) => (
    expectedOccurrencesInPeriod(profile, input.periodStart, input.periodEnd) > 0
  ));
  const totalChecks = Math.max(1, applicableProfiles.length + input.current.length * 2 + 1);
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
      amountVariations:unique.filter(finding=>finding.ruleCode==="CA_AMOUNT_VARIATION").length,
      duplicates: unique.filter((finding) => finding.ruleCode === "CA_POSSIBLE_DUPLICATE").length,
      payableFindings: unique.filter((finding) => finding.flow === "PAYABLE").length,
      receivableFindings: unique.filter((finding) => finding.flow === "RECEIVABLE").length,
    },
  };
}
