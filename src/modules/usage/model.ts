import { usageDay } from "./catalog";
export type UsageMetrics = { actions: number; imports: number; caSends: number; messages: number; visits: number; activeSeconds: number; taskSeconds: number };
export type UsageRecord = UsageMetrics & { userId: string | null; clientId: string | null; pageKey: string; day: string; lastAt: string };
export type UsagePerson = { id: string; name: string; role: string };
export type UsageClient = { id: string; name: string; responsibleIds: string[]; responsibleNames: string[] };
export type UsageRow = UsageMetrics & { id: string; name: string; activeDays: number; lastAt: string | null; users: number; clients: number; pages: number };
export const emptyMetrics = (): UsageMetrics => ({ actions: 0, imports: 0, caSends: 0, messages: 0, visits: 0, activeSeconds: 0, taskSeconds: 0 });
const keys = Object.keys(emptyMetrics()) as Array<keyof UsageMetrics>;
export function usagePeriod(from: string | null, to: string | null, now = new Date()) {
  const today = usageDay(now), fallback = today.slice(0, 7) + "-01";
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
  const startDay = from || fallback, endDay = to || today;
  if (!valid(startDay) || !valid(endDay) || endDay < startDay || endDay > today || (Date.parse(endDay) - Date.parse(startDay)) / 86400000 > 365) throw new Error("Selecione até 366 dias, sem datas futuras.");
  const end = new Date(endDay + "T00:00:00-03:00"); end.setUTCDate(end.getUTCDate() + 1);
  return { from: startDay, to: endDay, start: new Date(startDay + "T00:00:00-03:00"), end };
}
export function buildUsageReport(records: UsageRecord[], people: UsagePerson[], clients: UsageClient[], pages: Array<{key: string; label: string}>, filters: { userId?: string; clientId?: string; pageKey?: string } = {}) {
  const visiblePeople = people.filter(p => !filters.userId || p.id === filters.userId);
  const visibleClients = clients.filter(c => (!filters.clientId || c.id === filters.clientId) && (!filters.userId || c.responsibleIds.includes(filters.userId) || records.some(r => r.userId === filters.userId && r.clientId === c.id)));
  const filtered = records.filter(r => (!filters.userId || r.userId === filters.userId) && (!filters.clientId || r.clientId === filters.clientId) && (!filters.pageKey || r.pageKey === filters.pageKey));
  function row(id: string, name: string, source: UsageRecord[]): UsageRow {
    const totals = emptyMetrics(); for (const r of source) for (const key of keys) totals[key] += Math.max(0, Number(r[key]) || 0);
    const active = source.filter(r => r.actions > 0 || r.activeSeconds > 0 || r.visits > 0 || r.taskSeconds > 0);
    return { id, name, ...totals, activeDays: new Set(active.map(r => r.day)).size, lastAt: active.reduce<string | null>((latest, r) => !latest || r.lastAt > latest ? r.lastAt : latest, null), users: new Set(active.flatMap(r => r.userId ? [r.userId] : [])).size, clients: new Set(active.flatMap(r => r.clientId ? [r.clientId] : [])).size, pages: new Set(active.map(r => r.pageKey)).size };
  }
  const byUser = visiblePeople.map(p => ({ ...row(p.id, p.name, filtered.filter(r => r.userId === p.id)), role: p.role }));
  const byClient = visibleClients.map(c => ({ ...row(c.id, c.name, filtered.filter(r => r.clientId === c.id)), responsibleNames: c.responsibleNames }));
  const byPage = pages.filter(p => !filters.pageKey || p.key === filters.pageKey).map(p => row(p.key, p.label, filtered.filter(r => r.pageKey === p.key)));
  const rank = (a: UsageRow, b: UsageRow) => b.actions - a.actions || b.activeSeconds - a.activeSeconds || b.visits - a.visits || a.name.localeCompare(b.name, "pt-BR");
  const total = row("all", "Total", filtered);
  return { total, byUser: byUser.sort(rank), byClient: byClient.sort(rank), byPage: byPage.sort(rank), summary: { usersWithUse: byUser.filter(r => r.lastAt).length, usersTotal: byUser.length, clientsWithActions: byClient.filter(r => r.actions > 0).length, clientsTotal: byClient.length, clientsWithoutActions: byClient.filter(r => r.actions === 0).length, clientsWithoutImports: byClient.filter(r => r.imports === 0).length, pagesWithUse: byPage.filter(r => r.lastAt).length, pagesTotal: byPage.length }, daily: [...new Set(filtered.map(r => r.day))].sort().map(day => ({ day, ...row(day, day, filtered.filter(r => r.day === day)) })), records: filtered };
}
export type UsageReport = ReturnType<typeof buildUsageReport>;
export type UsagePayload = UsageReport & { generatedAt: string; trackingSince: string | null; from: string; to: string; people: UsagePerson[]; clients: UsageClient[]; pages: Array<{key: string; label: string}> };
