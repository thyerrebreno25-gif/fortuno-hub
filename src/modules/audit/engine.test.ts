import { describe, expect, it } from "vitest";
import { analyzeAuditMovements } from "./engine";
import type { AuditMovement } from "./types";

function movement(
  id: string,
  amount: number,
  balance: number | null = null,
): AuditMovement {
  return {
    id,
    date: "2026-08-10",
    amount,
    balance,
    description: id,
    counterparty: null,
    category: null,
    situation: null,
    monthKey: "2026-08",
    sourcePage: 1,
    sourceText: id,
  };
}

describe("analyzeAuditMovements", () => {
  it("não envia pares compensados para as regras de auditoria", () => {
    const result = analyzeAuditMovements([
      movement("automatic-investment-entry", 500),
      movement("automatic-investment-exit", -500),
      movement("expense", -75),
    ]);

    expect(result.movements.map((item) => item.id)).toEqual(["expense"]);
    expect(result.metrics.sourceTransactionCount).toBe(3);
    expect(result.metrics.transactionCount).toBe(1);
    expect(result.metrics.entryCount).toBe(0);
    expect(result.metrics.exitCount).toBe(1);
    expect(result.metrics.exitTotal).toBe(75);
    expect(result.metrics.priorityTransactionCount).toBe(0);
    expect(result.metrics.compensatedPairCount).toBe(1);
    expect(result.metrics.compensatedTransactionCount).toBe(2);
    expect(result.metrics.genericIgnoredTransactionCount).toBe(0);
  });

  it("mantém a verificação do saldo final usando o extrato completo", () => {
    const result = analyzeAuditMovements([
      movement("entry", 100, -100),
      movement("exit", -100, -200),
    ]);

    expect(result.movements).toHaveLength(0);
    expect(result.findings.some(
      (finding) => finding.ruleCode === "NEGATIVE_ENDING_BALANCE",
    )).toBe(true);
  });

  it("retira descrições genéricas antes de executar os reports", () => {
    const result = analyzeAuditMovements([
      movement("PIX RECEBIDO", 100),
      {
        ...movement("salary", -1_000),
        category: "Salários",
      },
    ]);

    expect(result.movements.map((item) => item.id)).toEqual(["salary"]);
    expect(result.metrics.genericIgnoredTransactionCount).toBe(1);
    expect(result.metrics.priorityTransactionCount).toBe(1);
  });

  it("não compensa impostos ou folha mesmo com entrada e saída iguais", () => {
    const result = analyzeAuditMovements([
      {
        ...movement("salary-payment", -1_000),
        category: "Salários",
      },
      {
        ...movement("salary-reversal", 1_000),
        category: "Salários",
      },
    ]);

    expect(result.movements).toHaveLength(2);
    expect(result.metrics.compensatedPairCount).toBe(0);
    expect(result.metrics.priorityTransactionCount).toBe(2);
  });
});
