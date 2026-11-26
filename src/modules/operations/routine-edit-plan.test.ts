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
it("moves monthly and fortnightly weekend occurrences to Monday, retaining weekly anticipation",()=>{for(const recurrence of [{recurrenceType:"MONTHLY" as const,recurrenceData:{...input.recurrenceData,startDate:"2026-11-01",monthDays:[28,29]}},{recurrenceType:"DAILY" as const,recurrenceData:{...input.recurrenceData,startDate:"2026-11-13",interval:15}}])expect([...routineDates({...input,...recurrence},"2026-11-27","2026-11-29",new Set())].map(([day])=>day)).toEqual(["2026-11-30"]);const mondayHoliday={...input,recurrenceData:{...input.recurrenceData,weekdays:[1]}};expect([...routineDates(mondayHoliday,"2026-11-27","2026-11-30",new Set(["2026-11-30"]))].map(([day])=>day)).toEqual(["2026-11-27"]);});
it("keeps the selected 15-day anchor after moving holidays and weekends forward",()=>{
 const schedule={...input,recurrenceType:"DAILY" as const,recurrenceData:{...input.recurrenceData,startDate:"2026-12-01",interval:15,dailyMode:"ALL_DAYS" as const}};
 const dates=[...routineDates(schedule,"2026-12-01","2027-03-01",new Set(["2026-12-16"]))].map(([day])=>day);
 expect(dates).toEqual(["2026-12-01","2026-12-17","2026-12-31","2027-01-15","2027-02-01","2027-02-15","2027-03-01"]);
});
it("includes a prior-month occurrence postponed into the selected range without creating nonexistent dates",()=>{
 const schedule={...input,recurrenceType:"MONTHLY" as const,recurrenceData:{...input.recurrenceData,startDate:"2027-01-31",endDate:"2027-01-31",monthDays:[31]}};
 expect([...routineDates(schedule,"2027-02-01","2027-02-01",new Set())].map(([day])=>day)).toEqual(["2027-02-01"]);
 expect([...routineDates({...schedule,recurrenceData:{...schedule.recurrenceData,endDate:null}},"2027-02-02","2027-02-28",new Set())]).toEqual([]);
});
