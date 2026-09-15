import { describe, expect, it } from "vitest";
import { searchPlatformGuide } from "./platform-knowledge";

describe("base de conhecimento do Assistente Fortuno", () => {
  it("localiza instruções de faturas mesmo sem acentos", () => {
    const result = searchPlatformGuide("como enviar fatura cartao");
    expect(result[0].topic).toBe("faturas cartao");
    expect(result[0].content).toContain("Conta Azul");
  });

  it("retorna uma orientação útil para um termo genérico", () => {
    expect(searchPlatformGuide("ajuda").length).toBeGreaterThan(0);
  });
});
