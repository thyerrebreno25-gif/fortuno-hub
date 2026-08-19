import { describe, expect, it } from "vitest";
import { filterCompensatingMovements } from "./internal-transfer-filter";
import type { AuditMovement } from "./types";

function movement(
  id: string,
  date: string,
  amount: number,
): AuditMovement {
  return {
    id,
    date,
    amount,
    description: id,
    counterparty: null,
    category: null,
    situation: null,
    balance: null,
    monthKey: date.slice(0, 7),
    sourcePage: 1,
    sourceText: id,
  };
}

describe("filterCompensatingMovements", () => {
  it("retira uma entrada e uma saída de mesmo dia e valor", () => {
    const result = filterCompensatingMovements([
      movement("entry", "2026-08-10", 500),
      movement("exit", "2026-08-10", -500),
      movement("expense", "2026-08-10", -75),
    ]);

    expect(result.auditableMovements.map((item) => item.id)).toEqual(["expense"]);
    expect(result.compensatedPairs).toHaveLength(1);
    expect(result.compensatedPairs[0].entry.id).toBe("entry");
    expect(result.compensatedPairs[0].exit.id).toBe("exit");
  });

  it("não compensa valores iguais em datas diferentes", () => {
    const movements = [
      movement("entry", "2026-08-10", 500),
      movement("exit", "2026-08-11", -500),
    ];
    const result = filterCompensatingMovements(movements);

    expect(result.auditableMovements).toEqual(movements);
    expect(result.compensatedPairs).toHaveLength(0);
  });

  it("faz o pareamento individual e mantém lançamentos excedentes", () => {
    const result = filterCompensatingMovements([
      movement("entry-1", "2026-08-10", 500),
      movement("entry-2", "2026-08-10", 500),
      movement("exit", "2026-08-10", -500),
    ]);

    expect(result.auditableMovements.map((item) => item.id)).toEqual(["entry-2"]);
    expect(result.compensatedPairs).toHaveLength(1);
  });

  it("mantém lançamentos zerados na base auditável", () => {
    const zero = movement("zero", "2026-08-10", 0);
    const result = filterCompensatingMovements([zero]);

    expect(result.auditableMovements).toEqual([zero]);
    expect(result.compensatedPairs).toHaveLength(0);
  });
});
