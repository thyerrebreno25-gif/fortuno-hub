import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/modules/acquirers/parse-acquirer-workbook", () => ({ parseAcquirerWorkbook: vi.fn() }));
import { uploadAssistantFileToOpenAI } from "./files";
import { OpenAIRequestError } from "./openai-errors";

afterEach(() => vi.unstubAllGlobals());
describe("preparo de anexos da assistente", () => {
  it("retorna o ID do arquivo preparado", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "file_test" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await uploadAssistantFileToOpenAI(new File(["test"], "fatura.pdf"), "fake-test-key")).toBe("file_test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("distingue falta de saldo no upload e mantém o diagnóstico seguro sem reenvio", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: "credit_balance_exhausted", message: "org-private secret-key",
    } }), { status: 429, headers: { "x-request-id": "req_upload" } }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await uploadAssistantFileToOpenAI(new File(["test"], "fatura.pdf"), "fake-test-key").catch((error: unknown) => error) as OpenAIRequestError;
    expect(error).toBeInstanceOf(OpenAIRequestError);
    expect(error.details).toMatchObject({ kind: "credits", requestId: "req_upload" });
    expect(error.message).toContain("saldo"); expect(JSON.stringify(error)).not.toContain("org-private");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("não expõe erro bruto em um upload sem identificador", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { message: "secret-key" } }))));
    await expect(uploadAssistantFileToOpenAI(new File(["test"], "fatura.pdf"), "fake-test-key")).rejects.toThrow("Falha ao preparar fatura.pdf");
  });
});
