import { describe, expect, it } from "vitest";
import {
  classifyMonthlyObligation,
  filterGenericAuditMovements,
  isGenericAuditMovement,
} from "./movement-classifier";
import type { AuditMovement } from "./types";

function movement(
  description: string,
  options: Partial<AuditMovement> = {},
): AuditMovement {
  return {
    id: description,
    date: "2026-08-10",
    amount: -100,
    balance: null,
    description,
    counterparty: null,
    category: null,
    situation: null,
    monthKey: "2026-08",
    sourcePage: 1,
    sourceText: description,
    ...options,
  };
}

describe("movement-classifier", () => {
  it("identifica os grupos prioritários por descrição ou categoria", () => {
    expect(classifyMonthlyObligation(movement("Pagamento DARF"))).toBe("TAXES");
    expect(classifyMonthlyObligation(movement("Pagamento de ISS"))).toBe("TAXES");
    expect(classifyMonthlyObligation(movement("Pagamento", { category: "Folha de pagamento" }))).toBe("PAYROLL");
    expect(classifyMonthlyObligation(movement("Pró-labore dos sócios"))).toBe("PRO_LABORE");
  });

  it("ignora PIX sem identificação, mas mantém PIX com favorecido", () => {
    expect(isGenericAuditMovement(movement("PIX RECEBIDO"))).toBe(true);
    expect(isGenericAuditMovement(movement("PIX RECEBIDO JOAO SILVA"))).toBe(false);
    expect(isGenericAuditMovement(movement("PIX", { counterparty: "João Silva" }))).toBe(false);
  });

  it("ignora recebimentos genéricos e transferências entre contas", () => {
    expect(isGenericAuditMovement(movement("RECEBIMENTO"))).toBe(true);
    expect(isGenericAuditMovement(movement("TRANSFERÊNCIA ENTRE CONTAS"))).toBe(true);
    expect(isGenericAuditMovement(movement("APLICAÇÃO AUTOMÁTICA"))).toBe(true);
  });

  it("nunca ignora uma obrigação prioritária mesmo com descrição genérica", () => {
    expect(isGenericAuditMovement(movement("PIX", { category: "Salários" }))).toBe(false);
  });

  it("separa somente os lançamentos realmente genéricos", () => {
    const generic = movement("PIX RECEBIDO");
    const identified = movement("PIX RECEBIDO MARIA");
    const result = filterGenericAuditMovements([generic, identified]);

    expect(result.ignoredMovements).toEqual([generic]);
    expect(result.auditableMovements).toEqual([identified]);
  });
});
