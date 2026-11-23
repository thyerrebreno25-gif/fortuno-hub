import { routineScheduleKey } from "./routine-schedule";
import { canonicalTeam } from "./teams";

export type ConfiguredRoutine = {
  id: string; clientId: string; processId: string; responsibleId: string | null;
  recurrenceType: string; recurrenceData: unknown; team: string | null; priority: string;
  notifyClient?: boolean; auditEnabled?: boolean; auditRecurrenceData?: unknown;
  createdAt: string; updatedAt: string;
  client: { id: string; name: string; cluster: string };
  process: { id: string; name: string };
  responsible: { id: string; name: string | null; email: string } | null;
};
export type RoutineFilters = {
  responsibleId: string; clientId: string; processId: string;
  from: string; to: string; duplicatesOnly: boolean;
};
export const emptyRoutineFilters: RoutineFilters = { responsibleId: "", clientId: "", processId: "", from: "", to: "", duplicatesOnly: false };

/** Compare all routines before filtering so a hidden sibling is still identified. */
export function duplicateRoutineIds(routines: ConfiguredRoutine[]) {
  const groups = new Map<string, string[]>();
  for (const routine of routines) {
    const key = JSON.stringify([routine.clientId, routine.processId, routine.responsibleId,
      canonicalTeam(routine.team), routine.priority, routine.notifyClient !== false,
      routine.auditEnabled === true, routine.auditEnabled ? routine.auditRecurrenceData : null,
      routineScheduleKey(routine.recurrenceType, routine.recurrenceData)]);
    groups.set(key, [...(groups.get(key) || []), routine.id]);
  }
  return new Set([...groups.values()].filter(ids => ids.length > 1).flat());
}

export function filterConfiguredRoutines(routines: ConfiguredRoutine[], filters: RoutineFilters, duplicateIds = duplicateRoutineIds(routines)) {
  return routines.filter(routine => {
    if (filters.responsibleId && routine.responsibleId !== filters.responsibleId) return false;
    if (filters.clientId && routine.clientId !== filters.clientId) return false;
    if (filters.processId && routine.processId !== filters.processId) return false;
    if (filters.duplicatesOnly && !duplicateIds.has(routine.id)) return false;
    const schedule = routine.recurrenceData && typeof routine.recurrenceData === "object" ? routine.recurrenceData as Record<string, unknown> : {};
    const start = typeof schedule.startDate === "string" ? schedule.startDate : routine.createdAt.slice(0, 10);
    const end = routine.recurrenceType === "ONCE" ? start : typeof schedule.endDate === "string" && schedule.endDate ? schedule.endDate : null;
    // Period means validity overlap, including routines that started before it.
    return (!filters.to || start <= filters.to) && (!filters.from || !end || end >= filters.from);
  });
}
