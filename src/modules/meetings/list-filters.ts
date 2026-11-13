import { dayKey } from "./model";
import { calendarDate, shiftDay } from "./calendar-layout";

export const meetingPeriods = [
  { value: "upcoming", label: "Próximas reuniões" },
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "nextMonth", label: "Próximo mês" },
  { value: "custom", label: "Personalizado" },
  { value: "past", label: "Anteriores" },
];
function start(key: string) { return new Date(`${key}T00:00:00-03:00`); }
export function meetingListFilter(params: URLSearchParams, userId: string, deleted = false, now = new Date()) {
  const scope = params.get("scope") || "mine";
  const personal = scope === "all" ? {} : scope === "responsible" ? { responsibleId: userId } : {
    OR: [{ createdById: userId }, { responsibleId: userId }, { participants: { some: { userId } } }],
  };
  const period = params.get("period") || "upcoming";
  if(!meetingPeriods.some(item=>item.value===period)) throw new Error("Período inválido.");
  const today = dayKey(now);
  let from = today, to = shiftDay(today, 1);
  if (period === "week") { from = shiftDay(today, -((calendarDate(today).getUTCDay() + 6) % 7)); to = shiftDay(from, 7); }
  if (period === "month" || period === "nextMonth") {
    const date = calendarDate(`${today.slice(0, 7)}-01`);
    const offset = period === "nextMonth" ? 1 : 0;
    from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
    to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + 1, 1)).toISOString().slice(0, 10);
  }
  if (period === "custom") {
    from = params.get("from") || ""; const until = params.get("to") || "";
    const valid = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(+calendarDate(key)) && calendarDate(key).toISOString().slice(0, 10) === key;
    if (!valid(from) || !valid(until) || from > until) throw new Error("Selecione um período válido para as reuniões.");
    to = shiftDay(until, 1);
  }
  const dates = deleted ? {} : period === "upcoming" ? { endsAt: { gte: now }, status: "SCHEDULED" } : period === "past" ? { endsAt: { lt: now } } : { startsAt: { gte: start(from), lt: start(to) } };
  return { personal, dates, direction: (period === "past" || deleted ? "desc" : "asc") as "asc" | "desc" };
}
