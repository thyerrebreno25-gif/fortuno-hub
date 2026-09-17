import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMember } from "./auth";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), client: vi.fn(), connection: vi.fn(), request: vi.fn(), count: vi.fn(), imports: vi.fn() }));
const { findMany } = mocks;
vi.mock("@/lib/prisma", () => ({ prisma: {
  client: { findMany: mocks.findMany, findFirst: mocks.client }, contaAzulConnection: { findFirst: mocks.connection },
  operationActivity: { count: mocks.count }, audit: { count: mocks.count }, auditFinding: { count: mocks.count }, importJob: { findMany: mocks.imports },
} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/modules/notifications/email/support-email", () => ({ sendNewSupportTicketEmail: vi.fn() }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
import { executeAssistantTool } from "./tools";
const member: AssistantMember = { id: "m1", userId: "u1", organizationId: "org1", role: "OPERATOR", isTeamLeader: false, teamMemberUserIds: [], user: { id: "u1", name: "Operador", email: "operator@example.test" } };
beforeEach(() => { vi.resetAllMocks(); findMany.mockResolvedValue([]); });
describe("escopo da busca de clientes", () => {
  it("combina filtro pelo nome/documento com responsabilidade, sem substituir seu OR", async () => {
    await executeAssistantTool({ member, conversationId: "c1" }, "search_clients", JSON.stringify({ query: "Tripé" }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe("org1"); expect(where.active).toBe(true);
    expect(where.AND[0].OR).toHaveLength(4);
    expect(where.AND[0].OR[0]).toEqual({ operationLeaderId: { in: ["u1"] } });
    expect(where.AND[1].OR[0]).toEqual({ name: { contains: "Tripé", mode: "insensitive" } });
    expect(where.OR).toBeUndefined();
  });
  it("líder inclui somente equipe no escopo e gestor continua na própria organização", async () => {
    await executeAssistantTool({ member: { ...member, isTeamLeader: true, teamMemberUserIds: ["u2"] }, conversationId: "c1" }, "search_clients", "{}");
    expect(findMany.mock.calls[0][0].where.AND[0].OR[0]).toEqual({ operationLeaderId: { in: ["u1", "u2"] } });
    await executeAssistantTool({ member: { ...member, role: "MANAGER" }, conversationId: "c1" }, "search_clients", "{}");
    expect(findMany.mock.calls[1][0].where).toEqual({ organizationId: "org1", active: true, AND: [{}] });
  });
});

describe("dados financeiros do relatório interno", () => {
  beforeEach(() => {
    mocks.client.mockResolvedValue({ id: "client1", name: "Cliente" });
    mocks.connection.mockResolvedValue({ id: "connection", externalTenantName: "Cliente CA" });
    mocks.count.mockResolvedValue(0); mocks.imports.mockResolvedValue([]);
  });
  it("não transforma valor ausente em zero nem apresenta soma incompleta como total", async () => {
    mocks.request.mockImplementation(async (_client, path: string) => path.includes("contas-a-pagar") ? { itens: [
      { id: "p1", valor: 100, status: "PENDENTE", data_vencimento: "2026-01-01" },
      { id: "p2", status: "PENDENTE", data_vencimento: "2026-01-01" },
    ] } : { itens: [] });
    const result = await executeAssistantTool({ member, conversationId: "c1" }, "audit_client_financials", JSON.stringify({ client_id: "client1", period_start: "2026-01-01", period_end: "2026-01-31" })) as { payables: { count: number; amount: number | null; missingAmountCount: number; overdueAmount: number | null; items: { amount: number | null }[] } };
    expect(result.payables).toMatchObject({ count: 2, amount: null, missingAmountCount: 1, overdueAmount: null });
    expect(result.payables.items[1].amount).toBeNull();
    expect(mocks.connection).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: "client1", organizationId: "org1", active: true, status: "CONNECTED" } }));
  });
  it("nega cliente fora do acesso antes de consultar qualquer informação externa", async () => {
    mocks.client.mockResolvedValue(null);
    await expect(executeAssistantTool({ member, conversationId: "c1" }, "audit_client_financials", JSON.stringify({ client_id: "foreign", period_start: "2026-01-01", period_end: "2026-01-31" }))).rejects.toThrow("responsabilidade");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
