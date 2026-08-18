import { describe, expect, it } from "vitest";
import {
  evaluateReadingInstructions,
  interpretReadingInstructions,
} from "./reading-instructions";

describe("orientações do leitor de adquirentes", () => {
  it("entende uma conta que deve ser ignorada", () => {
    const result = interpretReadingInstructions(
      "Não quero os dados da conta 12345-6",
    );

    expect(result.unrecognized).toEqual([]);
    expect(result.rules).toMatchObject([
      { action: "EXCLUDE", field: "ACCOUNT", value: "12345-6" },
    ]);
  });

  it("aceita uma orientação por linha para campos suportados", () => {
    const result = interpretReadingInstructions([
      "Ignorar bandeira Elo",
      "Trazer apenas modalidade débito",
      "Não considerar a aba Ajustes",
      "Ignorar descrições contendo aluguel",
    ].join("\n"));

    expect(result.unrecognized).toEqual([]);
    expect(result.rules.map((rule) => [rule.action, rule.field, rule.value])).toEqual([
      ["EXCLUDE", "BRAND", "Elo"],
      ["INCLUDE", "MODALITY", "débito"],
      ["EXCLUDE", "SHEET", "Ajustes"],
      ["EXCLUDE", "DESCRIPTION", "aluguel"],
    ]);
  });

  it("não inventa uma regra quando a orientação é ambígua", () => {
    const result = interpretReadingInstructions("Conferir tudo com cuidado");

    expect(result.rules).toEqual([]);
    expect(result.unrecognized).toEqual(["Conferir tudo com cuidado"]);
  });

  it("exclui somente a linha cuja coluna de conta corresponde à regra", () => {
    const { rules } = interpretReadingInstructions("Ignorar conta 12345-6");

    expect(evaluateReadingInstructions(
      { "conta corrente": "Ag. 0001 / Conta 12345-6" },
      "Recebidos",
      rules,
    ).excluded).toBe(true);
    expect(evaluateReadingInstructions(
      { "conta corrente": "Ag. 0001 / Conta 99999-0" },
      "Recebidos",
      rules,
    ).excluded).toBe(false);
  });

  it("não aplica um filtro inclusivo a abas que não possuem aquele campo", () => {
    const { rules } = interpretReadingInstructions("Trazer apenas bandeira Visa");

    expect(evaluateReadingInstructions(
      { motivo: "Ajuste financeiro" },
      "Ajustes",
      rules,
    ).excluded).toBe(false);
  });
});
