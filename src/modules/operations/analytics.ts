export type AnalyticsPerson = { id: string; name: string | null; email: string };
export type AnalyticsActivity = {
  id: string; title: string; status: string; scheduledDate: Date | string | null; createdAt: Date | string;
  dueAt: Date | string | null; completedAt: Date | string | null; responsibleId: string | null;
  team: string | null; clientCluster: string | null;
  client: { id: string; name: string; cluster: string }; process: { id: string; name: string };
  responsible: AnalyticsPerson | null;
};
export type AnalyticsEntry = { id: string; activityId: string; userId: string; startedAt: Date | string; endedAt: Date | string | null; seconds: number; user: AnalyticsPerson; activity: AnalyticsActivity };
export type AnalyticsPeriod = { from: string; to: string; start: Date; end: Date; days: number };
export type AnalyticsGroup = { id: string; name: string; planned: number; completed: number; pending: number; overdue: number; withoutTime: number; worked: number; seconds: number; runningSeconds: number; averageSeconds: number; share: number; previousSeconds: number };
export type AnalyticsDetail = { id: string; title: string; clientId: string; client: string; processId: string; process: string; responsibleId: string | null; responsible: string; scheduledDate: string | null; status: string; dueAt: string | null; planned: boolean; seconds: number; runningSeconds: number; operators: Array<{ id: string; name: string; seconds: number }>; entries: number };
const DAY = 86400000;
const stamp = (value: Date | string) => new Date(value).getTime();
export function brazilDay(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
export function shiftDay(value: string, days: number) { return new Date(Date.parse(`${value}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
export function analyticsPeriod(from: string, to: string): AnalyticsPeriod {
  for (const day of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error("Informe datas válidas.");
  }
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY) + 1;
  if (days < 1 || days > 366) throw new Error("Selecione um período de 1 a 366 dias.");
  return { from, to, start: new Date(`${from}T00:00:00-03:00`), end: new Date(`${shiftDay(to, 1)}T00:00:00-03:00`), days };
}
export function precedingPeriod(period: AnalyticsPeriod) { return analyticsPeriod(shiftDay(period.from, -period.days), shiftDay(period.from, -1)); }
export function scheduledDay(activity: AnalyticsActivity) { return activity.scheduledDate ? new Date(activity.scheduledDate).toISOString().slice(0, 10) : brazilDay(new Date(activity.createdAt)); }
const personName = (person: AnalyticsPerson | null) => person?.name || person?.email || "Sem responsável";

/** Closed entries use recorded seconds; boundary overlaps are prorated, not counted twice. */
export function entryAllocation(entry: AnalyticsEntry, period: AnalyticsPeriod, now: Date) {
  const start = stamp(entry.startedAt), finish = entry.endedAt ? stamp(entry.endedAt) : +now, end = Math.min(finish, +now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { seconds: 0, days: [] as Array<{ date: string; seconds: number }> };
  const overlapStart = Math.max(start, +period.start), overlapEnd = Math.min(end, +period.end);
  if (overlapEnd <= overlapStart) return { seconds: 0, days: [] as Array<{ date: string; seconds: number }> };
  const recorded = entry.endedAt ? Math.max(0, entry.seconds) : Math.floor((end - start) / 1000);
  const seconds = Math.round(recorded * (overlapEnd - overlapStart) / (finish - start));
  const days: Array<{ date: string; seconds: number }> = [];
  let cursor = overlapStart, assigned = 0;
  while (cursor < overlapEnd) {
    const date = brazilDay(new Date(cursor)), next = Math.min(+new Date(`${shiftDay(date, 1)}T00:00:00-03:00`), overlapEnd);
    const part = next === overlapEnd ? seconds - assigned : Math.floor(seconds * (next - cursor) / (overlapEnd - overlapStart));
    days.push({ date, seconds: part }); assigned += part; cursor = next;
  }
  return { seconds, days };
}

function summarize(activities: AnalyticsActivity[], entries: AnalyticsEntry[], period: AnalyticsPeriod, now: Date, operatorId?: string) {
  const detail = new Map<string, AnalyticsDetail>();
  const groups = { clients: new Map<string, AnalyticsGroup>(), operators: new Map<string, AnalyticsGroup>(), processes: new Map<string, AnalyticsGroup>(), teams: new Map<string, AnalyticsGroup>(), clusters: new Map<string, AnalyticsGroup>() };
  const worked = new Map<AnalyticsGroup, Set<string>>();
  const get = (kind: keyof typeof groups, id: string, name: string) => {
    let group = groups[kind].get(id);
    if (!group) { group = { id, name, planned: 0, completed: 0, pending: 0, overdue: 0, withoutTime: 0, worked: 0, seconds: 0, runningSeconds: 0, averageSeconds: 0, share: 0, previousSeconds: 0 }; groups[kind].set(id, group); worked.set(group, new Set()); }
    return group;
  };
  const activityGroups = (activity: AnalyticsActivity) => [get("clients", activity.client.id, activity.client.name), get("processes", activity.process.id, activity.process.name), get("teams", activity.team || "none", activity.team || "Sem equipe"), get("clusters", activity.clientCluster || activity.client.cluster, `Cluster ${activity.clientCluster || activity.client.cluster}`)];
  const rowFor = (activity: AnalyticsActivity) => {
    let row = detail.get(activity.id);
    if (!row) { row = { id: activity.id, title: activity.title, clientId: activity.client.id, client: activity.client.name, processId: activity.process.id, process: activity.process.name, responsibleId: activity.responsibleId, responsible: personName(activity.responsible), scheduledDate: activity.scheduledDate ? scheduledDay(activity) : null, status: activity.status, dueAt: activity.dueAt ? new Date(activity.dueAt).toISOString() : null, planned: false, seconds: 0, runningSeconds: 0, operators: [], entries: 0 }; detail.set(row.id, row); }
    return row;
  };
  const daily = Array.from({ length: period.days }, (_, index) => ({ date: shiftDay(period.from, index), seconds: 0, planned: 0 }));
  const byDay = new Map(daily.map((item) => [item.date, item]));
  const planned = activities.filter((activity) => { const day = scheduledDay(activity); return day >= period.from && day <= period.to && (!operatorId || activity.responsibleId === operatorId); });
  for (const activity of planned) {
    rowFor(activity).planned = true;
    const day = byDay.get(scheduledDay(activity)); if (day) day.planned++;
    for (const group of [...activityGroups(activity), get("operators", activity.responsibleId || "unassigned", personName(activity.responsible))]) {
      group.planned++; if (activity.status === "COMPLETED") group.completed++;
      if (!["COMPLETED", "DISREGARDED"].includes(activity.status)) { group.pending++; if (activity.dueAt && stamp(activity.dueAt) < +now) group.overdue++; }
    }
  }
  let seconds = 0, runningSeconds = 0, sessions = 0, runningTimers = 0, longRunningTimers = 0;
  const contributingOperators = new Set<string>();
  for (const entry of entries) {
    if (operatorId && entry.userId !== operatorId) continue;
    const allocation = entryAllocation(entry, period, now);
    if (!allocation.seconds) continue;
    sessions++; seconds += allocation.seconds; contributingOperators.add(entry.userId);
    const running = !entry.endedAt;
    if (running) { runningSeconds += allocation.seconds; runningTimers++; if (+now - stamp(entry.startedAt) > 12 * 3600000) longRunningTimers++; }
    for (const day of allocation.days) { const point = byDay.get(day.date); if (point) point.seconds += day.seconds; }
    const row = rowFor(entry.activity); row.seconds += allocation.seconds; row.entries++;
    if (running) row.runningSeconds += allocation.seconds;
    let author = row.operators.find((item) => item.id === entry.userId);
    if (!author) { author = { id: entry.userId, name: personName(entry.user), seconds: 0 }; row.operators.push(author); }
    author.seconds += allocation.seconds;
    for (const group of [...activityGroups(entry.activity), get("operators", entry.userId, personName(entry.user))]) {
      group.seconds += allocation.seconds; if (running) group.runningSeconds += allocation.seconds;
      worked.get(group)!.add(entry.activityId);
    }
  }
  for (const activity of planned) {
    const row = detail.get(activity.id)!;
    if (!row.seconds && activity.status !== "DISREGARDED") {
      for (const group of activityGroups(activity)) group.withoutTime++;
    }
    const responsible = groups.operators.get(activity.responsibleId || "unassigned")!;
    if (activity.status !== "DISREGARDED" && !worked.get(responsible)!.has(activity.id)) responsible.withoutTime++;
  }
  for (const map of Object.values(groups)) for (const group of map.values()) {
    group.worked = worked.get(group)!.size; group.averageSeconds = group.worked ? Math.round(group.seconds / group.worked) : 0; group.share = seconds ? group.seconds / seconds * 100 : 0;
  }
  const details = [...detail.values()].sort((a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title));
  const eligible = planned.filter((item) => item.status !== "DISREGARDED");
  const withoutTime = eligible.filter((item) => !detail.get(item.id)?.seconds).length;
  const statusCounts = Object.fromEntries(["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "DISREGARDED"].map((status) => [status, planned.filter((item) => item.status === status).length]));
  return {
    summary: { seconds, closedSeconds: seconds - runningSeconds, runningSeconds, planned: planned.length, worked: details.filter((row) => row.seconds > 0).length, completed: statusCounts.COMPLETED, pending: statusCounts.OPEN + statusCounts.IN_PROGRESS + statusCounts.BLOCKED, blocked: statusCounts.BLOCKED, overdue: planned.filter((a) => !["COMPLETED", "DISREGARDED"].includes(a.status) && a.dueAt && stamp(a.dueAt) < +now).length, withoutTime, completedWithoutTime: planned.filter((item) => item.status === "COMPLETED" && !detail.get(item.id)?.seconds).length, coverage: eligible.length ? (eligible.length - withoutTime) / eligible.length * 100 : null, averageSeconds: details.some((row) => row.seconds > 0) ? Math.round(seconds / details.filter((row) => row.seconds > 0).length) : 0, clients: groups.clients.size, operators: contributingOperators.size, sessions, runningTimers, longRunningTimers },
    groups, details, daily, statusCounts,
  };
}

export function buildOperationsAnalytics(activities: AnalyticsActivity[], entries: AnalyticsEntry[], period: AnalyticsPeriod, now = new Date(), operatorId?: string) {
  const current = summarize(activities, entries, period, now, operatorId), previous = summarize(activities, entries, precedingPeriod(period), now, operatorId);
  const sorted = (kind: keyof typeof current.groups) => [...current.groups[kind].values()].map((row) => ({ ...row, previousSeconds: previous.groups[kind].get(row.id)?.seconds || 0 })).sort((a, b) => b.seconds - a.seconds || b.planned - a.planned || a.name.localeCompare(b.name));
  return { period: { from: period.from, to: period.to, days: period.days }, previousPeriod: { from: precedingPeriod(period).from, to: precedingPeriod(period).to }, generatedAt: now.toISOString(), summary: current.summary, previous: previous.summary, byClient: sorted("clients"), byOperator: sorted("operators"), byProcess: sorted("processes"), byTeam: sorted("teams"), byCluster: sorted("clusters"), activities: current.details, daily: current.daily, statusCounts: current.statusCounts };
}
export type OperationsAnalytics = ReturnType<typeof buildOperationsAnalytics>;
