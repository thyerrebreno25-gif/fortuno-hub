import { describe, expect, it } from "vitest";
import { buildAssistantHistory, historyClientIds, serializeAssistantData } from "./context";

describe("histórico limitado da assistente", () => {
  it("mantém mensagens recentes em ordem com limite de texto", () => {
    const history = buildAssistantHistory(Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 ? "ASSISTANT" : "USER", content: `mensagem ${i}: ${"x".repeat(15000)}`,
    })));
    expect(history.length).toBeLessThanOrEqual(8);
    expect(history.map((message) => message.content).join("").length).toBeLessThanOrEqual(12000);
    expect(history[0].role).toBe("user"); expect(history.at(-1)?.content).toContain("mensagem 99:");
    expect(history.some((message) => message.content.includes("mensagem 0:"))).toBe(false);
  });
  it("não repassa IDs de anexos, snapshots, regras internas nem erros de cota como conversa", () => {
    const history = buildAssistantHistory([
      { role: "USER", content: "Analisar arquivo", attachments: [{ name: "Rede.xlsx", openAiFileId: "file-secret", analysis: { total: 100 } }] },
      { role: "ASSISTANT", content: "Prévia criada", metadata: { categoryLearningPreview: {
        client: { id: "c1" }, account: { name: "Bradesco" }, records: ["SECRET-RECORD"], seenIds: ["SECRET-ID"],
      } } },
      { role: "ASSISTANT", content: "Limite temporário", metadata: { openAiError: { kind: "rate_limit" } } },
      { role: "TOOL", content: "SECRET-TOOL" },
    ]);
    expect(history).toHaveLength(2); expect(JSON.stringify(history)).toContain("Rede.xlsx"); expect(JSON.stringify(history)).toContain("100");
    for (const value of ["file-secret", "SECRET-RECORD", "SECRET-ID", "SECRET-TOOL", "Limite temporário"]) expect(JSON.stringify(history)).not.toContain(value);
  });
  it("identifica clientes para revalidar a responsabilidade atual", () => {
    expect(historyClientIds([{ role: "ASSISTANT", content: "...", metadata: {
      contextClientId: "c1", consultedClientIds: ["c1", "c2"], categoryLearningPreview: { client: { id: "c3" } },
      toolEvents: [{ arguments: { client_id: "c4" } }, { arguments: { client_id: null } }, { ok: false, arguments: { client_id: "denied" } }],
    } }])).toEqual(["c1", "c3", "c2", "c4"]);
  });
});

describe("resumos de ferramentas com limites explícitos", () => {
  it("preserva totais de todas as linhas, mas limita amostra com aviso", () => {
    const data = JSON.parse(serializeAssistantData({ source: { period: "agosto" },
      payables: { count: 200, amount: 9876.54, items: Array.from({ length: 100 }, (_, id) => ({ id, amount: 5 })) },
      receivables: { count: 300, amount: 1234.56, items: Array.from({ length: 100 }, (_, id) => ({ id, amount: 7 })) },
    }));
    expect(data.data.payables.count).toBe(200); expect(data.data.payables.amount).toBe(9876.54);
    expect(data.data.receivables.count).toBe(300); expect(data.data.receivables.amount).toBe(1234.56);
    expect(data.data.payables.items).toHaveLength(20); expect(data.contextLimits.truncated).toBe(true);
    expect(data.contextLimits.notice).toContain("Não conclua");
  });
  it("mantém pequenos resultados intactos", () => {
    expect(JSON.parse(serializeAssistantData({ count: 1, items: [{ name: "Bradesco" }] }))).toEqual({ count: 1, items: [{ name: "Bradesco" }] });
  });
  it("sempre produz JSON válido e limitado, mesmo com dados muito grandes", () => {
    const result = serializeAssistantData({ count: 200,
      items: Array.from({ length: 10000 }, (_, id) => ({ id, description: '"'.repeat(10000) })) }, 2000);
    expect(result.length).toBeLessThanOrEqual(2000); expect(JSON.parse(result).contextLimits.truncated).toBe(true);
  });
  it("omite um resultado irredutível sem inventar totais", () => {
    const result = serializeAssistantData(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`field${i}`, "x".repeat(1000)])), 1200);
    expect(result.length).toBeLessThanOrEqual(1200); expect(JSON.parse(result).contextLimits.dataOmitted).toBe(true);
  });
});
