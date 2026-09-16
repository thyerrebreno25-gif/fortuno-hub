import { describe, expect, it } from "vitest";
import { openAIRequestError } from "./openai-errors";

describe("diagnóstico seguro de erros OpenAI", () => {
  it.each([
    ["credit_balance_exhausted", "credits", "saldo"],
    ["project_spend_limit_exceeded", "spend_limit", "gastos"],
    ["organization_spend_limit_exceeded", "spend_limit", "gastos"],
    ["billing_hard_limit_reached", "spend_limit", "gastos"],
    ["organization_usage_limit_exceeded", "usage_limit", "aprovado"],
    ["insufficient_quota", "quota", "cobrança"],
    ["slow_down", "rate_limit", "temporário"],
    ["rate_limit_exceeded", "rate_limit", "temporário"],
  ])("distingue %s", (code, kind, message) => {
    const error = openAIRequestError(429, { code, message: "private-key organization org-secret" }, new Headers());
    expect(error.details.kind).toBe(kind); expect(error.message).toContain(message);
    expect(JSON.stringify(error)).not.toContain("org-secret"); expect(error.message).toContain("Aprender categorias");
  });
  it("identifica cota pelo type e dá prioridade ao financeiro mesmo com mensagem de limite", () => {
    expect(openAIRequestError(429, { type: "insufficient_quota", message: "Rate limit" }, new Headers()).details.kind).toBe("quota");
  });
  it("não afirma que um bloqueio desconhecido é temporário", () => {
    const error = openAIRequestError(429, undefined, new Headers());
    expect(error.details.kind).toBe("unknown"); expect(error.message).toContain("não foi confirmado");
  });
  it("aceita Retry-After como data e respeita intervalos maiores que uma hora", () => {
    const error = openAIRequestError(429, { code: "rate_limit_exceeded" }, new Headers({
      "retry-after": "Wed, 16 Sep 2026 15:00:00 GMT",
    }), Date.parse("2026-09-16T13:00:00Z"));
    expect(error.details.retryAfterSeconds).toBe(7200); expect(error.message).toContain("120 minuto");
  });
  it("não inventa espera para valores inválidos nem armazena identificadores arbitrários", () => {
    const error = openAIRequestError(429, { code: "rate_limit_exceeded", type: "secret text" }, new Headers({
      "retry-after": "nonsense", "x-request-id": "secret text",
    }));
    expect(error.details).toMatchObject({ retryAfterSeconds: null, requestId: null, type: null });
  });
  it.each([401, 403])("explica falhas de acesso %s sem mostrar dados da chave", (status) => {
    const error = openAIRequestError(status, { message: "private-key" }, new Headers());
    expect(error.details.kind).toBe("access"); expect(error.message).not.toContain("private-key");
  });
});
