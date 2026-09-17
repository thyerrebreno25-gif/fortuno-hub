import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHistoryCandidates, type CategoryHistoryPreview } from "./category-history";
import type { AssistantMember } from "./auth";

const mocks = vi.hoisted(() => {
  const db = {
    assistantConversation: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    contaAzulConnection: { findFirst: vi.fn() },
    assistantMessage: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    categoryRule: { findMany: vi.fn(), createMany: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn(),
  };
  return { db, permissions: vi.fn(), client: vi.fn(), request: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permissions }));
vi.mock("./auth", () => ({ findAssistantClient: mocks.client }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
import { confirmCategoryHistory, continueCategoryHistory, getHistoryAccounts, getInvoiceHistoryAccounts, startCategoryHistory, startInvoiceCategoryHistory } from "./category-history-server";

const member: AssistantMember = { id: "member1", userId: "user1", organizationId: "org1", role: "OPERATOR", isTeamLeader: false,
  teamMemberUserIds: [], user: { id: "user1", name: "Operador", email: "operador@example.test" } };
function stored(): CategoryHistoryPreview {
  const records = [{ id: "p1", description: "OPENAI CHATGPT USD 20,00", allocations: [{ categoryId: "systems", category: "Sistemas", costCenterId: "admin", costCenter: "Administrativo" }] }];
  return { version: 1, revision: 1, client: { id: "client1", name: "Cliente" }, account: { id: "card1", name: "Bradesco" },
    period: { start: "2026-08-01", end: "2026-08-31", basis: "vencimento" }, createdAt: new Date().toISOString(),
    nextPage: 2, total: 1, complete: true, truncated: false, seenIds: ["p1"], skipped: 0, records, candidates: buildHistoryCandidates(records, []) };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permissions.mockResolvedValue({ ASSISTANT: { canView: true, canEdit: true }, CLIENTS: { canEdit: true } });
  mocks.db.assistantConversation.findFirst.mockResolvedValue({ id: "conversation1" });
  mocks.client.mockResolvedValue({ id: "client1", name: "Cliente" }); mocks.db.contaAzulConnection.findFirst.mockResolvedValue({ id: "connection1" });
  mocks.db.assistantMessage.findFirst.mockResolvedValue({ id: "preview1", metadata: { categoryLearningPreview: stored() } });
  mocks.db.assistantMessage.create.mockResolvedValue({ id: "preview1" }); mocks.db.assistantMessage.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.categoryRule.findMany.mockResolvedValue([]); mocks.db.categoryRule.createMany.mockResolvedValue({ count: 1 });
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
  mocks.request.mockImplementation(async (_clientId, path: string) => {
    if (path.startsWith("/v1/conta-financeira?")) return { itens: [{ id: "card1", nome: "Bradesco", ativo: true }] };
    if (path.startsWith("/v1/categorias?")) return { itens: [{ id: "systems", nome: "Sistemas", tipo: "DESPESA" }] };
    if (path.startsWith("/v1/centro-de-custo?")) return { itens: [{ id: "admin", nome: "Administrativo" }] };
    if (path.includes("/contas-a-pagar/buscar?")) return { itens_totais: 1, itens: [{ id: "p1", descricao: "OPENAI" }] };
    return { descricao: "OPENAI", evento: { tipo: "DESPESA", rateio: [{ id_categoria: "systems" }] } };
  });
});

describe("isolamento e autorização do aprendizado", () => {
  it("rejeita perfil sem edição antes de consultar qualquer dado", async () => {
    mocks.permissions.mockResolvedValue({ ASSISTANT: { canView: true, canEdit: true }, CLIENTS: { canEdit: false } });
    await expect(getHistoryAccounts(member, "conversation1", "client1")).rejects.toThrow("permissão");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("valida organização, proprietário e conversa ativa", async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(null);
    await expect(getHistoryAccounts(member, "foreignConversation", "client1")).rejects.toThrow("Conversa");
    expect(mocks.db.assistantConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "foreignConversation", organizationId: "org1", userId: "user1", status: "ACTIVE",
    } }));
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejeita cliente fora da responsabilidade do operador", async () => {
    mocks.client.mockResolvedValue(null);
    await expect(getHistoryAccounts(member, "conversation1", "foreignClient")).rejects.toThrow("responsabilidade");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("revalida cliente e conexão da prévia ao confirmar", async () => {
    mocks.db.contaAzulConnection.findFirst.mockResolvedValue(null);
    await expect(confirmCategoryHistory({ member, conversationId: "conversation1", messageId: "preview1", selections: [{ key: "OPENAI CHATGPT", categoryId: "systems" }] })).rejects.toThrow("Conecte");
    expect(mocks.db.categoryRule.createMany).not.toHaveBeenCalled();
  });
  it("rejeita prévia de outra conversa e prévia expirada", async () => {
    mocks.db.assistantMessage.findFirst.mockResolvedValue(null);
    await expect(continueCategoryHistory(member, "conversation1", "foreignMessage")).rejects.toThrow("Prévia");
    const old = stored(); old.createdAt = "2020-01-01T00:00:00Z";
    mocks.db.assistantMessage.findFirst.mockResolvedValue({ id: "preview1", metadata: { categoryLearningPreview: old } });
    await expect(continueCategoryHistory(member, "conversation1", "preview1")).rejects.toThrow("expirou");
  });
});

describe("consulta e persistência", () => {
  it("uma prévia nunca salva categorias nem escreve no Conta Azul", async () => {
    const result = await startCategoryHistory({ member, conversationId: "conversation1", clientId: "client1", accountId: "card1", start: "2026-08-01", end: "2026-08-31" });
    expect(result.preview.complete).toBe(true); expect(result.preview.processedCount).toBe(1);
    expect(mocks.request.mock.calls.some((call) => String(call[1]).includes("ids_contas_financeiras=card1") && String(call[1]).includes("data_vencimento_de=2026-08-01"))).toBe(true);
    expect(mocks.request.mock.calls.every((call) => !call[2]?.method || call[2].method === "GET")).toBe(true);
    expect(mocks.db.categoryRule.createMany).not.toHaveBeenCalled();
  });
  it("rejeita conta que não pertence ao catálogo do cliente", async () => {
    await expect(startCategoryHistory({ member, conversationId: "conversation1", clientId: "client1", accountId: "forged", start: "2026-08-01", end: "2026-08-31" })).rejects.toThrow("existente");
    expect(mocks.db.assistantMessage.create).not.toHaveBeenCalled();
  });
  it("salva regras exclusivamente no cliente da prévia e registra auditoria", async () => {
    const result = await confirmCategoryHistory({ member, conversationId: "conversation1", messageId: "preview1", selections: [{ key: "OPENAI CHATGPT", categoryId: "systems" }] });
    expect(result.savedCount).toBe(1);
    expect(mocks.db.categoryRule.createMany).toHaveBeenCalledWith({ skipDuplicates: true, data: [{ clientId: "client1", module: "CREDIT_CARD_INVOICE", normalizedDescription: "OPENAI CHATGPT", category: "Sistemas", costCenter: "Administrativo", confidence: 90 }] });
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "user1", entityId: "client1", action: "ASSISTANT_INVOICE_CATEGORIES_LEARNED" }) }));
  });
  it("preserva regras novas criadas depois da prévia", async () => {
    mocks.db.categoryRule.findMany.mockResolvedValue([{ normalizedDescription: "OPENAI CHATGPT", category: "Marketing" }]);
    mocks.db.categoryRule.createMany.mockResolvedValue({ count: 0 });
    expect((await confirmCategoryHistory({ member, conversationId: "conversation1", messageId: "preview1", selections: [{ key: "OPENAI CHATGPT", categoryId: "systems" }] })).savedCount).toBe(0);
    expect(mocks.db.categoryRule.createMany).toHaveBeenCalledWith({ data: [], skipDuplicates: true });
  });
  it("não salva se outra aba atualizou a prévia", async () => {
    mocks.db.assistantMessage.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmCategoryHistory({ member, conversationId: "conversation1", messageId: "preview1", selections: [{ key: "OPENAI CHATGPT", categoryId: "systems" }] })).rejects.toThrow("atualizada");
    expect(mocks.db.categoryRule.createMany).not.toHaveBeenCalled();
  });
  it("repetir a confirmação não cria regras nem repete consultas", async () => {
    const saved = { ...stored(), savedAt: new Date().toISOString(), savedCount: 1 };
    mocks.db.assistantMessage.findFirst.mockResolvedValue({ id: "preview1", metadata: { categoryLearningPreview: saved } });
    expect(await confirmCategoryHistory({ member, conversationId: "conversation1", messageId: "preview1", selections: [] })).toMatchObject({ savedCount: 1, alreadySaved: true, preview: { savedCount: 1 } });
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.db.categoryRule.createMany).not.toHaveBeenCalled();
  });
});

describe("aprendizado na página de faturas", () => {
  beforeEach(() => {
    mocks.permissions.mockResolvedValue({ IMPORTS: { canView: true, canImport: true, canEdit: false }, ASSISTANT: { canView: false, canEdit: false }, CLIENTS: { canEdit: true } });
    mocks.db.assistantConversation.create.mockResolvedValue({ id: "invoice-session" });
    mocks.db.assistantMessage.findFirst.mockResolvedValue({ id: "preview1", metadata: { categoryLearningSurface: "INVOICE", categoryLearningPreview: stored() } });
  });
  it("consulta e salva pelas permissões de importação sem exigir acesso à assistente", async () => {
    expect(await getInvoiceHistoryAccounts(member, "client1")).toEqual([{ id: "card1", name: "Bradesco" }]);
    const result = await startInvoiceCategoryHistory({ member, clientId: "client1", accountId: "card1", start: "2026-08-01", end: "2026-08-31" });
    expect(result.conversationId).toBe("invoice-session");
    expect(mocks.db.assistantConversation.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      userId: "user1", organizationId: "org1", clientId: "client1", title: "Aprendizado de faturas", status: "ARCHIVED",
    } }));
    const confirmed = await confirmCategoryHistory({ member, conversationId: "invoice-session", messageId: "preview1", clientId: "client1", surface: "INVOICE", selections: [{ key: "OPENAI CHATGPT", categoryId: "systems" }] });
    expect(confirmed.preview.savedCount).toBe(1);
    expect(mocks.request.mock.calls.every((call) => !call[2]?.method || call[2].method === "GET")).toBe(true);
  });
  it("rejeita aprendizado sem permissão de importação", async () => {
    mocks.permissions.mockResolvedValue({ IMPORTS: { canView: true, canImport: false, canEdit: false }, CLIENTS: { canEdit: true } });
    await expect(getInvoiceHistoryAccounts(member, "client1")).rejects.toThrow("permissão");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("não aceita sessão de outro proprietário, cliente ou superfície", async () => {
    mocks.db.assistantConversation.findFirst.mockResolvedValue(null);
    await expect(continueCategoryHistory(member, "foreign", "preview1", "INVOICE", "client1")).rejects.toThrow("Conversa");
    expect(mocks.db.assistantConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: "foreign", organizationId: "org1", userId: "user1", status: "ARCHIVED", title: "Aprendizado de faturas", clientId: "client1",
    } }));
    mocks.db.assistantConversation.findFirst.mockResolvedValue({ id: "invoice-session" });
    await expect(continueCategoryHistory(member, "invoice-session", "preview1", "INVOICE", "client2")).rejects.toThrow("Prévia");
    mocks.db.assistantMessage.findFirst.mockResolvedValue({ id: "preview1", metadata: { categoryLearningPreview: stored() } });
    await expect(continueCategoryHistory(member, "invoice-session", "preview1", "INVOICE", "client1")).rejects.toThrow("Prévia");
    expect(mocks.db.categoryRule.createMany).not.toHaveBeenCalled();
  });
});
