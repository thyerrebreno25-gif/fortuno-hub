import { expect, it } from "vitest";
import { duplicateStep, scaledDelta } from "./editor-actions";
import { newNode, graphSchema } from "./model";
it("duplica as informações com outro ID, posição e validação pendente", () => {
 const source = { ...newNode("step", 0), id: "original", description: "Instruções", validated: true };
 const copy = duplicateStep(source, "copy");
 expect(copy).toMatchObject({ id: "copy", description: "Instruções", validated: false, x: source.x + 40, y: source.y + 40 });
 expect(source.validated).toBe(true);
 expect(graphSchema.safeParse({ nodes: [source, copy], edges: [] }).success).toBe(true);
 expect(duplicateStep({ ...source, title: "a".repeat(160), x: 10000, y: 10000 }, "copy")).toMatchObject({ x: 9960, y: 9960 });
});
it("mantém a geometria do arraste e da conexão em diferentes zooms", () => {
 expect(scaledDelta(100, 0.5)).toBe(200);
 expect(scaledDelta(100, 2)).toBe(50);
 expect(scaledDelta(-100, 1)).toBe(-100);
});
