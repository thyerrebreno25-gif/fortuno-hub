import { dayKey } from "./model";

export const dailyMeetingTypes = ["Daily", "Semanal de squad"];

/** Calendar dates are São Paulo dates; holidays use the operation calendar. */
export function nextBusinessDeadline(deadline: Date, holidays: Iterable<string> = []) {
  const excluded = new Set(holidays);
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(deadline);
  let date = new Date(`${dayKey(deadline)}T12:00:00Z`);
  do { date = new Date(+date + 86400000); }
  while ([0, 6].includes(date.getUTCDay()) || excluded.has(date.toISOString().slice(0, 10)));
  return new Date(`${date.toISOString().slice(0, 10)}T${parts}.${String(deadline.getMilliseconds()).padStart(3, "0")}-03:00`);
}

export function dailyDeadlineEditAllowed(type: string, previous: {dueAt: Date; autoExtendedAt: Date | null}, proposed: Date, now = new Date()) {
  if (type !== "Daily" || +proposed <= +previous.dueAt) return true;
  return !previous.autoExtendedAt && +previous.dueAt > +now;
}

export function dailyScope(member: {organizationId: string; userId: string; role: string}, all: boolean) {
  const manager = ["MASTER", "ADMIN", "MANAGER"].includes(member.role);
  return { meeting: {organizationId: member.organizationId, deletedAt: null, status: {not: "CANCELLED"}, type: {in: dailyMeetingTypes}}, ...(!manager || !all ? {responsibleId: member.userId} : {}) };
}

export function dailyManagers(members: Array<{id: string; userId: string; role: string}>, leaderId: string | null, responsibleId: string | null) {
  const managers = members.filter(person => ["MASTER", "ADMIN", "MANAGER"].includes(person.role));
  const direct = members.filter(person => person.id === leaderId || person.userId === responsibleId && managers.some(manager => manager.id === person.id));
  return direct.length ? direct : managers;
}
