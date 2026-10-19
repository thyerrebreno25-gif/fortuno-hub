import { newNode, type FlowGraph, type FlowNode } from "./model";

export const operations = ["Receber solicitação", "Receber documentos", "Conferir informações", "Cadastrar no sistema", "Enviar para aprovação", "Aprovar solicitação", "Solicitar correção", "Executar pagamento", "Emitir nota fiscal", "Enviar ao cliente", "Acompanhar retorno", "Arquivar documentos"];
export const areas = ["Comercial", "Financeiro", "Operacional", "Atendimento", "Diretoria", "Supervisão", "Cliente"];

// Add branches without replacing an existing activity or its connections.
export function appendGuided(graph: FlowGraph, parentId: string, action: "next" | "branch" | "end"): FlowGraph {
  const parent = graph.nodes.find((node) => node.id === parentId);
  if (!parent || parent.type === "end") return graph;
  const outgoing = graph.edges.filter((edge) => edge.source === parent.id);
  const splitExisting = outgoing.length > 0 && parent.type !== "decision";
  const count = action === "branch" ? (parent.type === "decision" ? 2 : 3) : splitExisting ? 2 : 1;
  if (graph.nodes.length + count > 100 || graph.edges.length + count > 250) return graph;
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  let bottom = Math.max(0, ...nodes.map((node) => node.y)) + 190;
  function add(type: FlowNode["type"], source: string, label = "", title?: string) {
    const node = { ...newNode(type, nodes.length), x: 70, y: Math.min(10000, bottom) };
    bottom += 190;
    if (title) node.title = title;
    nodes.push(node);
    edges.push({ id: crypto.randomUUID(), source, target: node.id, label });
    return node.id;
  }
  if (action === "branch") {
    const decision = parent.type === "decision" ? parent.id : add("decision", parent.id, "", "Qual condição define o caminho?");
    add("step", decision, "Sim", "Etapa do caminho Sim");
    add("step", decision, "Não", "Etapa do caminho Não");
  } else {
    let source = parent.id;
    if (splitExisting) {
      source = add("decision", parent.id, "", "Qual condição define o caminho?");
      outgoing.forEach((edge, index) => {
        const position = edges.findIndex((item) => item.id === edge.id);
        edges[position] = { ...edge, source, label: edge.label || `Caminho ${index + 1}` };
      });
    }
    add(action === "end" ? "end" : "step", source, parent.type === "decision" || splitExisting ? `Caminho ${outgoing.length + 1}` : "");
  }
  return { nodes: nodes.map((node) => ({ ...node, validated: false })), edges };
}
