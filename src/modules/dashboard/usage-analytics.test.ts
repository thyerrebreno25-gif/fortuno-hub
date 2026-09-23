import { describe, expect, it } from "vitest";
import {
  buildDashboardUsage,
  resolveDashboardPeriod,
  type DashboardUsageEvent,
} from "./usage-analytics";

function event(overrides: Partial<DashboardUsageEvent> = {}): DashboardUsageEvent {
  return {
    id: "event-1",
    kind: "CREDIT_CARD_INVOICE",
    stage: "IMPORT",
    occurredAt: "2026-09-20T15:00:00.000Z",
    clientId: "client-1",
    clientName: "Cliente A",
    userId: "user-1",
    userName: "Operador A",
    status: "EXPORTED",
    successful: true,
    entries: 10,
    amount: 500,
    ...overrides,
  };
}

describe("dashboard usage analytics", () => {
  it("separa importações de envios e soma apenas lançamentos realmente criados", () => {
    const period = resolveDashboardPeriod("7D", new Date("2026-09-23T15:00:00.000Z"));
    const result = buildDashboardUsage([
      event(),
      event({ id: "send", kind: "CA_CREDIT_CARD_INVOICE", stage: "CA_EXPORT", entries: 10 }),
      event({ id: "failed", kind: "CA_ACQUIRER", stage: "CA_EXPORT", successful: false, entries: 0 }),
    ], period);

    expect(result.totalActivities).toBe(3);
    expect(result.imports).toBe(1);
    expect(result.caSends).toBe(1);
    expect(result.caEntries).toBe(10);
  });

  it("consolida uso por cliente e colaborador", () => {
    const period = resolveDashboardPeriod("30D", new Date("2026-09-23T15:00:00.000Z"));
    const result = buildDashboardUsage([
      event(),
      event({ id: "note", kind: "PURCHASE_INVOICE_IMPORT", userId: "user-2", userName: "Operador B" }),
    ], period);

    expect(result.byClient[0]).toEqual(expect.objectContaining({ label: "Cliente A", total: 2 }));
    expect(result.byUser).toHaveLength(2);
    expect(result.timeline).toHaveLength(30);
  });
});
