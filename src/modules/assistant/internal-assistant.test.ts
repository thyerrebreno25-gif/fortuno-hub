import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantToolContext } from "./tools";
const execute = vi.hoisted(() => vi.fn());
vi.mock("./tools", () => ({ executeAssistantTool: execute }));
import { runInternalAssistant } from "./internal-assistant";

const context = { member: { organizationId: "org1", userId: "user1" }, conversationId: "conversation1" } as AssistantToolContext;
const input = { context, files: [], ticketCodes: [], now: new Date("2026-09-17T12:00:00Z"), client: { id: "client1", name: "Cliente" } };
beforeEach(() => vi.resetAllMocks());
describe("assistente sem OpenAI", () => {
  it("ajuda, aprendizagem e perguntas desconhecidas não disparam ferramentas externas", async () => {
    expect((await runInternalAssistant({ ...input, prompt: "Como importar uma fatura?" })).text).toContain("sem IA externa");
    expect((await runInternalAssistant({ ...input, prompt: "Aprenda categorias" })).links).toEqual([{ label: "Abrir Faturas", href: "/faturas" }]);
    expect((await runInternalAssistant({ ...input, prompt: "Qual é a capital da Alemanha?" })).text).toContain("somente quando você ativar");
    expect(execute).not.toHaveBeenCalled();
  });
  it("não realiza envio financeiro pelo chat", async () => {
    const result = await runInternalAssistant({ ...input, prompt: "Envie a fatura para o Conta Azul" });
    expect(result.text).toContain("Nenhum lançamento foi criado"); expect(execute).not.toHaveBeenCalled();
  });
  it("lista catálogo apenas do cliente explicitamente selecionado", async () => {
    execute.mockResolvedValue({ items: [{ name: "Sistemas", type: "DESPESA" }], count: 1 });
    const result = await runInternalAssistant({ ...input, prompt: "Liste as categorias deste cliente" });
    expect(execute).toHaveBeenCalledWith(context, "get_client_conta_azul_catalog", JSON.stringify({ client_id: "client1", catalog: "categories", query: "" }));
    expect(result.text).toContain("Sistemas"); expect(result.consultedClientIds).toEqual(["client1"]);
  });
  it("pede cliente e período quando faltam, sem fabricar relatório", async () => {
    expect((await runInternalAssistant({ ...input, client: null, prompt: "Relatório financeiro no mês passado" })).text).toContain("Selecione o cliente");
    expect((await runInternalAssistant({ ...input, prompt: "Relatório financeiro deste cliente" })).text).toContain("Informe um período válido");
    expect(execute).not.toHaveBeenCalled();
  });
  it("não consulta o cliente selecionado quando o usuário nomeou outro ambíguo", async () => {
    execute.mockResolvedValue([{ id: "x1", name: "Tripé 1" }, { id: "x2", name: "Tripé 2" }]);
    const result = await runInternalAssistant({ ...input, prompt: "Relatório do cliente Tripé em agosto de 2026" });
    expect(result.text).toContain("único cliente"); expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1]).toBe("search_clients");
  });
  it("busca cliente nomeado único e ainda utiliza ferramenta que revalida acesso", async () => {
    execute.mockImplementation(async (_context, tool) => tool === "search_clients" ? [{ id: "x1", name: "Tripé" }] : {});
    const result = await runInternalAssistant({ ...input, prompt: "Relatório do cliente Tripé em agosto de 2026" });
    expect(execute.mock.calls[1][1]).toBe("audit_client_financials");
    expect(JSON.parse(execute.mock.calls[1][2]).client_id).toBe("x1");
    expect(result.reportTitle).toContain("Tripé"); expect(result.text).toContain("não informado");
  });
  it("retorna totais consultados e ressalvas de saldo atual/competência/conciliação", async () => {
    execute.mockResolvedValue({ source: { queriedAt: "2026-09-17T12:00:00Z" },
      payables: { count: 3, amount: 1200, overdueCount: 1, overdueAmount: 100 },
      receivables: { count: 1, amount: 2000, overdueCount: 0, overdueAmount: 0 },
      accountBalances: [{ name: "Banco", balance: 4500 }, { name: "Falha", balance: null, error: "Erro" }],
      fortuno: { openOperations: 2, overdueOperations: 1, openFindings: 4 } });
    const result = await runInternalAssistant({ ...input, prompt: "Relatório financeiro deste cliente no mês passado" });
    expect(result.text).toContain("1.200,00"); expect(result.text).toContain("2.000,00");
    expect(result.text).toContain("Falha: não informado"); expect(result.text).toContain("não são os saldos do fim do período");
    expect(result.text).toContain("Não compara com saldo bancário"); expect(result.text).toContain("sem OpenAI");
    expect(JSON.parse(execute.mock.calls[0][2])).toMatchObject({ period_start: "2026-08-01", period_end: "2026-08-31" });
  });
  it("expõe erro autorizado sem contornar pelo uso de IA ou outro cliente", async () => {
    execute.mockRejectedValue(new Error("Cliente fora da sua responsabilidade"));
    const result = await runInternalAssistant({ ...input, prompt: "Relatório financeiro deste cliente no mês passado" });
    expect(result.text).toContain("fora da sua responsabilidade"); expect(result.toolEvents[0].ok).toBe(false);
    expect(result.reportTitle).toBeUndefined(); expect(execute).toHaveBeenCalledTimes(1);
  });
  it("analisa totais de planilha por leitor interno sem inventar envio", async () => {
    const result = await runInternalAssistant({ ...input, prompt: "Valide e envie", files: [{ name: "rede.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 10,
      analysis: { supported: true, acquirer: "REDE", importedLines: 3, total: 42, reviewLines: 1, byEvent: { MDR: { count: 1, amount: -3 } } } }], ticketCodes: ["SUP-ABC"] });
    expect(result.text).toContain("42,00"); expect(result.text).toContain("SUP-ABC");
    expect(result.text).toContain("Nenhum lançamento financeiro foi enviado"); expect(execute).not.toHaveBeenCalled();
  });
});
