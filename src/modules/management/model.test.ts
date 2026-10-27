import { expect, it } from "vitest";
import { accountCheckInput, balanceValidation, caBalanceSummary, finiteMoney, localDay, overdueItem, reconciliationStatus, type AccountCheck, type AccountSnapshot, type ManagementSnapshot } from "./model";
const now = new Date("2026-10-27T15:00:00Z");
const account: AccountSnapshot = { id: "a", name: "Banco", bank: "INTER", balance: 100.1, queriedAt: now.toISOString(), error: null };
const check: AccountCheck = { bankBalance: 100.1, balanceAt: "2026-10-27T14:55:00Z", lastImportAt: null, pendingPayable: 0, pendingReceivable: 0, checkedAt: now.toISOString(), checkedBy: "Operador", note: "" };
it("shows actual CA balances in the overview without turning missing accounts into zero", () => {
  expect(caBalanceSummary(null)).toEqual({ amount: null, complete: false });
  const snapshot = { accounts: [account, { ...account, id: "b", balance: 20.05 }], accountsComplete: true, accountsError: null } as ManagementSnapshot;
  expect(caBalanceSummary(snapshot)).toEqual({ amount: 120.15, complete: true });
  expect(caBalanceSummary({ ...snapshot, accounts: [account, { ...account, balance: null }] })).toEqual({ amount: 100.1, complete: false });
  expect(balanceValidation({ ...account, error: "Saldo desatualizado" }, check, now).status).toBe("UNKNOWN");
});
it("never turns absent balances or missing reconciliation information into zero/OK", () => {
  expect(finiteMoney(null)).toBeNull(); expect(finiteMoney("")).toBeNull(); expect(finiteMoney("0")).toBe(0);
  expect(balanceValidation({ ...account, balance: null }, check, now).status).toBe("UNKNOWN");
  expect(balanceValidation(account, undefined, now).status).toBe("UNKNOWN");
  expect(reconciliationStatus({ ...check, pendingPayable: null }, now)).toBe("UNKNOWN");
});
it("compares cents and flags divergence only for contemporaneous balances", () => {
  expect(balanceValidation(account, check, now)).toEqual({ status: "OK", difference: 0 });
  expect(balanceValidation(account, { ...check, bankBalance: 99.1 }, now)).toEqual({ status: "DIVERGENT", difference: 1 });
  expect(balanceValidation(account, { ...check, balanceAt: "2026-10-27T13:00:00Z" }, now).status).toBe("STALE");
  expect(balanceValidation(account, check, new Date("2026-10-28T15:00:00Z")).status).toBe("STALE");
});
it("expires reconciliation confirmations and respects Brazil's date boundary", () => {
  expect(reconciliationStatus(check, now)).toBe("OK");
  expect(reconciliationStatus({ ...check, pendingReceivable: 3 }, now)).toBe("PENDING");
  expect(reconciliationStatus(check, new Date("2026-10-28T15:00:00Z"))).toBe("STALE");
  expect(localDay(new Date("2026-10-28T01:00:00Z"))).toBe("2026-10-27");
});
it("counts only unpaid overdue amounts, including partial payments, excluding cancelled/lost titles", () => {
  const row = { id: "1", descricao: "Serviço", data_vencimento: "2026-10-26", total: 120, pago: 100, nao_pago: 20, status: "PARTIALLY_RECEIVED" };
  expect(overdueItem(row, "2026-10-27")?.amount).toBe(20);
  expect(overdueItem({ ...row, data_vencimento: "2026-10-27" }, "2026-10-27")).toBeNull();
  expect(overdueItem({ ...row, status: "CANCELADO" }, "2026-10-27")).toBeNull();
  expect(overdueItem({ ...row, status: "PERDIDO" }, "2026-10-27")).toBeNull();
  expect(overdueItem({ ...row, nao_pago: undefined }, "2026-10-27")).toBeNull();
});
it("requires a dated bank balance and preserves unknown counters", () => {
  const input = { accountId: "a", revision: 1, bankBalance: null, balanceAt: null, lastImportAt: null, pendingPayable: null, pendingReceivable: null };
  expect(accountCheckInput.parse(input).pendingPayable).toBeNull();
  expect(accountCheckInput.safeParse({ ...input, bankBalance: 50 }).success).toBe(false);
  expect(accountCheckInput.safeParse({ ...input, pendingPayable: -1 }).success).toBe(false);
});
