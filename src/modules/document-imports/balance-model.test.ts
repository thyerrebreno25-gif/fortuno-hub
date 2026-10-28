import { expect, it } from "vitest";
import { parseInvestment } from "./parsers";
import { compareBalances, statementClosingCents, type AccountClosingBalance } from "./balance-model";
const review = () => {
  const parsed = parseInvestment(["Período de: 01/10/2026 a 28/10/2026", "CDB MAIS LIMITE DE CREDITO", "28/10/2026 Rendimento até esta data R$ 19,36 ABERTURA R$ 2.517,13", "28/10/2026 Previsão de I.R. para resgate total até esta data R$ 77,56 DEFINITIVO R$ 2.439,57", "CDB MAIS LIMITE DE CREDITO", "28/10/2026 Rendimento até esta data R$ 9,54 ABERTURA R$ 1.241,23"].map((text) => ({ text, page: 1 })));
  parsed.rows[0].accountId = "account";
  return parsed;
};
const balance = (balanceCents: number | null): AccountClosingBalance => ({ accountId: "account", date: "2026-10-28", balanceCents, checkedAt: "2026-11-01T12:00:00Z", method: "RECONSTRUCTED" });
it("reads gross closing balances from saved evidence and ignores projected IR", () => {
  expect(statementClosingCents(review().rows[0])).toBe(375836);
  expect(review().rows[0].amountCents).toBe(2890);
  expect(compareBalances(review(), [balance(372946)])[0]).toMatchObject({ status: "OK", projectedCents: 375836, differenceCents: 0 });
});
it("identifies a mismatch, a balance already matching without income, and missing data", () => {
  expect(compareBalances(review(), [balance(372945)])[0]).toMatchObject({ status: "DIVERGENT", differenceCents: -1 });
  expect(compareBalances(review(), [balance(375836)])[0].status).toBe("ALREADY_MATCHES");
  expect(compareBalances(review(), [balance(null)])[0].status).toBe("UNAVAILABLE");
  expect(compareBalances(review(), [{ ...balance(372946), date: "2026-11-01" }])[0].status).toBe("UNAVAILABLE");
});
it("aggregates all types mapped to the same CA account and rejects missing source totals", () => {
  const data = review(); data.rows.push({ ...data.rows[0], key: "other", amountCents: 100, evidence: [{ page: 2, text: "28/10/2026 Rendimento até esta data R$ 1,00 ABERTURA R$ 10,00", amountCents: 100 }] });
  expect(compareBalances(data, [balance(373846)])[0]).toMatchObject({ status: "OK", incomeCents: 2990, statementCents: 376836 });
  data.rows[1].evidence[0].text = "Linha não reconhecida";
  expect(compareBalances(data, [balance(373846)])[0].status).toBe("UNAVAILABLE");
});
it("does not validate a changed period against a different statement closing date", () => {
  const data = review(); data.periodEnd = "2026-10-31";
  expect(compareBalances(data, [{ ...balance(372946), date: data.periodEnd }])[0].status).toBe("UNAVAILABLE");
});
