import type { FlowNode } from "./model";
export function duplicateStep(node: FlowNode, id: string, offset = 40): FlowNode {
  return { ...node, id, title: `${node.title.slice(0, 150)} (cópia)`, validated: false,
    x: node.x + offset <= 10000 ? node.x + offset : Math.max(0, node.x - offset),
    y: node.y + offset <= 10000 ? node.y + offset : Math.max(0, node.y - offset) };
}
export function scaledDelta(delta: number, zoom: number) { return delta / zoom; }
