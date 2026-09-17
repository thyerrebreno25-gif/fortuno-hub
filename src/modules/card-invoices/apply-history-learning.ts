import { findContaAzulOption, normalizeContaAzulLabel, type ContaAzulOption } from "@/modules/conta-azul/financial-export";

type PendingInvoiceItem = {
  description: string; amount: number; category: string | null; costCenter: string | null;
  status: "LEARNED" | "NEW" | "REVIEW" | "CORRECTED";
  learnedFromClient: boolean; costCenterLearnedFromClient: boolean;
};
/** Preenche pendências; nunca recategoriza um item já preenchido ou remove sua revisão. */
export function applyHistoryLearning<T extends PendingInvoiceItem>(items: T[], input: {
  findRule: (description: string) => { category: string; costCenter?: string | null } | null;
  categories: ContaAzulOption[]; useCostCenters: boolean;
}) {
  let categorized = 0, centersFilled = 0;
  const updated = items.map((item) => {
    const rule = input.findRule(item.description);
    if (!rule) return item;
    const match = findContaAzulOption(input.categories, rule.category, item.amount < 0 ? "RECEITA" : "DESPESA");
    if (!match) return item;
    const category = item.category || match.label;
    const fillsCategory = !item.category;
    const center = !item.costCenter && input.useCostCenters && rule.costCenter && normalizeContaAzulLabel(category) === normalizeContaAzulLabel(match.label)
      ? rule.costCenter : null;
    if (!fillsCategory && !center) return item;
    if (fillsCategory) categorized += 1;
    if (center) centersFilled += 1;
    return { ...item, category, costCenter: item.costCenter || center,
      learnedFromClient: fillsCategory || item.learnedFromClient,
      costCenterLearnedFromClient: !!center || item.costCenterLearnedFromClient,
      status: fillsCategory && item.status === "NEW" ? "LEARNED" as const : item.status };
  });
  return { items: updated, categorized, centersFilled };
}
