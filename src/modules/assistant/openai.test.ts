import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./tools", () => ({ ASSISTANT_TOOL_DEFINITIONS: [], executeAssistantTool: vi.fn() }));
import { runFortunoAssistant, OpenAIRequestError } from "./openai";
import { executeAssistantTool } from "./tools";
import type { AssistantMember } from "./auth";
const member: AssistantMember = { id: "m", userId: "u", organizationId: "o", role: "OPERATOR", isTeamLeader: false,
  teamMemberUserIds: [], user: { id: "u", name: "Teste", email: "test@example.test" } };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("OPENAI_API_KEY", "fake-test-key"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function request(history?: Parameters<typeof runFortunoAssistant>[0]["history"]) {
  return runFortunoAssistant({ context: { member, conversationId: "c" }, prompt: "Teste", files: [], previousResponseId: "old", history });
}
function response(body: unknown, headers?: HeadersInit) { return new Response(JSON.stringify(body), { headers }); }
function toolCall(id: string, name = "audit_client_financials", args = '{"client_id":"client1"}') {
  return response({ id, output: [{ type: "function_call", call_id: `call_${id}`, name, arguments: args }] });
}
function payload(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) {
  return JSON.parse(String(fetchMock.mock.calls[index][1]?.body));
}
describe("limites da OpenAI na assistente", () => {
  it("não repete 429 e preserva diagnóstico sem expor erro bruto", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: {
      message: "Rate limit reached for organization org-private", code: "rate_limit_exceeded",
    } }), { status: 429, headers: { "retry-after": "30", "x-request-id": "req_test" } }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await request().catch((error: unknown) => error) as OpenAIRequestError;
    expect(error).toBeInstanceOf(OpenAIRequestError); expect(error.message).toContain("30 segundo");
    expect(JSON.stringify(error)).not.toContain("org-private");
    expect(error.details).toMatchObject({ kind: "rate_limit", code: "rate_limit_exceeded", requestId: "req_test" });
    expect(error.usage?.requests).toBe(1); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["insufficient_quota", "credit_balance_exhausted", "project_spend_limit_exceeded", "organization_spend_limit_exceeded", "organization_usage_limit_exceeded"])("não trata %s como temporário nem reenvia", async (code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await request().catch((error: unknown) => error) as OpenAIRequestError;
    expect(error.details.kind).not.toBe("rate_limit"); expect(error.message).not.toContain("Aguarde");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("não reusa cadeia antiga nem tenta recuperar respostas antigas", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ id: "new", output_text: "Olá!" }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await request([{ role: "USER", content: "Como funciona?" }, { role: "ASSISTANT", content: "Assim..." }])).text).toBe("Olá!");
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(payload(fetchMock, 0).previous_response_id).toBeUndefined();
    expect(payload(fetchMock, 0).input[0]).toEqual({ role: "user", content: "Como funciona?" });
  });
});

describe("contexto e consultas limitados por pergunta", () => {
  it("compacta resultados, preserva totais e continua somente a resposta atual", async () => {
    vi.mocked(executeAssistantTool).mockResolvedValue({ count: 200, amount: 45678.90,
      items: Array.from({ length: 200 }, (_, id) => ({ id, description: "Despesa".repeat(100), amount: 1 })) } as never);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(toolCall("current"))
      .mockResolvedValueOnce(response({ id: "final", output_text: "Auditoria preliminar." }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await request(); const second = payload(fetchMock, 1);
    expect(second.previous_response_id).toBe("current"); expect(second.input[0].output.length).toBeLessThanOrEqual(12000);
    const data = JSON.parse(second.input[0].output);
    expect(data.data.count).toBe(200); expect(data.data.amount).toBe(45678.90); expect(data.contextLimits.truncated).toBe(true);
    expect(result.consultedClientIds).toEqual(["client1"]);
  });
  it("reaproveita a mesma consulta em uma pergunta sem duplicar efeitos", async () => {
    vi.mocked(executeAssistantTool).mockResolvedValue({ code: "SUP-123" } as never);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(toolCall("one", "create_support_ticket", '{"subject":"Teste","priority":"LOW"}'))
      .mockResolvedValueOnce(toolCall("two", "create_support_ticket", '{"priority":"LOW","subject":"Teste"}'))
      .mockResolvedValueOnce(response({ id: "final", output_text: "Chamado criado." }));
    vi.stubGlobal("fetch", fetchMock); await request();
    expect(executeAssistantTool).toHaveBeenCalledTimes(1);
    expect(JSON.parse(payload(fetchMock, 2).input[0].output).reused).toBe(true);
    expect(payload(fetchMock, 2).tool_choice).toBe("none");
  });
  it("registra tokens reais de todas as etapas sem guardar prompts", async () => {
    vi.mocked(executeAssistantTool).mockResolvedValue([]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ id: "one", usage: {
      input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 20 },
    }, output: [{ type: "function_call", call_id: "call", name: "search_clients", arguments: "{}" }] }, { "x-request-id": "req_one" }))
      .mockResolvedValueOnce(response({ id: "two", output_text: "Resposta", usage: {
        input_tokens: 150, output_tokens: 15, total_tokens: 165,
      } }, { "x-request-id": "req_two" }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await request()).usage).toEqual({ model: "gpt-5.6-luna", requests: 2, inputTokens: 250,
      outputTokens: 25, totalTokens: 275, cachedInputTokens: 20, requestIds: ["req_one", "req_two"] });
  });
  it("mantém consumo parcial ao falhar numa continuação sem reenviar", async () => {
    vi.mocked(executeAssistantTool).mockResolvedValue([]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ id: "one", usage: { input_tokens: 100, total_tokens: 100 },
      output: [{ type: "function_call", call_id: "call", name: "search_clients", arguments: "{}" }] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "credit_balance_exhausted" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await request().catch((error: unknown) => error) as OpenAIRequestError;
    expect(error.usage).toMatchObject({ requests: 2, inputTokens: 100 }); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("limita a quatro etapas de ferramentas e exige resposta final", async () => {
    vi.mocked(executeAssistantTool).mockResolvedValue([]);
    const fetchMock = vi.fn<typeof fetch>();
    for (let i = 0; i < 5; i += 1) fetchMock.mockResolvedValueOnce(toolCall(`r${i}`, "search_clients", JSON.stringify({ query: `q${i}` })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(request()).rejects.toThrow("etapas demais");
    expect(executeAssistantTool).toHaveBeenCalledTimes(4); expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(payload(fetchMock, 4).tool_choice).toBe("none");
  });
  it("limita o conjunto das saídas mesmo com múltiplas ferramentas em cada etapa", async () => {
    vi.mocked(executeAssistantTool).mockResolvedValue({ count: 100,
      items: Array.from({ length: 100 }, (_, i) => ({ id: String(i), description: "z".repeat(600) })) } as never);
    const fetchMock = vi.fn<typeof fetch>();
    for (let i = 0; i < 5; i += 1) {
      fetchMock.mockResolvedValueOnce(response({ id: `r${i}`, output: Array.from({ length: 4 }, (_, j) => ({
        type: "function_call", call_id: `c${i}_${j}`, name: "search_clients", arguments: JSON.stringify({ query: `q${i}_${j}` }),
      })) }));
    }
    vi.stubGlobal("fetch", fetchMock);
    await expect(request()).rejects.toThrow("etapas demais");
    const outputs = fetchMock.mock.calls.slice(1).flatMap((_call, i) => payload(fetchMock, i + 1).input);
    expect(outputs.reduce((sum, item) => sum + item.output.length, 0)).toBeLessThanOrEqual(24000);
    expect(payload(fetchMock, fetchMock.mock.calls.length - 1).tool_choice).toBe("none");
  });
});
