import { describe, expect, it } from "vitest";
import { gutSchema, gutScore, gutImpact, rankGut, type GutActivity } from "./gut";
import { emptyMapping, mappingInputSchema } from "./model";
const activity: GutActivity = { id: "a", title: "Atividade", gravity: 5, urgency: 5, tendency: 5 };
describe("Mapeamento GUT", () => {
  it("normaliza o produto a 100% e mantém notas parciais pendentes", () => {
    expect(gutScore(activity)).toBe(125);
    expect(gutImpact(activity)).toBe(100);
    expect(gutImpact({ ...activity, gravity: 1, urgency: 1, tendency: 1 })).toBe(0.8);
    expect(gutImpact({ ...activity, gravity: 3, urgency: 4, tendency: 5 })).toBe(48);
    expect(gutScore({ ...activity, tendency: null })).toBeNull();
  });
  it("ordena por impacto sem mudar a lista de cadastro e deixa pendentes por último", () => {
    const rows = [{ ...activity, id: "pending", gravity: null }, { ...activity, id: "low", gravity: 1 }, activity];
    expect(rankGut(rows).map((item) => item.id)).toEqual(["a", "low", "pending"]);
    expect(rows[0].id).toBe("pending");
  });
  it("rejeita notas inválidas e identificadores duplicados", () => {
    for (const value of [0, 6, 1.5]) expect(gutSchema.safeParse([{ ...activity, gravity: value }]).success).toBe(false);
    expect(gutSchema.safeParse([activity, activity]).success).toBe(false);
  });
  it("preserva GUT ao salvar e reabrir e aceita mapeamentos antigos", () => {
    const old = { ...emptyMapping(), title: "Processo teste" };
    expect(mappingInputSchema.safeParse(old).success).toBe(true);
    const saved = mappingInputSchema.parse({ ...old, data: { ...old.data, gut: [{ ...activity, urgency: null }] } });
    expect(mappingInputSchema.parse(JSON.parse(JSON.stringify(saved))).data.gut).toEqual([{ ...activity, urgency: null }]);
  });
});
