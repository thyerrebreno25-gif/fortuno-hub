import { describe, expect, it } from "vitest";
import { internalPeriod, planInternalRequest, requestedInternalClient } from "./internal-plan";

const now = new Date("2026-09-17T12:00:00Z");
describe("interpretação interna limitada e determinística", () => {
  it("recognizes bank access queries and separates bank from client name", () => {
    expect(planInternalRequest("Qual o acesso do cliente Tripé no banco Itaú?").kind).toBe("NOTION");
    expect(requestedInternalClient("Qual o acesso do cliente Tripé no banco Itaú?")).toBe("tripe");
    expect(planInternalRequest("Onde encontro o login deste cliente no Notion?").kind).toBe("NOTION");
  });
  it.each([
    ["Bom dia", "GREETING"], ["Como importar uma fatura?", "HELP"],
    ["Aprenda as categorias do Bradesco", "LEARNING"], ["Liste clientes", "SEARCH"],
    ["Liste categorias deste cliente", "CATALOG"], ["Centros de custo deste cliente", "CATALOG"],
    ["Resuma a situação deste cliente", "OVERVIEW"], ["Manda relatório financeiro deste cliente no mês passado", "REPORT"],
    ["Envie a fatura para o Conta Azul", "WORKFLOW"], ["Liquide as despesas", "WORKFLOW"],
    ["Qual é a capital da Alemanha?", "UNKNOWN"],
  ])("%s → %s", (prompt, kind) => expect(planInternalRequest(prompt, now).kind).toBe(kind));
  it.each([
    ["mês passado", "2026-08-01", "2026-08-31"], ["mês atual", "2026-09-01", "2026-09-30"],
    ["fevereiro de 2024", "2024-02-01", "2024-02-29"], ["08/2026", "2026-08-01", "2026-08-31"],
    ["de 10/08/2026 a 20/08/2026", "2026-08-10", "2026-08-20"], ["2026-08-01 a 2026-08-31", "2026-08-01", "2026-08-31"],
  ])("período %s", (prompt, start, end) => expect(internalPeriod(prompt, now)).toEqual({ start, end }));
  it.each(["sem período", "31/02/2026 a 05/03/2026", "20/08/2026 a 10/08/2026", "10/08/2026", "13/2026", "mês atual e mês passado", "julho de 2026 e agosto de 2026"])("não assume período inválido ou ambíguo: %s", (prompt) => expect(internalPeriod(prompt, now)).toBeUndefined());
  it("resolve mês anterior na virada do ano e respeita fuso brasileiro", () => {
    expect(internalPeriod("mês passado", new Date("2026-01-15T12:00:00Z"))).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(internalPeriod("mês atual", new Date("2026-09-01T01:00:00Z"))).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });
  it("separa nome do cliente de período sem adivinhar outro cliente", () => {
    expect(requestedInternalClient("Relatório do cliente Tripé em agosto de 2026")).toBe("tripe");
    expect(requestedInternalClient("Relatório deste cliente no mês passado")).toBe("");
    expect(requestedInternalClient("Resuma o cliente selecionado")).toBe("");
  });
});
