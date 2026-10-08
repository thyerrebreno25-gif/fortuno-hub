export type PurchaseInvoiceRuleCandidate = {
  supplierDocument: string;
  productCode: string;
  normalizedDescription: string;
  contaAzulCategoryId: string;
  contaAzulCategoryName: string;
  contaAzulCostCenterId: string | null;
  contaAzulCostCenterName: string | null;
};

type PurchaseInvoiceItemIdentity = {
  productCode: string | null;
  normalizedDescription: string;
};

const DESCRIPTION_CONNECTORS = new Set([
  "A",
  "AS",
  "COM",
  "DA",
  "DAS",
  "DE",
  "DO",
  "DOS",
  "E",
  "EM",
  "O",
  "OS",
  "PARA",
]);

const GENERIC_LEADING_WORDS = new Set([
  "CONJUNTO",
  "DIVERSAS",
  "DIVERSOS",
  "ITEM",
  "ITENS",
  "KIT",
  "MATERIAL",
  "MATERIAIS",
  "MERCADORIA",
  "MERCADORIAS",
  "OUTRAS",
  "OUTROS",
  "PRODUTO",
  "PRODUTOS",
  "SERVICO",
  "SERVICOS",
]);

function descriptionTokens(value: string) {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !DESCRIPTION_CONNECTORS.has(token));
}

/**
 * Compara o início útil das descrições, ignorando conectores como "de" e
 * "com". A primeira palavra útil já pode ensinar uma família inteira de
 * itens (ex.: qualquer descrição iniciada por "OVO"). Termos amplos como
 * "SERVICO", "ITEM" e "PRODUTO" exigem uma segunda palavra para não unir
 * mercadorias sem relação.
 */
function leadingDescriptionStrength(ruleDescription: string, itemDescription: string) {
  const ruleTokens = descriptionTokens(ruleDescription);
  const itemTokens = descriptionTokens(itemDescription);
  if (!ruleTokens.length || !itemTokens.length) return 0;

  let shared = 0;
  const limit = Math.min(ruleTokens.length, itemTokens.length);
  while (shared < limit && ruleTokens[shared] === itemTokens[shared]) shared += 1;

  if (!shared) return 0;
  if (shared >= 2) return shared;
  if (ruleTokens[0].length < 3 || GENERIC_LEADING_WORDS.has(ruleTokens[0])) {
    return 0;
  }
  return 1;
}

function sameCostCenter(
  first: PurchaseInvoiceRuleCandidate,
  second: PurchaseInvoiceRuleCandidate,
) {
  return (
    first.contaAzulCostCenterId === second.contaAzulCostCenterId &&
    first.contaAzulCostCenterName === second.contaAzulCostCenterName
  );
}

function unanimousRule(
  rules: PurchaseInvoiceRuleCandidate[],
): PurchaseInvoiceRuleCandidate | undefined {
  if (!rules.length) return undefined;

  const categoryIds = new Set(rules.map((rule) => rule.contaAzulCategoryId));
  if (categoryIds.size !== 1) return undefined;

  const mostRecentRule = rules[0];
  const hasUnanimousCostCenter = rules.every((rule) =>
    sameCostCenter(mostRecentRule, rule),
  );

  if (hasUnanimousCostCenter) return mostRecentRule;

  return {
    ...mostRecentRule,
    contaAzulCostCenterId: null,
    contaAzulCostCenterName: null,
  };
}

function findLeadingDescriptionRule(
  rules: PurchaseInvoiceRuleCandidate[],
  normalizedDescription: string,
) {
  const matches = rules
    .map((rule) => ({
      rule,
      strength: leadingDescriptionStrength(
        rule.normalizedDescription,
        normalizedDescription,
      ),
    }))
    .filter((candidate) => candidate.strength > 0);

  if (!matches.length) return undefined;

  // Usa apenas o grupo mais específico. Assim, uma regra de três palavras
  // não é misturada com outra que coincida somente nas duas primeiras.
  const strongest = Math.max(...matches.map((candidate) => candidate.strength));
  return unanimousRule(
    matches
      .filter((candidate) => candidate.strength === strongest)
      .map((candidate) => candidate.rule),
  );
}

export function findPurchaseInvoiceRule(
  rules: PurchaseInvoiceRuleCandidate[],
  supplierDocument: string,
  item: PurchaseInvoiceItemIdentity,
): PurchaseInvoiceRuleCandidate | undefined {
  const productCode = item.productCode || "";

  const supplierRule =
    rules.find(
      (rule) =>
        rule.supplierDocument === supplierDocument &&
        rule.productCode === productCode &&
        rule.normalizedDescription === item.normalizedDescription,
    ) ||
    (productCode
      ? rules.find(
          (rule) =>
            rule.supplierDocument === supplierDocument &&
            rule.productCode === productCode,
        )
      : undefined) ||
    rules.find(
      (rule) =>
        rule.supplierDocument === supplierDocument &&
        rule.normalizedDescription === item.normalizedDescription,
    );

  if (supplierRule) return supplierRule;

  const supplierLeadingRule = findLeadingDescriptionRule(
    rules.filter((rule) => rule.supplierDocument === supplierDocument),
    item.normalizedDescription,
  );
  if (supplierLeadingRule) return supplierLeadingRule;

  const sameDescriptionRules = rules.filter(
    (rule) => rule.normalizedDescription === item.normalizedDescription,
  );

  const exactDescriptionRule = unanimousRule(sameDescriptionRules);
  if (exactDescriptionRule) return exactDescriptionRule;

  // Entre fornecedores diferentes, o começo da descrição só é aprendido
  // quando as regras mais específicas do histórico concordam na categoria.
  // Conflitos continuam visíveis para revisão manual.
  return findLeadingDescriptionRule(rules, item.normalizedDescription);
}
