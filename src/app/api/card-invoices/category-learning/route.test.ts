import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), accounts: vi.fn(), start: vi.fn(), continue: vi.fn(), confirm: vi.fn() }));
vi.mock("@/modules/assistant/auth", () => ({ getInvoiceHistoryMember: mocks.member }));
vi.mock("@/modules/assistant/category-history-server", () => ({
  CategoryHistoryError: class extends Error { constructor(message: string, public status = 400) { super(message); } },
  getInvoiceHistoryAccounts: mocks.accounts, startInvoiceCategoryHistory: mocks.start,
  continueCategoryHistory: mocks.continue, confirmCategoryHistory: mocks.confirm,
}));
import { CategoryHistoryError } from "@/modules/assistant/category-history-server";
import { GET, POST } from "./route";
const member = { userId: "u1", organizationId: "org1" };
const request = (body: unknown) => new Request("http://localhost/api/card-invoices/category-learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.member.mockResolvedValue(member); });
describe("API de aprendizado na fatura sem IA", () => {
  it("exige autenticação antes de consultar contas ou criar prévia", async () => {
    mocks.member.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/card-invoices/category-learning?clientId=c1"))).status).toBe(401);
    expect((await POST(request({ action: "preview" }))).status).toBe(401);
    expect(mocks.accounts).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("consulta contas do cliente pela autorização de importações", async () => {
    mocks.accounts.mockResolvedValue([{ id: "card1", name: "Bradesco" }]);
    const result = await (await GET(new Request("http://localhost/api/card-invoices/category-learning?clientId=c1"))).json();
    expect(result.accounts).toHaveLength(1); expect(mocks.accounts).toHaveBeenCalledWith(member, "c1");
  });
  it("não aceita superfície/permissão fornecida pelo navegador", async () => {
    expect((await POST(request({ action: "preview", clientId: "c1", accountId: "card1", start: "2026-08-01", end: "2026-08-31", surface: "ASSISTANT" }))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("retoma sessão mantendo identificação explícita do cliente", async () => {
    mocks.continue.mockResolvedValue({ preview: { complete: true } });
    const result = await POST(request({ action: "continue", clientId: "c1", conversationId: "s1", messageId: "m1" }));
    expect(result.status).toBe(200);
    expect(mocks.continue).toHaveBeenCalledWith(member, "s1", "m1", "INVOICE", "c1");
  });
  it("confirma somente seleções explícitas e usa superfície fixa no servidor", async () => {
    mocks.confirm.mockResolvedValue({ savedCount: 1, preview: { savedAt: "2026-09-17" } });
    const body = { action: "confirm", clientId: "c1", conversationId: "s1", messageId: "m1", selections: [{ key: "OPENAI", categoryId: "sys" }] };
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.confirm).toHaveBeenCalledWith({ ...body, member, surface: "INVOICE" });
    expect((await POST(request({ ...body, selections: [] }))).status).toBe(400);
  });
  it("retorna a negativa de permissão do serviço sem contornar autorização", async () => {
    mocks.accounts.mockRejectedValue(new CategoryHistoryError("Sem permissão", 403));
    expect((await GET(new Request("http://localhost/api/card-invoices/category-learning?clientId=c1"))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
