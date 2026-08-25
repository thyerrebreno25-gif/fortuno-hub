export type InvoiceCategoryRule = {
  clientId: string;
  merchantKey: string;
  merchantLabel: string;
  category: string;
  updatedAt: string;
};

const STORAGE_KEY = "convert-now:invoice-category-rules:v1";
const SIMILARITY_THRESHOLD = 0.62;
const IGNORED_TOKENS = new Set([
  "COMPRA", "CARTAO", "CREDITO", "DEBITO", "PARCELA", "PAGAMENTO",
  "BRASIL", "BR", "BRA", "LTDA", "ME", "SA", "EIRELI", "INC", "LLC", "SLU",
]);

export function normalizeInvoiceMerchant(description: string): string {
  return (description ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\(\s*PARCELA\s+\d+\s+DE\s+\d+\s*\)/gi, " ")
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b([A-Z]{3,})\d+\b/g, "$1")
    .replace(/\b[A-Z0-9]{8,}\b/g, " ")
    .replace(/[.*_#|\\/:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function merchantTokens(description: string): string[] {
  return normalizeInvoiceMerchant(description)
    .split(" ")
    .map((token) => token.trim())
    .map((token) => token.replace(/^([A-Z]{3,})\d+$/, "$1"))
    .filter((token) => token.length >= 3 && !IGNORED_TOKENS.has(token) && !/^\d+$/.test(token));
}

function merchantSignature(description: string): string {
  return merchantTokens(description).join(" ") || normalizeInvoiceMerchant(description);
}

export function invoiceMerchantSimilarity(left: string, right: string): number {
  const leftKey = normalizeInvoiceMerchant(left);
  const rightKey = normalizeInvoiceMerchant(right);
  if (!leftKey || !rightKey) return 0;
  if (leftKey === rightKey) return 1;

  const a = new Set(merchantTokens(left));
  const b = new Set(merchantTokens(right));
  if (!a.size || !b.size) return 0;
  if (a.size === b.size && [...a].every((token) => b.has(token))) return 1;

  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = intersection / union;
  const firstA = [...a][0];
  const firstB = [...b][0];
  const samePrincipalMerchant = firstA === firstB;
  return Math.min(1, jaccard + (samePrincipalMerchant && jaccard >= 0.75 ? 0.05 : 0));
}

export function areSimilarInvoiceMerchants(left: string, right: string): boolean {
  return invoiceMerchantSimilarity(left, right) >= SIMILARITY_THRESHOLD;
}

function readAllRules(): InvoiceCategoryRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllRules(rules: InvoiceCategoryRule[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

export function getInvoiceCategoryRules(clientId: string): InvoiceCategoryRule[] {
  return readAllRules().filter((rule) => rule.clientId === clientId);
}

export function learnInvoiceCategory(input: {
  clientId: string;
  description: string;
  category: string;
}): InvoiceCategoryRule {
  const merchantKey = merchantSignature(input.description);
  const rule: InvoiceCategoryRule = {
    clientId: input.clientId,
    merchantKey,
    merchantLabel: input.description.trim(),
    category: input.category,
    updatedAt: new Date().toISOString(),
  };
  const rules = readAllRules();
  const index = rules.findIndex(
    (item) => item.clientId === input.clientId && merchantSignature(item.merchantLabel) === merchantKey,
  );
  if (index >= 0) rules[index] = rule;
  else rules.push(rule);
  writeAllRules(rules);
  return rule;
}

export function findLearnedInvoiceCategory(
  clientId: string,
  description: string,
): InvoiceCategoryRule | null {
  const candidates = readAllRules()
    .filter((rule) => rule.clientId === clientId)
    .map((rule) => ({ rule, score: invoiceMerchantSimilarity(rule.merchantLabel, description) }))
    .filter((candidate) => candidate.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.rule.updatedAt.localeCompare(a.rule.updatedAt));
  return candidates[0]?.rule ?? null;
}
