import { expect, it } from "vitest";
import { duplicateRoutineIds, emptyRoutineFilters, filterConfiguredRoutines, type ConfiguredRoutine } from "./routine-filters";
const base: ConfiguredRoutine = { id: "a", clientId: "c1", processId: "p1", responsibleId: "u1", recurrenceType: "WEEKLY", recurrenceData: { startDate: "2026-11-01", weekdays: [1], dueTime: "18:00" }, team: "Equipe A", priority: "MEDIUM", createdAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-01T12:00:00Z", client: { id: "c1", name: "Cliente", cluster: "A" }, process: { id: "p1", name: "Pagamentos" }, responsible: { id: "u1", name: "Operadora", email: "o@test" } };
it("combines operator, client and process without using the activity screen's date filters", () => {
  const rows = [base, { ...base, id: "b", responsibleId: "u2" }, { ...base, id: "c", clientId: "c2" }, { ...base, id: "d", processId: "p2" }];
  expect(filterConfiguredRoutines(rows, { ...emptyRoutineFilters, responsibleId: "u1", clientId: "c1", processId: "p1" }).map(row => row.id)).toEqual(["a"]);
  expect(filterConfiguredRoutines(rows, emptyRoutineFilters)).toHaveLength(4);
});
it("includes ongoing routines that started before the selected period and excludes expired/future routines", () => {
  const rows = [base, { ...base, id: "expired", recurrenceData: { startDate: "2026-10-01", endDate: "2026-11-22" } }, { ...base, id: "future", recurrenceData: { startDate: "2026-11-25" } }, { ...base, id: "once", recurrenceType: "ONCE", recurrenceData: { startDate: "2026-11-01" } }];
  expect(filterConfiguredRoutines(rows, { ...emptyRoutineFilters, from: "2026-11-23", to: "2026-11-24" }).map(row => row.id)).toEqual(["a"]);
  expect(filterConfiguredRoutines(rows, { ...emptyRoutineFilters, from: "2026-11-22", to: "2026-11-22" }).map(row => row.id)).toEqual(["a", "expired"]);
});
it("identifies equivalent schedules but never calls Monday and Tuesday routines duplicates", () => {
  const rows = [base, { ...base, id: "duplicate", recurrenceData: { startDate: "2026-11-01", weekdays: [1, 1] } }, { ...base, id: "tuesday", recurrenceData: { startDate: "2026-11-01", weekdays: [2] } }, { ...base, id: "other-operator", responsibleId: "u2" }, { ...base, id: "other-period", recurrenceData: { startDate: "2026-11-08", weekdays: [1] } }];
  expect([...duplicateRoutineIds(rows)]).toEqual(["a", "duplicate"]);
  expect(filterConfiguredRoutines(rows, { ...emptyRoutineFilters, duplicatesOnly: true }).map(row => row.id)).toEqual(["a", "duplicate"]);
});
