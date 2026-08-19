import { describe, expect, it } from "vitest";
import { monthlyObligationCoverageRule } from ".";
import type { AuditMovement } from "../types";

function movement(
  id: string,
  monthKey: string,
  description: string,
  amount = -100,
): AuditMovement {
  return {
    id,
    date: `${monthKey}-10`,
    amount,
    balance: null,
    description,
    counterparty: null,
    category: null,
    situation: null,
    monthKey,
    sourcePage: 1,
    sourceText: description,
  };
}

describe("monthlyObligationCoverageRule", () => {
  it("aponta os meses sem imposto quando o grupo existe no período", () => {
    const findings = monthlyObligationCoverageRule(
      [
        movement("tax-jan", "2026-01", "Pagamento DARF"),
        movement("tax-mar", "2026-03", "Pagamento DARF"),
      ],
      ["2026-01", "2026-02", "2026-03"],
    );

    const taxes = findings.find(
      (finding) => finding.ruleCode === "MISSING_MONTHLY_TAXES",
    );

    expect(taxes?.competence).toBe("2026-02");
    expect(taxes?.severity).toBe("CRITICAL");
    expect(taxes?.evidence.map((item) => item.label)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(taxes?.evidence[0].value).toContain("100,00");
    expect(taxes?.evidence[1].value).toBe("Não identificado");
    expect(taxes?.evidence[2].value).toContain("100,00");
  });

  it("não cria apontamento para uma obrigação que nunca apareceu", () => {
    const findings = monthlyObligationCoverageRule(
      [movement("tax", "2026-01", "Pagamento de imposto")],
      ["2026-01", "2026-02"],
    );

    expect(findings.some(
      (finding) => finding.ruleCode === "MISSING_MONTHLY_PAYROLL",
    )).toBe(false);
    expect(findings.some(
      (finding) => finding.ruleCode === "MISSING_MONTHLY_PRO_LABORE",
    )).toBe(false);
  });

  it("considera somente pagamentos de saída na cobertura mensal", () => {
    const findings = monthlyObligationCoverageRule(
      [
        movement("tax-jan", "2026-01", "Imposto", -100),
        movement("refund-feb", "2026-02", "Devolução de imposto", 100),
      ],
      ["2026-01", "2026-02"],
    );

    expect(findings.find(
      (finding) => finding.ruleCode === "MISSING_MONTHLY_TAXES",
    )?.competence).toBe("2026-02");
  });
});
