import type {
  ContaAzulReceivable,
  SalesDestinationRule,
  SalesReconciliationResult,
  SalesReconciliationRow,
  SalesSpreadsheetEntry,
} from "./types";

export function normalizedKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cents(value: number) {
  return Math.round(value * 100);
}

function daysBetween(a: string, b: string) {
  return Math.round(Math.abs(
    new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime(),
  ) / 86_400_000);
}

function dateMatch(entry: SalesSpreadsheetEntry, item: ContaAzulReceivable) {
  if (item.paymentDate === entry.paymentDate) return "PAYMENT" as const;
  if (item.competenceDate === entry.paymentDate) return "COMPETENCE" as const;
  if (item.dueDate === entry.paymentDate) return "DUE" as const;
  return null;
}

function textScore(entry: SalesSpreadsheetEntry, item: ContaAzulReceivable) {
  const sourceTokens = new Set(normalizedKey([
    entry.customer,
    entry.receiptName,
    entry.product,
    entry.documentNumber,
  ].filter(Boolean).join(" ")).split(" ").filter((token) => token.length >= 3));
  const targetTokens = new Set(normalizedKey(`${item.counterparty} ${item.description}`).split(" ").filter((token) => token.length >= 3));
  let score = 0;
  sourceTokens.forEach((token) => {
    if (targetTokens.has(token)) score += 1;
  });
  return score;
}

function expectedCategory(entry: SalesSpreadsheetEntry, rule: SalesDestinationRule) {
  const productKey = normalizedKey(entry.product || "Sem produto informado");
  const override = Object.entries(rule.productCategories ?? {})
    .find(([product]) => normalizedKey(product) === productKey)?.[1];
  return override?.trim() || rule.expectedCategoryName?.trim() || null;
}

function categoryMatches(expected: string | null, item: ContaAzulReceivable) {
  if (!expected) return true;
  const key = normalizedKey(expected);
  return item.categoryNames.some((category) => normalizedKey(category) === key);
}

function matchRow(input: {
  entry: SalesSpreadsheetEntry;
  rule: SalesDestinationRule;
  receivables: ContaAzulReceivable[];
  used: Set<string>;
}): SalesReconciliationRow {
  const { entry, rule, receivables, used } = input;
  const expected = expectedCategory(entry, rule);
  if (entry.amount < 0) {
    return {
      ...entry,
      status: "NEGATIVE_REVIEW",
      statusDetail: "Valor negativo identificado. Revise como estorno ou ajuste antes da conferência.",
      expectedCategory: expected,
      matchedDateField: null,
      contaAzul: null,
    };
  }

  const sameAmount = receivables.filter((item) => !used.has(item.id) && cents(item.amount) === cents(entry.amount));
  const exact = sameAmount.filter((item) => dateMatch(entry, item));
  let matched: ContaAzulReceivable | null = null;
  let matchedDateField: SalesReconciliationRow["matchedDateField"] = null;

  if (exact.length === 1) {
    matched = exact[0];
    matchedDateField = dateMatch(entry, matched);
  } else if (exact.length > 1) {
    const ranked = exact.map((item) => ({ item, score: textScore(entry, item) }))
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
    if (ranked[0].score > 0 && ranked[0].score > (ranked[1]?.score ?? -1)) {
      matched = ranked[0].item;
      matchedDateField = dateMatch(entry, matched);
    } else {
      return {
        ...entry,
        status: "AMBIGUOUS",
        statusDetail: `${exact.length} lançamentos do Conta Azul têm a mesma data e o mesmo valor.`,
        expectedCategory: expected,
        matchedDateField: null,
        contaAzul: null,
      };
    }
  }

  if (matched) {
    used.add(matched.id);
    const rightCategory = categoryMatches(expected, matched);
    return {
      ...entry,
      status: rightCategory ? "OK" : "WRONG_CATEGORY",
      statusDetail: rightCategory
        ? "Data e valor conferem no Conta Azul."
        : `Lançamento localizado, mas a categoria é ${matched.categoryNames.join(" / ") || "não informada"}.`,
      expectedCategory: expected,
      matchedDateField,
      contaAzul: matched,
    };
  }

  const nearby = sameAmount
    .map((item) => ({
      item,
      distance: Math.min(...[item.paymentDate, item.competenceDate, item.dueDate]
        .filter((date): date is string => Boolean(date))
        .map((date) => daysBetween(entry.paymentDate, date))),
    }))
    .filter((candidate) => Number.isFinite(candidate.distance) && candidate.distance <= 3)
    .sort((a, b) => a.distance - b.distance);

  if (nearby.length === 1) {
    return {
      ...entry,
      status: "NEARBY_DATE",
      statusDetail: `Mesmo valor localizado com diferença de ${nearby[0].distance} dia(s). Não foi considerado OK.`,
      expectedCategory: expected,
      matchedDateField: null,
      contaAzul: nearby[0].item,
    };
  }

  return {
    ...entry,
    status: "NOT_FOUND",
    statusDetail: "Nenhum lançamento não utilizado possui esta data e este valor exato.",
    expectedCategory: expected,
    matchedDateField: null,
    contaAzul: null,
  };
}

export function reconcileSales(input: {
  entries: SalesSpreadsheetEntry[];
  rules: SalesDestinationRule[];
  receivablesByClient: Record<string, { clientName: string; items: ContaAzulReceivable[] }>;
}): SalesReconciliationResult {
  const rules = new Map(input.rules.map((rule) => [normalizedKey(rule.sourceLabel), rule]));
  const usedByClient = new Map<string, Set<string>>();
  const rows = input.entries.map((entry): SalesReconciliationRow => {
    const label = entry.destinationLabel || "Sem cadastro informado";
    const rule = rules.get(normalizedKey(label));
    if (!rule?.clientId || !input.receivablesByClient[rule.clientId]) {
      return {
        ...entry,
        status: "UNMAPPED_DESTINATION",
        statusDetail: `O cadastro “${label}” não foi vinculado a um cliente do Fortuno Hub.`,
        expectedCategory: null,
        matchedDateField: null,
        contaAzul: null,
      };
    }
    const used = usedByClient.get(rule.clientId) ?? new Set<string>();
    usedByClient.set(rule.clientId, used);
    return matchRow({
      entry,
      rule,
      receivables: input.receivablesByClient[rule.clientId].items,
      used,
    });
  });

  const extraContaAzul = Object.entries(input.receivablesByClient).flatMap(([clientId, source]) => {
    const used = usedByClient.get(clientId) ?? new Set<string>();
    return source.items
      .filter((item) => !used.has(item.id))
      .map((item) => ({ ...item, clientId, clientName: source.clientName }));
  });
  const count = (status: SalesReconciliationRow["status"]) => rows.filter((row) => row.status === status).length;
  const matchedRows = rows.filter((row) => row.status === "OK" || row.status === "WRONG_CATEGORY");

  return {
    rows,
    extraContaAzul,
    summary: {
      spreadsheetRows: rows.length,
      ok: count("OK"),
      wrongCategory: count("WRONG_CATEGORY"),
      notFound: count("NOT_FOUND"),
      nearbyDate: count("NEARBY_DATE"),
      ambiguous: count("AMBIGUOUS"),
      unmapped: count("UNMAPPED_DESTINATION"),
      negativeReview: count("NEGATIVE_REVIEW"),
      extraContaAzul: extraContaAzul.length,
      spreadsheetAmount: Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
      matchedAmount: Math.round(matchedRows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
    },
  };
}
