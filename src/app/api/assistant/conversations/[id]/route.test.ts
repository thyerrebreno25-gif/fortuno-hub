import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), client: vi.fn(), conversation: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { assistantConversation: { findFirst: mocks.conversation } } }));
vi.mock("@/modules/assistant/auth", () => ({ getAssistantMember: mocks.member, findAssistantClient: mocks.client }));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "c1" }) };
beforeEach(() => { vi.resetAllMocks(); mocks.member.mockResolvedValue({ userId: "u1", organizationId: "org1" }); mocks.client.mockResolvedValue({ id: "client1" }); });
describe("leitura de relatórios e conversas", () => {
  it("revalida cliente consultado por nome que não era o selecionado na conversa", async () => {
    mocks.conversation.mockResolvedValue({ id: "c1", clientId: "client1", messages: [{ role: "ASSISTANT", content: "Dados de outro cliente", metadata: { consultedClientIds: ["client2"] } }] });
    mocks.client.mockImplementation(async (_member, id) => id === "client1" ? { id } : null);
    const result = await GET(new Request("http://localhost/api/assistant/conversations/c1"), context);
    expect(result.status).toBe(403); expect(JSON.stringify(await result.json())).not.toContain("Dados de outro cliente");
  });
  it("retorna relatório interno somente se o acesso atual permanece válido", async () => {
    mocks.conversation.mockResolvedValue({ id: "c1", clientId: null, messages: [{ role: "ASSISTANT", content: "Relatório", metadata: { consultedClientIds: ["client1"], reportTitle: "Resumo", executionMode: "INTERNAL" } }] });
    const result = await GET(new Request("http://localhost/api/assistant/conversations/c1"), context);
    expect(result.status).toBe(200);
    expect(mocks.conversation).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", organizationId: "org1", userId: "u1" } }));
    expect(mocks.client).toHaveBeenCalledWith({ userId: "u1", organizationId: "org1" }, "client1");
  });
});
