import {nextBusinessRoutine,routineOccurrenceDay} from "./routine-calendar";
import { matchesRecurrence } from "./recurrence";
import type { RoutineEdit } from "./edit-model";
export const ROUTINE_EDIT_REMOVAL = "Programação da rotina alterada";
export {untouchedRoutineActivity} from "./activity-untouched";
export function routineDates(input: RoutineEdit, from: string, to: string, holidays: Set<string>) {
  const result = new Map<string, Date>(), dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const first=new Date(from+"T12:00:00Z");if(nextBusinessRoutine(input.recurrenceType,input.recurrenceData))first.setUTCDate(first.getUTCDate()-370);
  for (const date = first; dayKey(date) <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    if (!matchesRecurrence(input.recurrenceType, input.recurrenceData, date)) continue;
    const key = routineOccurrenceDay(input.recurrenceType,input.recurrenceData,dayKey(date),holidays);
    if(!key)continue;
    if (key >= from && key >= input.recurrenceData.startDate) result.set(key, new Date(key + "T" + input.recurrenceData.dueTime + ":00-03:00"));
  }
  return result;
}
