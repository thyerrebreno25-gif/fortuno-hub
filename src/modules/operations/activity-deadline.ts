type ActivityDate = { scheduledDate?: Date | string | null; dueAt?: Date | string | null; status?: string };
export function operationToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function activityDueDay(activity: ActivityDate) {
  if (activity.scheduledDate) return new Date(activity.scheduledDate).toISOString().slice(0, 10);
  return activity.dueAt ? operationToday(new Date(activity.dueAt)) : null;
}
export function activityOverdue(activity: ActivityDate, now = new Date()) {
  if (["COMPLETED", "DISREGARDED"].includes(activity.status || "")) return false;
  const day = activityDueDay(activity);
  return Boolean(day && day < operationToday(now));
}
export function activityCompletedLate(activity: ActivityDate & { completedAt?: Date | string | null }) {
  const day = activityDueDay(activity);
  return day && activity.completedAt ? operationToday(new Date(activity.completedAt)) > day : null;
}
/** scheduledDate is a calendar day stored in UTC; dueAt is an instant in Brasília. */
export function overdueActivityDates(now = new Date()) {
  const today = operationToday(now);
  return { OR: [{ scheduledDate: { lt: new Date(today + "T00:00:00Z") } }, { scheduledDate: null, dueAt: { lt: new Date(today + "T00:00:00-03:00") } }] };
}
export function operationDayRange(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Selecione uma data válida.");
  const start = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(+start) || start.toISOString().slice(0, 10) !== day) throw new Error("Selecione uma data válida.");
  return { gte: start, lt: new Date(+start + 86400000) };
}
