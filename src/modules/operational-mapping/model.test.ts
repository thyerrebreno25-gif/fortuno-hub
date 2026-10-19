import { describe, it, expect, vi, afterEach } from "vitest";
import { newNode, removeNode, cloneForToBe, graphSchema, emptyMapping, mappingInputSchema } from "./model";
import { organizeMapping, parseOrganizedFlow } from "./ai";
const start = { ...newNode("start", 0), id: "start", validated: true };
const end = { ...newNode("end", 1), id: "end", validated: true };
const graph = { nodes: [start, end], edges: [{ id: "edge", source: "start", target: "end", label: "" }] };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("mapeamento operacional", () => {
  it("remove conexões da etapa excluída e mantém as demais etapas", () => {
    expect(removeNode(graph, "start")).toEqual({ nodes: [end], edges: [] });
  });
  it("cria TO BE independente e pendente de validação", () => {
    const future = cloneForToBe(graph); future.nodes[0].title = "Alterado";
    expect(graph.nodes[0].title).toBe("Início");
    expect(future.nodes.every((node) => !node.validated)).toBe(true);
    expect(future.edges[0]).not.toBe(graph.edges[0]);
  });
  it("rejeita conexões soltas, repetição de IDs e posições inválidas", () => {
    expect(graphSchema.safeParse({ ...graph, edges: [{ ...graph.edges[0], target: "missing" }] }).success).toBe(false);
    expect(graphSchema.safeParse({ ...graph, nodes: [start, start] }).success).toBe(false);
    expect(graphSchema.safeParse({ ...graph, nodes: [{ ...start, x: -1 }, end] }).success).toBe(false);
  });
  it("exige etapas revisadas e conexões completas ao validar", () => {
    const mapping = { ...emptyMapping(), title: "Processo de teste", status: "VALIDATED", data: { ...emptyMapping().data, asIs: graph } };
    expect(mappingInputSchema.safeParse(mapping).success).toBe(true);
    expect(mappingInputSchema.safeParse({ ...mapping, data: { ...mapping.data, asIs: { ...graph, edges: [] } } }).success).toBe(false);
    expect(mappingInputSchema.safeParse({ ...mapping, data: { ...mapping.data, toBe: cloneForToBe(graph) } }).success).toBe(false);
  });
  it("normaliza a proposta de IA sem marcar etapas como validadas", () => {
    const result = parseOrganizedFlow({ ...graph, questions: ["Quem aprova?"], improvements: "" });
    expect(result.graph.nodes[0].validated).toBe(false);
    expect(result.questions).toEqual(["Quem aprova?"]);
  });
  it("trata falta de configuração, recusa e resposta incompleta sem inventar fluxo", async () => {
    const input = { clientId: null, title: "Teste", description: "Descrição do processo para a organização", objective: "", mode: "asIs" as const, current: graph };
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(organizeMapping(input)).rejects.toThrow("não está configurada");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "incomplete" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(organizeMapping(input)).rejects.toThrow("não concluiu");
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(organizeMapping(input)).rejects.toThrow("limite");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
