import type { AuditFindingDraft, AuditMovement, AuditSeverity } from "../types";

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b\d{1,3}\/\d{1,3}\b/g, " ")
    .replace(/\bNF\s*\d+\b/g, " ")
    .replace(/\b\d+[.,]?\d*\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localId(rule: string, suffix: string) {
  return `${rule}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function categoryDivergenceRule(movements: AuditMovement[]): AuditFindingDraft[] {
  const groups = new Map<string, AuditMovement[]>();
  for (const item of movements) {
    const key = normalize(item.counterparty) || normalize(item.description);
    if (!key || !item.category) continue;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const findings: AuditFindingDraft[] = [];
  for (const [key, items] of groups) {
    const categories = new Map<string, AuditMovement[]>();
    for (const item of items) {
      const categoryKey = normalize(item.category);
      const list = categories.get(categoryKey) ?? [];
      list.push(item);
      categories.set(categoryKey, list);
    }
    if (categories.size < 2) continue;

    const label = items[0].counterparty || items[0].description;
    const evidence = [...categories.values()].map((list) => ({
      label: list[0].category || "Sem categoria",
      value: list.map((item) => `${item.date.slice(5, 7)}/${item.date.slice(0, 4)} — ${item.description}`).join(" | "),
    }));

    findings.push({
      localId: localId("CATEGORY_DIVERGENCE", key),
      ruleCode: "CATEGORY_DIVERGENCE",
      title: "Possível divergência de categorização",
      description: `${label} foi identificado em mais de uma categoria no período analisado. Revise se a classificação está padronizada.`,
      severity: "WARNING",
      subject: label,
      category: items[items.length - 1].category,
      competence: items[items.length - 1].monthKey,
      evidence,
    });
  }
  return findings;
}

export function duplicateRule(movements: AuditMovement[]): AuditFindingDraft[] {
  const groups = new Map<string, AuditMovement[]>();
  for (const item of movements) {
    const key = [item.date, normalize(item.description), normalize(item.counterparty), Math.abs(item.amount).toFixed(2)].join("|");
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      localId: localId("POSSIBLE_DUPLICATE", key),
      ruleCode: "POSSIBLE_DUPLICATE",
      title: "Possível lançamento duplicado",
      description: `${items.length} lançamentos muito semelhantes foram encontrados na mesma data e valor.`,
      severity: "CRITICAL" as AuditSeverity,
      subject: items[0].counterparty || items[0].description,
      category: items[0].category,
      competence: items[0].monthKey,
      amount: items[0].amount,
      evidence: items.map((item) => ({ label: item.date, value: `${item.description} — ${money(item.amount)}` })),
    }));
}

export function recurringMissingRule(movements: AuditMovement[]): AuditFindingDraft[] {
  const months = [...new Set(movements.map((item) => item.monthKey))].sort();
  if (months.length < 3) return [];
  const latest = months[months.length - 1];
  const previous = months.slice(-3, -1);
  const groups = new Map<string, AuditMovement[]>();

  for (const item of movements) {
    if (item.amount >= 0) continue;
    const key = normalize(item.counterparty) || normalize(item.category) || normalize(item.description);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const findings: AuditFindingDraft[] = [];
  for (const [key, items] of groups) {
    const present = new Set(items.map((item) => item.monthKey));
    if (!previous.every((month) => present.has(month)) || present.has(latest)) continue;
    const avg = items.filter((item) => previous.includes(item.monthKey)).reduce((sum, item) => sum + Math.abs(item.amount), 0) / previous.length;
    const label = items[0].counterparty || items[0].category || items[0].description;
    findings.push({
      localId: localId("MISSING_RECURRING", key),
      ruleCode: "MISSING_RECURRING",
      title: "Recorrência possivelmente interrompida",
      description: `${label} apareceu nos dois meses anteriores, mas não foi localizado em ${latest}. Isso não significa erro automaticamente; requer revisão.`,
      severity: "WARNING",
      subject: label,
      category: items[0].category,
      competence: latest,
      amount: avg,
      evidence: previous.map((month) => {
        const value = items.filter((item) => item.monthKey === month).reduce((sum, item) => sum + Math.abs(item.amount), 0);
        return { label: month, value: money(value) };
      }).concat([{ label: latest, value: "Não identificado" }]),
    });
  }
  return findings;
}

export function monthlyVariationRule(movements: AuditMovement[]): AuditFindingDraft[] {
  const months = [...new Set(movements.map((item) => item.monthKey))].sort();
  if (months.length < 2) return [];
  const latest = months[months.length - 1];
  const previous = months.slice(0, -1);
  const byCategory = new Map<string, AuditMovement[]>();
  for (const item of movements) {
    if (!item.category || item.amount >= 0) continue;
    const key = normalize(item.category);
    const list = byCategory.get(key) ?? [];
    list.push(item);
    byCategory.set(key, list);
  }

  const findings: AuditFindingDraft[] = [];
  for (const [key, items] of byCategory) {
    const latestValue = items.filter((item) => item.monthKey === latest).reduce((sum, item) => sum + Math.abs(item.amount), 0);
    if (latestValue === 0) continue;
    const historical = previous.map((month) => items.filter((item) => item.monthKey === month).reduce((sum, item) => sum + Math.abs(item.amount), 0)).filter((value) => value > 0);
    if (!historical.length) continue;
    const avg = historical.reduce((a, b) => a + b, 0) / historical.length;
    if (avg < 50) continue;
    const variation = (latestValue - avg) / avg;
    if (Math.abs(variation) < 0.5 || Math.abs(latestValue - avg) < 100) continue;
    const category = items[0].category || key;
    findings.push({
      localId: localId("MONTHLY_VARIATION", key),
      ruleCode: "MONTHLY_VARIATION",
      title: "Variação mensal relevante",
      description: `${category} variou ${(variation * 100).toFixed(0)}% em relação à média dos meses anteriores.`,
      severity: Math.abs(variation) >= 1.5 ? "CRITICAL" : "WARNING",
      subject: category,
      category,
      competence: latest,
      amount: latestValue,
      evidence: [
        { label: "Média anterior", value: money(avg) },
        { label: latest, value: money(latestValue) },
        { label: "Variação", value: `${(variation * 100).toFixed(1)}%` },
      ],
    });
  }
  return findings;
}

export function newCategoryRule(movements: AuditMovement[]): AuditFindingDraft[] {
  const months = [...new Set(movements.map((item) => item.monthKey))].sort();
  if (months.length < 2) return [];
  const latest = months[months.length - 1];
  const old = new Set(movements.filter((item) => item.monthKey !== latest).map((item) => normalize(item.category)).filter(Boolean));
  const latestGroups = new Map<string, AuditMovement[]>();
  for (const item of movements.filter((item) => item.monthKey === latest && item.category)) {
    const key = normalize(item.category);
    if (old.has(key)) continue;
    const list = latestGroups.get(key) ?? [];
    list.push(item);
    latestGroups.set(key, list);
  }
  return [...latestGroups.entries()].map(([key, items]) => ({
    localId: localId("NEW_CATEGORY", key),
    ruleCode: "NEW_CATEGORY",
    title: "Nova categoria identificada",
    description: `A categoria ${items[0].category} aparece pela primeira vez no último mês do período analisado. Valide se a criação/classificação faz sentido.`,
    severity: "INFO" as AuditSeverity,
    subject: items[0].category,
    category: items[0].category,
    competence: latest,
    amount: items.reduce((sum, item) => sum + Math.abs(item.amount), 0),
    evidence: items.slice(0, 5).map((item) => ({ label: item.date, value: `${item.description} — ${money(item.amount)}` })),
  }));
}

export function negativeEndingBalanceRule(movements: AuditMovement[]): AuditFindingDraft[] {
  const withBalance = movements.filter((item) => item.balance != null);
  const last = withBalance[withBalance.length - 1];
  if (!last || (last.balance ?? 0) >= 0) return [];
  return [{
    localId: "NEGATIVE_ENDING_BALANCE",
    ruleCode: "NEGATIVE_ENDING_BALANCE",
    title: "Saldo realizado final negativo",
    description: `O último saldo realizado identificado no extrato está negativo (${money(last.balance ?? 0)}). Verifique se o saldo e as conciliações estão corretos.`,
    severity: "WARNING",
    competence: last.monthKey,
    amount: last.balance,
    evidence: [{ label: last.date, value: money(last.balance ?? 0) }],
  }];
}

export const auditRules = [
  categoryDivergenceRule,
  duplicateRule,
  recurringMissingRule,
  monthlyVariationRule,
  newCategoryRule,
  negativeEndingBalanceRule,
];
