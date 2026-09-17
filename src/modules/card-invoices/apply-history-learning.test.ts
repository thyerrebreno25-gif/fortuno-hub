import { describe, expect, it } from "vitest";
import { applyHistoryLearning } from "./apply-history-learning";
import { invoiceMerchantSimilarity } from "./category-learning";
import type { ContaAzulOption } from "@/modules/conta-azul/financial-export";
const categories: ContaAzulOption[] = [{ value: "systems", label: "Sistemas", type: "DESPESA" }, { value: "marketing", label: "Marketing", type: "DESPESA" }];
const item = { id: 1, description: "OPEN IA USD 50,00", amount: 100, category: null as string | null, costCenter: null as string | null,
  status: "NEW" as const, learnedFromClient: false, costCenterLearnedFromClient: false };
const config = { categories, useCostCenters: true, findRule: (description: string) => invoiceMerchantSimilarity(description, "OPENAI USD 20,00") >= 0.62 ? { category: "Sistemas", costCenter: "Administrativo" } : null };
describe("aplicar aprendizado à fatura já aberta", () => {
  it("aplica regra aprendida apesar de valores diferentes na descrição", () => {
    const result = applyHistoryLearning([item], config);
    expect(result.categorized).toBe(1); expect(result.centersFilled).toBe(1);
    expect(result.items[0]).toMatchObject({ category: "Sistemas", costCenter: "Administrativo", status: "LEARNED", learnedFromClient: true });
  });
  it("preserva categorias editadas e centro de custo já preenchido", () => {
    const edited = { ...item, category: "Marketing", costCenter: "Comercial", status: "CORRECTED" as const };
    const result = applyHistoryLearning([edited], config);
    expect(result.items[0]).toBe(edited); expect(result.categorized).toBe(0); expect(result.centersFilled).toBe(0);
  });
  it("aprendizado de categoria preserva a conta já escolhida no rateio", () => {
    const allocated = { ...item, financialAccountId: "account-y", financialAccountName: "Conta Y" };
    expect(applyHistoryLearning([allocated], config).items[0]).toMatchObject({ category: "Sistemas", financialAccountId: "account-y", financialAccountName: "Conta Y" });
  });
  it("não usa centro de uma regra de categoria diferente", () => {
    expect(applyHistoryLearning([{ ...item, category: "Marketing" }], config).items[0].costCenter).toBeNull();
  });
  it("não remove necessidade de revisão do lançamento", () => {
    expect(applyHistoryLearning([{ ...item, status: "REVIEW" as const }], config).items[0]).toMatchObject({ category: "Sistemas", status: "REVIEW" });
  });
  it("não mistura tipo de receita e despesa nem categorias ausentes no catálogo CA", () => {
    expect(applyHistoryLearning([{ ...item, amount: -100 }], config).categorized).toBe(0);
    expect(applyHistoryLearning([item], { ...config, categories: [] }).categorized).toBe(0);
  });
  it("não preenche centro quando a opção não está ativa e pode reaplicar sem alterar itens", () => {
    const first = applyHistoryLearning([item], { ...config, useCostCenters: false });
    expect(first.items[0].costCenter).toBeNull();
    const second = applyHistoryLearning(first.items, { ...config, useCostCenters: false });
    expect(second.categorized).toBe(0); expect(second.items).toEqual(first.items);
  });
});
