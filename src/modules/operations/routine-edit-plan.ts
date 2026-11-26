import {operationOccurrenceDay} from "./business-days";
import { matchesRecurrence } from "./recurrence";
import type { RoutineEdit } from "./edit-model";
export const ROUTINE_EDIT_REMOVAL = "Programação da rotina alterada";
type Work = { status: string; disregardReview?: unknown; timeEntries: unknown[]; comments: unknown[]; attachments: unknown[]; checklistItems: { completed: boolean; disregardedAt: Date | null; comment: string | null }[] };
export function untouchedRoutineActivity(activity: Work) {
  return activity.status === "OPEN" && !activity.disregardReview && !activity.timeEntries.length && !activity.comments.length && !activity.attachments.length && activity.checklistItems.every(item => !item.completed && !item.disregardedAt && !item.comment);
}
export function routineDates(input: RoutineEdit, from: string, to: string, holidays: Set<string>) {
  const result = new Map<string, Date>(), dayKey = (date: Date) => date.toISOString().slice(0, 10);
  for (const date = new Date(from + "T12:00:00Z"); dayKey(date) <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    if (!matchesRecurrence(input.recurrenceType, input.recurrenceData, date)) continue;
    const key = operationOccurrenceDay(dayKey(date),holidays);
    if(!key)continue;
    if (key >= from && key >= input.recurrenceData.startDate) result.set(key, new Date(key + "T" + input.recurrenceData.dueTime + ":00-03:00"));
  }
  return result;
}
