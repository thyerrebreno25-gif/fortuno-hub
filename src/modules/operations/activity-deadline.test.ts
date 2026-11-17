import { expect, it } from "vitest";
import { activityCompletedLate, activityDueDay, activityOverdue, operationDayRange, operationToday, overdueActivityDates } from "./activity-deadline";
it("keeps today's scheduled work on time through 23:59:59 in Brasília, regardless of its configured hour", () => {
  const activity = { scheduledDate: "2026-11-17T00:00:00Z", dueAt: "2026-11-17T10:00:00Z", status: "OPEN" };
  expect(activityOverdue(activity, new Date("2026-11-18T02:59:59.999Z"))).toBe(false);
  expect(activityOverdue(activity, new Date("2026-11-18T03:00:00Z"))).toBe(true);
  expect(operationToday(new Date("2026-11-18T02:00:00Z"))).toBe("2026-11-17");
  expect(activityDueDay({ ...activity, dueAt: "2026-11-16T10:00:00Z" })).toBe("2026-11-17");
});
it("uses the local due date only without a scheduled day and excludes completed/disregarded tasks", () => {
  const now = new Date("2026-11-17T18:00:00Z");
  expect(activityOverdue({ dueAt: "2026-11-17T02:00:00Z" }, now)).toBe(true);
  expect(activityOverdue({ dueAt: "2026-11-17T12:00:00Z" }, now)).toBe(false);
  expect(activityOverdue({}, now)).toBe(false);
  for (const status of ["COMPLETED", "DISREGARDED"]) expect(activityOverdue({ scheduledDate: "2026-11-01", status }, now)).toBe(false);
});
it("classifies completion by day instead of by hour", () => {
  const activity = { scheduledDate: "2026-11-17", dueAt: "2026-11-17T10:00:00Z" };
  expect(activityCompletedLate({ ...activity, completedAt: "2026-11-18T02:59:59Z" })).toBe(false);
  expect(activityCompletedLate({ ...activity, completedAt: "2026-11-18T03:00:00Z" })).toBe(true);
});
it("uses matching UTC calendar bounds and Brasília instant bounds in database queries", () => {
  const query = overdueActivityDates(new Date("2026-11-18T02:00:00Z"));
  expect(query.OR[0].scheduledDate?.lt.toISOString()).toBe("2026-11-17T00:00:00.000Z");
  expect(query.OR[1].dueAt?.lt.toISOString()).toBe("2026-11-17T03:00:00.000Z");
  expect(operationDayRange("2026-11-17")).toEqual({ gte: new Date("2026-11-17T00:00:00Z"), lt: new Date("2026-11-18T00:00:00Z") });
  expect(() => operationDayRange("2026-02-30")).toThrow();
});
