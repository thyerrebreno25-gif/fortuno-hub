export type ReadingInstructionField =
  | "ACCOUNT"
  | "ESTABLISHMENT"
  | "BRAND"
  | "MODALITY"
  | "SHEET"
  | "DESCRIPTION";

export type ReadingInstructionAction = "EXCLUDE" | "INCLUDE";

export type AcquirerReadingRule = {
  id: string;
  action: ReadingInstructionAction;
  field: ReadingInstructionField;
  value: string;
  source: string;
  label: string;
};

export type InterpretedReadingInstructions = {
  rules: AcquirerReadingRule[];
  unrecognized: string[];
};

export type ReadingInstructionEvaluation = {
  excluded: boolean;
  matchedRuleIds: string[];
  exclusionRuleIds: string[];
};

const fieldLabels: Record<ReadingInstructionField, string> = {
  ACCOUNT: "conta",
  ESTABLISHMENT: "estabelecimento",
  BRAND: "bandeira",
  MODALITY: "modalidade",
  SHEET: "aba",
  DESCRIPTION: "descrição",
};

const fieldPatterns: Array<{
  field: ReadingInstructionField;
  pattern: RegExp;
}> = [
  {
    field: "ACCOUNT",
    pattern: /\b(?:conta(?:\s+(?:corrente|banc[aá]ria))?|domic[ií]lio\s+banc[aá]rio)\b/i,
  },
  {
    field: "ESTABLISHMENT",
    pattern: /\b(?:estabelecimento|empresa|loja)\b/i,
  },
  {
    field: "BRAND",
    pattern: /\b(?:bandeira|marca\s+do\s+cart[aã]o)\b/i,
  },
  {
    field: "SHEET",
    pattern: /\baba\b/i,
  },
  {
    field: "DESCRIPTION",
    pattern: /\b(?:descri[cç](?:[aã]o|[oõ]es)|motivo|hist[oó]rico)\b/i,
  },
  {
    field: "MODALITY",
    pattern: /\b(?:modalidade|tipo\s+de\s+(?:pagamento|transa[cç][aã]o|produto)|cr[eé]dito|d[eé]bito|pix|voucher)\b/i,
  },
];

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeComparable(value: unknown) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitStatements(input: string) {
  return input
    .split(/[\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function detectAction(statement: string): ReadingInstructionAction | null {
  const normalized = normalize(statement);
  const include = /\b(?:somente|apenas|exclusivamente|unicamente)\b/.test(normalized)
    || /\b(?:trazer|importar|considerar|manter|incluir)\b/.test(normalized);
  const exclude = /\b(?:nao|ignorar|excluir|desconsiderar|remover|retirar|descartar)\b/.test(normalized)
    || /\bsem\s+(?:a|as|o|os|dados|registros|lancamentos)\b/.test(normalized);

  if (include && /\b(?:somente|apenas|exclusivamente|unicamente)\b/.test(normalized)) {
    return "INCLUDE";
  }
  if (exclude) return "EXCLUDE";
  if (include) return "INCLUDE";
  return null;
}

function cleanExtractedValue(value: string) {
  return value
    .trim()
    .replace(/^[\s:=#\-–—]+/, "")
    .replace(/^(?:n[uú]mero|n[º°o.]*)\s*/i, "")
    .replace(/^(?:igual\s+a|chamad[ao]|denominad[ao]|contendo|com\s+o\s+valor)\s+/i, "")
    .replace(/^["'“”]+|["'“”.,]+$/g, "")
    .trim();
}

function extractValue(
  statement: string,
  fieldMatch: RegExpMatchArray,
  field: ReadingInstructionField,
) {
  const quoted = statement.match(/["“']([^"”']+)["”']/);
  if (quoted?.[1]) return cleanExtractedValue(quoted[1]);

  if (field === "MODALITY") {
    const directModality = fieldMatch[0].match(/cr[eé]dito|d[eé]bito|pix|voucher/i)?.[0];
    if (directModality) return cleanExtractedValue(directModality);
  }

  const start = (fieldMatch.index ?? 0) + fieldMatch[0].length;
  return cleanExtractedValue(statement.slice(start));
}

function buildLabel(rule: Pick<AcquirerReadingRule, "action" | "field" | "value">) {
  const action = rule.action === "EXCLUDE" ? "Ignorar" : "Considerar somente";
  return `${action} ${fieldLabels[rule.field]} “${rule.value}”`;
}

export function interpretReadingInstructions(input: string): InterpretedReadingInstructions {
  const rules: AcquirerReadingRule[] = [];
  const unrecognized: string[] = [];

  splitStatements(input).forEach((statement, index) => {
    const action = detectAction(statement);
    const fieldDefinition = fieldPatterns.find(({ pattern }) => statement.match(pattern));
    const fieldMatch = fieldDefinition ? statement.match(fieldDefinition.pattern) : null;

    if (!action || !fieldDefinition || !fieldMatch) {
      unrecognized.push(statement);
      return;
    }

    const value = extractValue(statement, fieldMatch, fieldDefinition.field);
    if (!value || normalizeComparable(value).length < 2) {
      unrecognized.push(statement);
      return;
    }

    const rule: AcquirerReadingRule = {
      id: `instruction-${index + 1}`,
      action,
      field: fieldDefinition.field,
      value,
      source: statement,
      label: "",
    };
    rule.label = buildLabel(rule);
    rules.push(rule);
  });

  return { rules, unrecognized };
}

function headerMatchesField(header: string, field: ReadingInstructionField) {
  const normalized = normalize(header);
  if (field === "ACCOUNT") {
    return /\bconta\b|domicilio\s+bancario|dados\s+bancarios/.test(normalized);
  }
  if (field === "ESTABLISHMENT") {
    return /estabelecimento|empresa|loja/.test(normalized);
  }
  if (field === "BRAND") return /bandeira|marca\s+do\s+cartao/.test(normalized);
  if (field === "MODALITY") {
    return /modalidade|forma\s+de\s+pagamento|tipo\s+de\s+(?:pagamento|transacao|produto)/.test(normalized);
  }
  if (field === "DESCRIPTION") {
    return /descricao|motivo|historico|tipo\s+(?:do\s+ajuste|de\s+lancamento)|cancelamento\/chargeback/.test(normalized);
  }
  return false;
}

function valuesForRule(
  row: Record<string, unknown>,
  sheetName: string,
  field: ReadingInstructionField,
) {
  if (field === "SHEET") return [sheetName];
  return Object.entries(row)
    .filter(([header]) => headerMatchesField(header, field))
    .map(([, value]) => String(value ?? "").trim())
    .filter(Boolean);
}

function valueMatches(candidate: string, rule: AcquirerReadingRule) {
  const candidateText = normalizeComparable(candidate);
  const ruleText = normalizeComparable(rule.value);
  if (!candidateText || !ruleText) return false;

  if (rule.field === "ACCOUNT") {
    const compactCandidate = candidateText.replace(/[^a-z0-9]/g, "");
    const compactRule = ruleText.replace(/[^a-z0-9]/g, "");
    return compactRule.length >= 3 && compactCandidate.includes(compactRule);
  }

  return candidateText.includes(ruleText);
}

export function evaluateReadingInstructions(
  row: Record<string, unknown>,
  sheetName: string,
  rules: AcquirerReadingRule[],
): ReadingInstructionEvaluation {
  if (rules.length === 0) {
    return { excluded: false, matchedRuleIds: [], exclusionRuleIds: [] };
  }

  const values = new Map<ReadingInstructionField, string[]>();
  const getValues = (field: ReadingInstructionField) => {
    const current = values.get(field) ?? valuesForRule(row, sheetName, field);
    values.set(field, current);
    return current;
  };

  const matchedRuleIds = rules
    .filter((rule) => getValues(rule.field).some((value) => valueMatches(value, rule)))
    .map((rule) => rule.id);

  const exclusionRuleIds = rules
    .filter((rule) => rule.action === "EXCLUDE" && matchedRuleIds.includes(rule.id))
    .map((rule) => rule.id);

  const includeRulesByField = new Map<ReadingInstructionField, AcquirerReadingRule[]>();
  rules.filter((rule) => rule.action === "INCLUDE").forEach((rule) => {
    includeRulesByField.set(rule.field, [
      ...(includeRulesByField.get(rule.field) ?? []),
      rule,
    ]);
  });

  for (const [field, includeRules] of includeRulesByField) {
    const fieldValues = getValues(field);
    if (fieldValues.length === 0) continue;
    if (!includeRules.some((rule) => matchedRuleIds.includes(rule.id))) {
      exclusionRuleIds.push(...includeRules.map((rule) => rule.id));
    }
  }

  return {
    excluded: exclusionRuleIds.length > 0,
    matchedRuleIds,
    exclusionRuleIds: Array.from(new Set(exclusionRuleIds)),
  };
}
