import { describe, expect, it } from "vitest";
import { executivePeriod, managementRole } from "./model";

describe("executive dashboard period", () => {
  it("uses São Paulo date before 03:00 UTC and an exclusive next-day boundary", () => {
    const period = executivePeriod("today", new Date("2026-11-05T02:59:59Z"));
    expect(period).toMatchObject({ key: "today", from: "2026-11-04", to: "2026-11-04", days: [{ date: "2026-11-04", label: "04/11" }] });
    expect(period.start.toISOString()).toBe("2026-11-04T03:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(executivePeriod("today", new Date("2026-11-05T03:00:00Z")).to).toBe("2026-11-05");
  });
  it("includes exactly seven days across the month boundary", () => {
    const period = executivePeriod("week", new Date("2026-11-03T12:00:00Z"));
    expect(period.from).toBe("2026-10-28");
    expect(period.to).toBe("2026-11-03");
    expect(period.days).toHaveLength(7);
    expect(period.days[0]).toEqual({ date: "2026-10-28", label: "28/10" });
    expect(+period.end - +period.start).toBe(7 * 86400000);
  });
  it("starts this month at São Paulo midnight and never includes future days", () => {
    const period = executivePeriod("month", new Date("2026-11-05T12:00:00Z"));
    expect(period.from).toBe("2026-11-01");
    expect(period.days).toHaveLength(5);
    expect(period.days.at(-1)?.date).toBe("2026-11-05");
    expect(period.end.toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect(executivePeriod("month", new Date("2026-11-01T02:00:00Z")).from).toBe("2026-10-01");
  });
  it("defaults invalid period keys to today", () => {
    expect(executivePeriod("all", new Date("2026-11-05T12:00:00Z")).key).toBe("today");
  });
});

it.each(["MASTER", "ADMIN", "MANAGER"])("allows %s into the management panel", role => expect(managementRole(role)).toBe(true));
it.each(["OPERATOR", "CLIENT", "", "manager"])("rejects non-management role %s", role => expect(managementRole(role)).toBe(false));
