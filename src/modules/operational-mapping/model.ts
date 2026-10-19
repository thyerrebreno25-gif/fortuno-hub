import { z } from "zod";

export const nodeSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(["start", "step", "decision", "end"]),
  title: z.string().trim().min(1).max(160), description: z.string().max(3000),
  owner: z.string().max(200), tools: z.string().max(500), input: z.string().max(1000), output: z.string().max(1000),
  pain: z.string().max(2000), validated: z.boolean(),
  x: z.number().min(0).max(10000), y: z.number().min(0).max(10000),
});
export const edgeSchema = z.object({ id: z.string().min(1).max(100), source: z.string().min(1).max(100), target: z.string().min(1).max(100), label: z.string().max(120), sourceSide: z.enum(["top", "right", "bottom", "left"]).optional(), targetSide: z.enum(["top", "right", "bottom", "left"]).optional(), routeOffset: z.number().min(25).max(300).optional() });
export const graphSchema = z.object({ nodes: z.array(nodeSchema).max(100), edges: z.array(edgeSchema).max(250) }).superRefine((graph, ctx) => {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length || new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length) ctx.addIssue({ code: "custom", message: "Há identificadores duplicados no fluxo." });
  if (graph.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target)) ctx.addIssue({ code: "custom", message: "Uma conexão aponta para uma etapa inválida." });
});
export const mappingDataSchema = z.object({ asIs: graphSchema, toBe: graphSchema, questions: z.array(z.string().max(1000)).max(30), improvements: z.string().max(10000) });
export const mappingInputSchema = z.object({
  title: z.string().trim().min(3, "Dê um nome ao processo.").max(160), clientId: z.string().min(1).max(100).nullable(),
  description: z.string().max(20000), objective: z.string().max(3000), owner: z.string().max(200),
  status: z.enum(["DRAFT", "REVIEW", "VALIDATED"]), data: mappingDataSchema,
}).superRefine((mapping, ctx) => {
  if (mapping.status === "VALIDATED") {
    const issues = [...validationIssues(mapping.data.asIs), ...(mapping.data.toBe.nodes.length ? validationIssues(mapping.data.toBe) : [])];
    if (issues.length) ctx.addIssue({ code: "custom", message: issues[0] });
  }
  if (mapping.status === "VALIDATED" && (!mapping.data.asIs.nodes.length || [...mapping.data.asIs.nodes, ...mapping.data.toBe.nodes].some((node) => !node.validated))) ctx.addIssue({ code: "custom", message: "Revise e valide todas as etapas dos fluxos antes de validar o mapeamento." });
});
export type FlowNode = z.infer<typeof nodeSchema>;
export type FlowGraph = z.infer<typeof graphSchema>;
export type MappingInput = z.infer<typeof mappingInputSchema>;
export type Mapping = MappingInput & { id: string; revision: number; updatedAt: string; createdAt: string; client: { name: string } | null };
export function emptyMapping(): MappingInput { return { title: "", clientId: null, description: "", objective: "", owner: "", status: "DRAFT", data: { asIs: { nodes: [], edges: [] }, toBe: { nodes: [], edges: [] }, questions: [], improvements: "" } }; }
export function newNode(type: FlowNode["type"], index: number): FlowNode {
  return { id: crypto.randomUUID(), type, title: { start: "Início", step: "Nova etapa", decision: "Ponto de decisão", end: "Fim" }[type], description: "", owner: "", tools: "", input: "", output: "", pain: "", validated: false, x: 70 + index % 3 * 300, y: 60 + Math.floor(index / 3) * 190 };
}
export function removeNode(graph: FlowGraph, id: string): FlowGraph { return { nodes: graph.nodes.filter((node) => node.id !== id), edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id) }; }
export function cloneForToBe(graph: FlowGraph): FlowGraph { return { nodes: graph.nodes.map((node) => ({ ...node, validated: false })), edges: graph.edges.map((edge) => ({ ...edge })) }; }
export function validationIssues(graph: FlowGraph) {
  const issues: string[] = [];
  if (!graph.nodes.some((node) => node.type === "start")) issues.push("Adicione um início ao fluxo.");
  if (!graph.nodes.some((node) => node.type === "end")) issues.push("Adicione um fim ao fluxo.");
  for (const node of graph.nodes) {
    if (node.type !== "start" && !graph.edges.some((edge) => edge.target === node.id)) issues.push(`“${node.title}” não tem conexão de entrada.`);
    if (node.type !== "end" && !graph.edges.some((edge) => edge.source === node.id)) issues.push(`“${node.title}” não tem conexão de saída.`);
    if (node.type === "decision" && graph.edges.filter((edge) => edge.source === node.id).length < 2) issues.push(`Defina os caminhos da decisão “${node.title}”.`);
  }
  const starts = graph.nodes.filter((node) => node.type === "start").map((node) => node.id);
  const reachable = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    graph.edges.filter((edge) => edge.source === id).forEach((edge) => { if (!reachable.has(edge.target)) { reachable.add(edge.target); queue.push(edge.target); } });
  }
  if (starts.length && graph.nodes.some((node) => !reachable.has(node.id))) issues.push("Há etapas que não podem ser alcançadas a partir do início.");
  return issues;
}
