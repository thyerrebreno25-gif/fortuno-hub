import { describe, expect, it } from "vitest";
import { analyzeContaAzulDre } from "./dre-engine";
import type { ParsedContaAzulDre } from "./parsers/conta-azul-dre-parser";

function dre(rows: ParsedContaAzulDre["rows"]): ParsedContaAzulDre {
  return {
    company: "EMPRESA TESTE LTDA",
    months: ["2026-06", "2026-07"],
    periodStart: "2026-06-01",
    periodEnd: "2026-07-31",
    rows,
  };
}

function row(category: string, june: number, july: number, level = 2) {
  return {
    category,
    values: { "2026-06": june, "2026-07": july },
    level,
    sourcePage: 1,
    sourceText: category,
  };
}

describe("analyzeContaAzulDre", () => {
  it("aponta recorrência ausente em uma competência", () => {
    const result = analyzeContaAzulDre(dre([
      row("Água e Saneamento", -120, 0),
    ]));

    expect(result.findings.find(
      (finding) => finding.ruleCode === "DRE_MISSING_WATER",
    )?.competence).toBe("2026-07");
    expect(result.metrics.missingRecurringGroups).toBe(1);
  });

  it("aponta quando o resultado final passa de lucro para prejuízo", () => {
    const result = analyzeContaAzulDre(dre([
      row("07T Lucro / Prejuízo Final", 10_000, -2_000, 0),
    ]));

    expect(result.findings.find(
      (finding) => finding.ruleCode === "DRE_FINAL_RESULT",
    )?.severity).toBe("CRITICAL");
  });

  it("não trata categorias eventuais como obrigação mensal", () => {
    const result = analyzeContaAzulDre(dre([
      row("Cursos e Treinamentos", 0, -2_000),
    ]));

    expect(result.findings).toHaveLength(0);
  });
});
