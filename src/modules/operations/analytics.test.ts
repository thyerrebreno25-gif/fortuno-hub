import { expect, it } from "vitest";
import { analyticsPeriod, buildOperationsAnalytics, entryAllocation, precedingPeriod, type AnalyticsActivity, type AnalyticsEntry } from "./analytics";
const now = new Date("2026-10-27T18:00:00Z"), period = analyticsPeriod("2026-10-27", "2026-10-27");
const owner = { id: "owner", name: "Responsável", email: "owner@example.test" }, helper = { id: "helper", name: "Operador", email: "helper@example.test" };
function activity(patch: Partial<AnalyticsActivity> = {}): AnalyticsActivity { return { id: "a", title: "Conciliação", status: "COMPLETED", scheduledDate: "2026-10-27T00:00:00Z", createdAt: "2026-10-01T12:00:00Z", dueAt: "2026-10-27T14:00:00Z", completedAt: now, responsibleId: owner.id, responsible: owner, team: "Equipe A", clientCluster: "A", client: { id: "c", name: "Cliente", cluster: "A" }, process: { id: "p", name: "Processo" }, ...patch }; }
function entry(patch: Partial<AnalyticsEntry> = {}): AnalyticsEntry { return { id: "t", activityId: "a", userId: helper.id, startedAt: "2026-10-27T12:00:00Z", endedAt: "2026-10-27T13:00:00Z", seconds: 3600, user: helper, activity: activity(), ...patch }; }
it("validates date ranges, uses inclusive Brazilian dates and compares equal-length preceding periods", () => {
  expect(period.start.toISOString()).toBe("2026-10-27T03:00:00.000Z");
  expect(period.end.toISOString()).toBe("2026-10-28T03:00:00.000Z");
  expect(precedingPeriod(analyticsPeriod("2026-03-01", "2026-03-31"))).toMatchObject({ from: "2026-01-29", to: "2026-02-28", days: 31 });
  for (const [from, to] of [["2026-02-30", "2026-03-01"], ["2026-10-28", "2026-10-27"], ["2024-01-01", "2026-10-27"], ["bad", "bad"]]) expect(() => analyticsPeriod(from, to)).toThrow();
});
it("credits time to the actual author instead of the assigned responsible", () => {
  const data = buildOperationsAnalytics([activity()], [entry()], period, now);
  expect(data.summary).toMatchObject({ seconds: 3600, planned: 1, worked: 1, completed: 1, withoutTime: 0, operators: 1, coverage: 100 });
  expect(data.byOperator.find((row) => row.id === "owner")).toMatchObject({ planned: 1, completed: 1, seconds: 0, worked: 0 });
  expect(data.byOperator.find((row) => row.id === "helper")).toMatchObject({ planned: 0, seconds: 3600, worked: 1 });
});
it("splits sessions at Brazilian midnight and does not count the full session in both periods", () => {
  const timer = entry({ startedAt: "2026-10-27T02:30:00Z", endedAt: "2026-10-27T03:30:00Z", seconds: 3600 });
  expect(entryAllocation(timer, period, now).seconds).toBe(1800);
  expect(entryAllocation(timer, precedingPeriod(period), now).seconds).toBe(1800);
  const twoDays = buildOperationsAnalytics([activity()], [timer], analyticsPeriod("2026-10-26", "2026-10-27"), now);
  expect(twoDays.daily.map((day) => day.seconds)).toEqual([1800, 1800]);
  expect(twoDays.daily.reduce((sum, day) => sum + day.seconds, 0)).toBe(twoDays.summary.seconds);
});
it("uses recorded seconds for closed sessions and elapsed time for running sessions", () => {
  expect(entryAllocation(entry({ seconds: 1800 }), period, now).seconds).toBe(1800);
  const running = buildOperationsAnalytics([activity()], [entry({ endedAt: null, seconds: 0 })], period, now);
  expect(running.summary).toMatchObject({ seconds: 21600, runningSeconds: 21600, closedSeconds: 0, runningTimers: 1 });
});
it("includes work performed on activities scheduled outside the selected period", () => {
  const oldActivity = activity({ scheduledDate: "2026-10-01T00:00:00Z" });
  const data = buildOperationsAnalytics([oldActivity], [entry({ activity: oldActivity })], period, now);
  expect(data.summary).toMatchObject({ planned: 0, worked: 1, seconds: 3600 });
  expect(data.activities[0].planned).toBe(false);
});
it("does not merge different clients or operators with the same display name", () => {
  const other = activity({ id: "b", client: { id: "c2", name: "Cliente", cluster: "B" } });
  const data = buildOperationsAnalytics([activity(), other], [entry(), entry({ id: "t2", activityId: "b", activity: other, userId: "helper2", user: { ...helper, id: "helper2" } })], period, now);
  expect(data.byClient).toHaveLength(2); expect(data.summary.operators).toBe(2);
  expect(data.byClient.reduce((sum, row) => sum + row.seconds, 0)).toBe(data.summary.seconds);
});
it("keeps unrecorded time distinct from zero demand and excludes disregarded tasks from coverage", () => {
  const data = buildOperationsAnalytics([activity(), activity({ id: "b", status: "DISREGARDED" })], [], period, now);
  expect(data.summary).toMatchObject({ planned: 2, worked: 0, seconds: 0, withoutTime: 1, completedWithoutTime: 1, coverage: 0 });
});
it("operator filters count only their authored time and their assigned workload", () => {
  const data = buildOperationsAnalytics([activity()], [entry(), entry({ id: "t2", userId: owner.id, user: owner })], period, now, helper.id);
  expect(data.summary).toMatchObject({ planned: 0, worked: 1, seconds: 3600, operators: 1 });
  expect(data.byOperator).toHaveLength(1);
});
it("reports prior-period time and handles sessions with invalid or future timestamps safely", () => {
  const data = buildOperationsAnalytics([activity()], [entry(), entry({ id: "prior", startedAt: "2026-10-26T12:00:00Z", endedAt: "2026-10-26T14:00:00Z", seconds: 7200 })], period, now);
  expect(data.byClient[0].previousSeconds).toBe(7200); expect(data.previous.seconds).toBe(7200);
  expect(entryAllocation(entry({ startedAt: "2026-10-28T12:00:00Z", endedAt: null }), period, now).seconds).toBe(0);
  expect(entryAllocation(entry({ endedAt: "bad" }), period, now).seconds).toBe(0);
});
it("flags forgotten running timers without silently capping their recorded demand", () => {
  const report = buildOperationsAnalytics([activity()], [entry({ startedAt: "2026-10-26T12:00:00Z", endedAt: null, seconds: 0 })], period, now);
  expect(report.summary.longRunningTimers).toBe(1);
  expect(report.summary.runningSeconds).toBe(15 * 3600);
});
