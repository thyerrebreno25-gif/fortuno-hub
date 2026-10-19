import type { FlowGraph, FlowNode } from "./model";
export type PortSide = "top" | "right" | "bottom" | "left";
export const portSides: { value: PortSide; label: string }[] = [{ value: "top", label: "Superior" }, { value: "right", label: "Direita" }, { value: "bottom", label: "Inferior" }, { value: "left", label: "Esquerda" }];
export function portPoint(node: FlowNode, side: PortSide) {
  return { x: node.x + (side === "left" ? 0 : side === "right" ? 220 : 110), y: node.y + (side === "top" ? 0 : side === "bottom" ? 130 : 65) };
}
export function defaultSides(a: FlowNode, b: FlowNode): [PortSide, PortSide] {
  if (b.y < a.y - 80) return ["right", "right"];
  if (b.x < a.x - 80 && Math.abs(b.y - a.y) < 160) return ["bottom", "bottom"];
  return b.y > a.y + 160 ? ["bottom", "top"] : ["right", "left"];
}
export function connectionPath(a: FlowNode, b: FlowNode, edge: FlowGraph["edges"][number]) {
  const defaults = defaultSides(a, b);
  const from = edge.sourceSide || defaults[0], to = edge.targetSide || defaults[1];
  const p = portPoint(a, from), q = portPoint(b, to);
  const gap = edge.routeOffset ?? 50;
  let d: string, label: { x: number; y: number };
  if (from === to) {
    if (from === "bottom" || from === "top") {
      const y = from === "bottom" ? Math.max(a.y, b.y) + 130 + gap : Math.max(12, Math.min(a.y, b.y) - gap);
      d = `M ${p.x} ${p.y} L ${p.x} ${y} L ${q.x} ${y} L ${q.x} ${q.y}`;
      label = { x: (p.x + q.x) / 2, y: y - 8 };
      if (Math.abs(p.x - q.x) < 25) {
        const x = Math.max(a.x, b.x) + 220 + gap;
        const sign = from === "bottom" ? 1 : -1;
        const py = Math.max(12, p.y + sign * gap), qy = Math.max(12, q.y + sign * gap);
        d = `M ${p.x} ${p.y} L ${p.x} ${py} L ${x} ${py} L ${x} ${qy} L ${q.x} ${qy} L ${q.x} ${q.y}`;
        label = { x: x + 8, y: (py + qy) / 2 };
      }
    } else {
      const x = from === "right" ? Math.max(a.x, b.x) + 220 + gap : Math.max(12, Math.min(a.x, b.x) - gap);
      d = `M ${p.x} ${p.y} L ${x} ${p.y} L ${x} ${q.y} L ${q.x} ${q.y}`;
      label = { x: x + 8, y: (p.y + q.y) / 2 };
      if (Math.abs(p.y - q.y) < 25) {
        const y = Math.max(a.y, b.y) + 130 + gap;
        const sign = from === "right" ? 1 : -1;
        const px = Math.max(12, p.x + sign * gap), qx = Math.max(12, q.x + sign * gap);
        d = `M ${p.x} ${p.y} L ${px} ${p.y} L ${px} ${y} L ${qx} ${y} L ${qx} ${q.y} L ${q.x} ${q.y}`;
        label = { x: (px + qx) / 2, y: y - 8 };
      }
    }
  } else {
    const direction = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
    const length = Math.max(gap, Math.min(240, Math.hypot(p.x - q.x, p.y - q.y) / 2));
    const c = { x: p.x + direction[from][0] * length, y: p.y + direction[from][1] * length };
    const e = { x: q.x + direction[to][0] * length, y: q.y + direction[to][1] * length };
    d = `M ${p.x} ${p.y} C ${c.x} ${c.y}, ${e.x} ${e.y}, ${q.x} ${q.y}`;
    label = { x: (p.x + 3*c.x + 3*e.x + q.x) / 8, y: (p.y + 3*c.y + 3*e.y + q.y) / 8 - 8 };
  }
  return { d, label };
}
