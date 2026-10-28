import { expect, it } from "vitest";
import { confirmFinancialInstallment, confirmFinancialSettlement } from "./financial-confirmation";
const expected = { direction: "PAYABLE", description: "Compra", amount: 10, dueDate: "2026-10-20", competenceDate: "2026-10-01", financialAccountId: "account", categoryId: "category" };
const detail = { id: "installment", descricao: "Compra", data_vencimento: "2026-10-20", conta_financeira: { id: "account" }, valor_composicao: { valor_liquido: 10 }, evento: { id: "event", tipo: "DESPESA", data_competencia: "2026-10-01", rateio: [{ id_categoria: "category", valor: 10 }] } };
it("confirms actual amount, category, dates, direction and account", () => {
  expect(confirmFinancialInstallment(detail, expected)).toEqual({ id: "installment", eventId: "event" });
  for (const override of [{ valor_composicao: { valor_liquido: 11 } }, { status: "CANCELADO" }, { conta_financeira: { id: "other" } }, { data_vencimento: "2026-11-20" }, { evento: { ...detail.evento, rateio: [{ id_categoria: "other", valor: 10 }] } }]) expect(() => confirmFinancialInstallment({ ...detail, ...override }, expected)).toThrow();
});
it("never treats a partial or unrelated settlement as completed", () => {
  const settlement = { id: "settlement", conta_financeira: { id: "account" }, data_pagamento: "2026-10-20", valor_composicao: { valor_liquido: 10 } };
  const expected = { accountId: "account", amount: 10, date: "2026-10-20" };
  expect(confirmFinancialSettlement([], expected)).toBeNull();
  expect(confirmFinancialSettlement([settlement], expected)).toBe("settlement");
  expect(() => confirmFinancialSettlement([{ ...settlement, conta_financeira: "other" }], expected)).toThrow();
  expect(() => confirmFinancialSettlement([{ ...settlement, valor_composicao: { valor_liquido: 5 } }], expected)).toThrow();
  expect(() => confirmFinancialSettlement([settlement, settlement], expected)).toThrow();
});
