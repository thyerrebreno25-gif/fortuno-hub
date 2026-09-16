import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./tools", () => ({ ASSISTANT_TOOL_DEFINITIONS: [], executeAssistantTool: vi.fn() }));
import { runFortunoAssistant } from "./openai";
import type { AssistantMember } from "./auth";
const member: AssistantMember = { id: "m", userId: "u", organizationId: "o", role: "OPERATOR", isTeamLeader: false,
  teamMemberUserIds: [], user: { id: "u", name: "Teste", email: "test@example.test" } };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function request() { return runFortunoAssistant({ context: { member, conversationId: "c" }, prompt: "Teste", files: [], previousResponseId: "old" }); }
describe("limites da OpenAI na assistente", () => {
  it("não repete imediatamente 429 e não expõe organização nem erro técnico", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-test-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Rate limit reached for organization org-private", code: "rate_limit_exceeded" } }), { status: 429, headers: { "retry-after": "30" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(request()).rejects.toThrow("30 segundo"); expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(request()).rejects.not.toThrow("org-private");
  });
  it("diferencia cota esgotada de limite temporário sem novas tentativas", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-test-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(request()).rejects.toThrow("cobrança"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("só reinicia sem histórico quando a resposta anterior não existe", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-test-key");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "previous_response_not_found" } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "new", output_text: "Olá!" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await request()).text).toBe("Olá!"); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).previous_response_id).toBeUndefined();
  });
});
