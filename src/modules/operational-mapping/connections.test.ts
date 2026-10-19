import { describe, expect, it } from "vitest";
import { connectionPath, defaultSides, portPoint } from "./connections";
import { graphSchema, newNode } from "./model";
describe("conexões de retorno", () => {
  const a = { ...newNode("step", 0), x: 70, y: 60 };
  const b = { ...newNode("step", 1), x: 370, y: 60 };
  const edge = { id: "e", source: a.id, target: b.id, label: "" };
  it("separa a volta da ida em mapeamentos existentes", () => {
    expect(defaultSides(a, b)).toEqual(["right", "left"]);
    expect(defaultSides(b, a)).toEqual(["bottom", "bottom"]);
    const back = connectionPath(b, a, { ...edge, source: b.id, target: a.id });
    expect(back.d).toBe("M 480 190 L 480 240 L 180 240 L 180 190");
    expect(back.d).not.toBe(connectionPath(a, b, edge).d);
  });
  it("preserva os lados e o afastamento ao salvar", () => {
    const saved = graphSchema.parse({ nodes: [a,b], edges: [{ ...edge, sourceSide: "top", targetSide: "top", routeOffset: 30 }] });
    expect(saved.edges[0].sourceSide).toBe("top");
    expect(connectionPath(a,b,saved.edges[0]).d).toBe("M 180 60 L 180 30 L 480 30 L 480 60");
    expect(graphSchema.safeParse({ nodes: [a,b], edges: [edge] }).success).toBe(true);
  });
  it("acompanha o movimento das caixas e permite afastar o retorno", () => {
    const back = { ...edge, sourceSide: "bottom" as const, targetSide: "bottom" as const, routeOffset: 100 };
    expect(connectionPath(a,b,back).label.y).toBe(282);
    expect(portPoint({ ...b, y: 250 }, "bottom")).toEqual({ x:480, y:380 });
    expect(connectionPath(a,{ ...b, y:250 },back).label.y).toBe(472);
  });
  it("contorna caixas alinhadas verticalmente sem refazer o mesmo segmento", () => {
    const lower = { ...b, x: a.x, y: 300 };
    expect(defaultSides(lower, a)).toEqual(["right", "right"]);
    const path = connectionPath(lower,a,{ ...edge, sourceSide: "bottom", targetSide: "bottom" });
    expect(path.d).toContain("L 340 480");
    expect(path.d).toContain("L 340 240");
  });
});
