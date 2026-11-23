import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { routineDates, untouchedRoutineActivity } from "./routine-edit-plan";
import { routineEditSchema, type RoutineEdit } from "./edit-model";
const input: RoutineEdit = { expectedUpdatedAt: "2026-11-23T12:00:00Z", responsibleId: null, team: null, priority: "MEDIUM", notifyClient: false, auditEnabled: false, recurrenceType: "WEEKLY", recurrenceData: { startDate: "2026-11-23", endDate: null, weekdays: [2], monthDays: [], dueTime: "18:00", interval: 1, dailyMode: "ALL_DAYS", holidayBehavior: "KEEP" } };
it("reschedules only selected days with Brasília deadlines and collapses holiday collisions", () => {
  expect([...routineDates(input, "2026-11-23", "2026-11-30", new Set())]).toEqual([["2026-11-24", new Date("2026-11-24T21:00:00Z")]]);
  const holiday = { ...input, recurrenceData: { ...input.recurrenceData, weekdays: [1, 2], holidayBehavior: "NEXT_BUSINESS_DAY" as const } };
  expect([...routineDates(holiday, "2026-11-23", "2026-11-25", new Set(["2026-11-23"]))].map(([day]) => day)).toEqual(["2026-11-24"]);
});
it("preserves any task with recorded work, approvals, files, comments or checklist changes", () => {
  const row = { status: "OPEN", timeEntries: [], comments: [], attachments: [], checklistItems: [{ completed: false, disregardedAt: null, comment: null }] };
  expect(untouchedRoutineActivity(row)).toBe(true);
  for (const patch of [{ status: "PAUSED" }, { timeEntries: [{}] }, { comments: [{}] }, { attachments: [{}] }, { disregardReview: { status: "PENDING" } }, { checklistItems: [{ completed: true, disregardedAt: null, comment: null }] }]) expect(untouchedRoutineActivity({ ...row, ...patch })).toBe(false);
});
it("validates calendar dates, intervals, fixed month days and the end of the recurrence", () => {
  expect(routineEditSchema.safeParse(input).success).toBe(true);
  for (const patch of [{ startDate: "2026-02-30" }, { endDate: "2026-11-01" }, { weekdays: [] }, { interval: 0 }]) expect(routineEditSchema.safeParse({ ...input, recurrenceData: { ...input.recurrenceData, ...patch } }).success).toBe(false);
  expect(routineEditSchema.safeParse({ ...input, recurrenceType: "MONTHLY" }).success).toBe(false);
});
