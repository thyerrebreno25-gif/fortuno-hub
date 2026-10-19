import { describe, expect, it } from "vitest";
import { appendGuided } from "./guided-model";
import { graphSchema, newNode } from "./model";

describe("criação guiada", () => {
  const initial = { nodes: [newNode("start", 0)], edges: [] };
  it("liga o início ao próximo passo sem modificar o original", () => {
    const next = appendGuided(initial, initial.nodes[0].id, "next");
    expect(next.nodes).toHaveLength(2);
    expect(next.edges[0].source).toBe(initial.nodes[0].id);
    expect(next.edges[0].target).toBe(next.nodes[1].id);
    expect(initial.nodes).toHaveLength(1);
    expect(graphSchema.safeParse(next).success).toBe(true);
  });
  it("preserva a operação e cria decisão com dois caminhos editáveis", () => {
    const next = appendGuided(initial, initial.nodes[0].id, "branch");
    expect(next.nodes.map((node) => node.type)).toEqual(["start", "decision", "step", "step"]);
    expect(next.edges.map((edge) => edge.label)).toEqual(["", "Sim", "Não"]);
    expect(next.edges.slice(1).every((edge) => edge.source === next.nodes[1].id)).toBe(true);
  });
  it("divide um caminho existente sem perder a etapa anterior", () => {
    const next = appendGuided(initial, initial.nodes[0].id, "next");
    const branched = appendGuided(next, initial.nodes[0].id, "next");
    expect(branched.nodes).toHaveLength(4);
    expect(branched.edges.find((edge) => edge.id === next.edges[0].id)?.target).toBe(next.nodes[1].id);
    expect(branched.edges.filter((edge) => edge.source === initial.nodes[0].id)).toHaveLength(1);
    expect(graphSchema.safeParse(branched).success).toBe(true);
  });
  it("encerra um caminho e respeita limites de tamanho", () => {
    const ended = appendGuided(initial, initial.nodes[0].id, "end");
    expect(appendGuided(ended, ended.nodes[1].id, "next")).toBe(ended);
    const full = { nodes: Array.from({ length: 99 }, (_, i) => newNode("step", i)), edges: [] };
    expect(appendGuided(full, full.nodes[0].id, "branch")).toBe(full);
  });
});
