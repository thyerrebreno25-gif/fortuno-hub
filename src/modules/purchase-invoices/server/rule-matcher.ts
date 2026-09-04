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

function sameCostCenter(
  first: PurchaseInvoiceRuleCandidate,
  second: PurchaseInvoiceRuleCandidate,
) {
  return (
    first.contaAzulCostCenterId === second.contaAzulCostCenterId &&
    first.contaAzulCostCenterName === second.contaAzulCostCenterName
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

  const sameDescriptionRules = rules.filter(
    (rule) => rule.normalizedDescription === item.normalizedDescription,
  );

  if (!sameDescriptionRules.length) return undefined;

  const categoryIds = new Set(
    sameDescriptionRules.map((rule) => rule.contaAzulCategoryId),
  );

  // Entre fornecedores diferentes, só aprende quando todo o histórico do
  // cliente aponta para a mesma categoria. Conflitos ficam para revisão.
  if (categoryIds.size !== 1) return undefined;

  const mostRecentRule = sameDescriptionRules[0];
  const hasUnanimousCostCenter = sameDescriptionRules.every((rule) =>
    sameCostCenter(mostRecentRule, rule),
  );

  if (hasUnanimousCostCenter) return mostRecentRule;

  return {
    ...mostRecentRule,
    contaAzulCostCenterId: null,
    contaAzulCostCenterName: null,
  };
}
