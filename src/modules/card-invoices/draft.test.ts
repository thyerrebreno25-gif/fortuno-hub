import { describe, expect, it } from "vitest";
import { invoiceDraftKey, readInvoiceDraft, restoreInvoiceItem, type InvoiceDraft, type InvoiceItem } from "./draft";

const item: InvoiceItem = {
  id: 2, date: "2026-10-01", description: "Compra parcelada", amount: 125.5,
  installment: "2/3", category: "Materiais", costCenter: "Administrativo",
  financialAccountId: "account-1", financialAccountName: "Banco",
  destinationClientId: "client-2", destinationClientName: "Destino",
  status: "CORRECTED", learnedFromClient: true, costCenterLearnedFromClient: true,
};
const draft: InvoiceDraft = {
  version: 1, savedAt: "2026-10-16T12:00:00.000Z", clientId: "client-1", bank: "Banco Inter",
  sourceFiles: [{ name: "fatura.pdf", type: "application/pdf", size: 1234, lastModified: 123 }],
  items: [item], deletedItems: [], competenceDate: "2026-10-01", dueDate: "2026-10-20",
  paymentDate: "2026-10-20", invoiceTotal: "125,50", parseWarnings: ["Revisar total"],
  useCostCenters: true, useLineAccounts: true, defaultAccountId: "account-1", defaultDestinationId: "client-2",
  search: "Compra", showOnlyUncategorized: false, selectedItem: { ...item, category: "Em edição" },
  editModalOpened: true, learnForClient: false,
};

describe("recuperação da fatura", () => {
  it("preserva classificação, rateio, datas, origem e edição aberta após serialização", () => {
    expect(readInvoiceDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it("recupera até uma fatura com todos os lançamentos excluídos", () => {
    const recovered = readInvoiceDraft(JSON.stringify({ ...draft, items: [], deletedItems: [item] }))!;
    const restored = restoreInvoiceItem(recovered.items, recovered.deletedItems, item.id);
    expect(restored).toEqual({ items: [item], deletedItems: [] });
  });
  it("restaura a linha sem desfazer alterações posteriores nas outras linhas", () => {
    const edited = { ...item, id: 1, category: "Categoria nova" };
    expect(restoreInvoiceItem([edited], [item], 2)).toEqual({ items: [edited, item], deletedItems: [] });
  });
  it("não duplica um lançamento ao restaurar novamente", () => {
    expect(restoreInvoiceItem([item], [item], 2)).toEqual({ items: [item], deletedItems: [] });
  });
  it("separa contas e organizações, inclusive IDs com separadores", () => {
    expect(new Set([invoiceDraftKey("a", "b"), invoiceDraftKey("a", "c"), invoiceDraftKey("b", "b"), invoiceDraftKey("a:b", "c"), invoiceDraftKey("a", "b:c")]).size).toBe(5);
  });
  it("não restaura dados danificados ou de versão desconhecida", () => {
    expect(readInvoiceDraft(null)).toBeNull();
    expect(() => readInvoiceDraft("{" )).toThrow();
    expect(() => readInvoiceDraft(JSON.stringify({ ...draft, version: 2 }))).toThrow();
    expect(() => readInvoiceDraft(JSON.stringify({ ...draft, sourceFiles: [] }))).toThrow();
    expect(() => readInvoiceDraft(JSON.stringify({ ...draft, items: [{ ...item, amount: "inválido" }] }))).toThrow();
  });
  it("não inclui senhas ou conteúdo binário do arquivo no rascunho validado", () => {
    expect(readInvoiceDraft(JSON.stringify({ ...draft, password: "secret", files: ["binary"] }))).toEqual(draft);
  });
});
