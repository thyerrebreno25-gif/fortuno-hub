import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAIRequestError } from "@/modules/assistant/openai-errors";

const mocks = vi.hoisted(() => ({
  db: { assistantConversation: { findFirst: vi.fn(), update: vi.fn() }, assistantMessage: { create: vi.fn() }, $transaction: vi.fn() },
  member: vi.fn(), client: vi.fn(), run: vi.fn(), inspect: vi.fn(), upload: vi.fn(), ticket: vi.fn(), execute: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/modules/assistant/auth", () => ({ getAssistantMember: mocks.member, findAssistantClient: mocks.client }));
vi.mock("@/modules/assistant/files", () => ({ inspectAssistantFile: mocks.inspect, uploadAssistantFileToOpenAI: mocks.upload }));
vi.mock("@/modules/assistant/tools", () => ({ createAssistantSupportTicket: mocks.ticket, executeAssistantTool: mocks.execute }));
vi.mock("@/modules/assistant/openai", async () => ({
  OpenAIRequestError: (await import("@/modules/assistant/openai-errors")).OpenAIRequestError, runFortunoAssistant: mocks.run,
}));
import { POST } from "./route";

const usage = { model: "gpt-5.6-luna", requests: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 0, requestIds: ["req_test"] };
const member = { organizationId: "org1", userId: "user1" };
let conversation: { id: string; title: string; clientId: string | null; client: { id: string; name: string } | null;
  messages: Array<{ role: string; content: string; metadata?: unknown; attachments?: unknown }> };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("OPENAI_API_KEY", "fake-test-key"); vi.spyOn(console, "warn").mockImplementation(() => {});
  conversation = { id: "c1", title: "Nova conversa", clientId: null, client: null, messages: [] };
  mocks.member.mockResolvedValue(member); mocks.db.assistantConversation.findFirst.mockImplementation(async () => conversation);
  mocks.client.mockResolvedValue({ id: "client1", name: "Cliente" });
  mocks.db.assistantMessage.create.mockImplementation(async ({ data }) => ({ id: data.role === "USER" ? "user-msg" : "assistant-msg", ...data }));
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
  mocks.run.mockResolvedValue({ text: "Resposta", responseId: "current", toolEvents: [], usage, consultedClientIds: ["client1"] });
  mocks.inspect.mockImplementation(async (file: File) => ({ name: file.name, type: file.type, size: file.size }));
  mocks.upload.mockResolvedValue("file_test");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function send(files: File[] = [], mode: string | null = "AI", message = "Pergunta atual") {
  const form = new FormData(); form.set("message", message);
  if (mode) form.set("mode", mode);
  files.forEach((file) => form.append("files", file));
  return POST(new Request("http://localhost/api/assistant/conversations/c1/messages", { method: "POST", body: form }), { params: Promise.resolve({ id: "c1" }) });
}

describe("contexto e diagnóstico persistidos da assistente", () => {
  it("usa somente histórico recente da conversa pertencente ao usuário e registra consumo", async () => {
    conversation.messages = [{ role: "ASSISTANT", content: "Resposta anterior" }, { role: "USER", content: "Pergunta anterior" }];
    const body = await (await send()).json();
    expect(mocks.db.assistantConversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "c1", organizationId: "org1", userId: "user1", status: "ACTIVE" },
      select: expect.objectContaining({ messages: expect.objectContaining({ take: 8 }) }),
    }));
    expect(mocks.run.mock.calls[0][0].history.map((message: { content: string }) => message.content)).toEqual(["Pergunta anterior", "Resposta anterior"]);
    expect(mocks.run.mock.calls[0][0].previousResponseId).toBeUndefined();
    expect(body.assistantMessage.metadata.openAiUsage).toEqual(usage);
    expect(body.assistantMessage.metadata.consultedClientIds).toEqual(["client1"]);
  });
  it("salva o código e request ID sem expor a mensagem bruta nem manter a cadeia antiga", async () => {
    const error = openAIRequestError(429, { code: "credit_balance_exhausted", message: "org-private secret-key" }, new Headers({ "x-request-id": "req_fail" }));
    error.usage = usage; mocks.run.mockRejectedValue(error);
    const body = await (await send()).json();
    expect(body.assistantMessage.content).toContain("saldo");
    expect(body.assistantMessage.metadata.openAiError).toMatchObject({ kind: "credits", code: "credit_balance_exhausted", requestId: "req_fail" });
    expect(body.assistantMessage.metadata.openAiUsage).toEqual(usage);
    expect(JSON.stringify(body)).not.toContain("org-private");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret-key");
    expect(mocks.db.assistantConversation.update.mock.calls[0][0].data.lastOpenAiResponseId).toBeNull();
  });
  it("revalida clientes consultados anteriormente antes de enviar contexto à API", async () => {
    conversation.messages = [{ role: "ASSISTANT", content: "Dados privados", metadata: { consultedClientIds: ["old-client"] } }];
    mocks.client.mockResolvedValue(null);
    expect((await send()).status).toBe(403); expect(mocks.client).toHaveBeenCalledWith(member, "old-client");
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.db.assistantMessage.create).not.toHaveBeenCalled();
  });
  it("revalida o cliente de uma prévia de aprendizado sem repassar snapshot interno", async () => {
    conversation.messages = [{ role: "ASSISTANT", content: "Prévia", metadata: { categoryLearningPreview: { client: { id: "preview-client" } } } }];
    mocks.client.mockResolvedValue(null);
    expect((await send()).status).toBe(403); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("não reenvia uploads nem consulta a API depois de um bloqueio ao anexar arquivo", async () => {
    mocks.upload.mockRejectedValue(openAIRequestError(429, { code: "project_spend_limit_exceeded", message: "org-private" }, new Headers()));
    const body = await (await send([new File(["a"], "one.pdf", { type: "application/pdf" }), new File(["b"], "two.pdf", { type: "application/pdf" })])).json();
    expect(mocks.upload).toHaveBeenCalledTimes(1); expect(mocks.inspect).toHaveBeenCalledTimes(2);
    expect(mocks.run).not.toHaveBeenCalled(); expect(body.assistantMessage.metadata.openAiError.kind).toBe("spend_limit");
    expect(JSON.stringify(body)).not.toContain("org-private");
  });
  it("permanece funcional sem uma chave OpenAI e sem consumo da API", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const body = await (await send()).json();
    expect(body.assistantMessage.content).toContain("Atendi pelo modo interno");
    expect(mocks.run).not.toHaveBeenCalled(); expect(body.assistantMessage.metadata.openAiUsage).toBeUndefined();
  });
  it("não lê histórico nem envia informações sem autenticação", async () => {
    mocks.member.mockResolvedValue(null);
    expect((await send()).status).toBe(401); expect(mocks.db.assistantConversation.findFirst).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("o padrão não utiliza OpenAI nem envia anexos mesmo com chave configurada", async () => {
    const body = await (await send([new File(["a"], "one.pdf", { type: "application/pdf" })], null, "Leia esta fatura")).json();
    expect(body.assistantMessage.metadata.executionMode).toBe("INTERNAL");
    expect(body.assistantMessage.content).toContain("Nenhum lançamento financeiro foi enviado");
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
    expect(body.assistantMessage.metadata.openAiUsage).toBeUndefined();
  });
  it("faz consulta por ferramenta autorizada e salva relatório interno sem consumo", async () => {
    conversation.clientId = "client1"; conversation.client = { id: "client1", name: "Cliente" };
    mocks.execute.mockResolvedValue({ source: { queriedAt: "2026-09-17T12:00:00Z" }, payables: { count: 2, amount: 50 }, receivables: { count: 1, amount: 100 } });
    const body = await (await send([], "INTERNAL", "Relatório financeiro deste cliente em agosto de 2026")).json();
    expect(mocks.execute).toHaveBeenCalledWith({ member, conversationId: "c1" }, "audit_client_financials", JSON.stringify({ client_id: "client1", period_start: "2026-08-01", period_end: "2026-08-31" }));
    expect(body.assistantMessage.metadata.reportTitle).toContain("Relatório financeiro");
    expect(body.assistantMessage.metadata.consultedClientIds).toEqual(["client1"]);
    expect(body.assistantMessage.metadata.executionMode).toBe("INTERNAL"); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("não cai automaticamente na IA quando não reconhece uma pergunta", async () => {
    const body = await (await send([], null, "qual é a capital da Alemanha?")).json();
    expect(body.assistantMessage.content).toContain("somente quando você ativar");
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("rejeita modo arbitrário", async () => {
    expect((await send([], "OTHER")).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.db.assistantMessage.create).not.toHaveBeenCalled();
  });
});
