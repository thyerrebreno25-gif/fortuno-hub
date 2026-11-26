type Schedule = Record<string, unknown>;
/** Compare the actual schedule, ignoring UI-only fields and weekday order. */
export function routineScheduleKey(type: string, value: unknown) {
  const data = value && typeof value === "object" ? value as Schedule : {};
  const days = (key: string) => [...new Set(Array.isArray(data[key]) ? data[key] as number[] : [])].sort((a,b)=>a-b);
  const mode = type === "DAILY" ? String(data.dailyMode || "ALL_DAYS") : null;
  const monthDays = days("monthDays");
  if(type === "MONTHLY" && !monthDays.length && typeof data.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.startDate))monthDays.push(Number(data.startDate.slice(-2)));
  return JSON.stringify({type, startDate:data.startDate || null, endDate:data.endDate || null,
    dueTime:data.dueTime || "18:00", interval:type === "CUSTOM" ? 1 : Number(data.interval || 1),
    dailyMode:mode, weekdays:type === "WEEKLY" || type === "CUSTOM" || mode === "CUSTOM_DAYS" ? days("weekdays") : [],
    monthDays:type === "MONTHLY" || type === "CUSTOM" ? monthDays : [], holidayBehavior:"PREVIOUS_BUSINESS_DAY"});
}

export function routineScheduleLabel(type: string, value: unknown) {
  const data = value && typeof value === "object" ? value as Schedule : {};
  if(type==="DAILY"&&Number(data.interval)===15)return `Quinzenal · a cada 15 dias · ${String(data.dueTime||"18:00")}`;
  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const weekdays = Array.isArray(data.weekdays) ? [...new Set(data.weekdays as number[])].sort().map(day=>names[day]).join(", ") : "";
  const label = type === "ONCE" ? "Uma vez" : type === "MONTHLY" ? "Mensal · dia(s) "+(Array.isArray(data.monthDays)&&data.monthDays.length?(data.monthDays as number[]).join(", "):String(data.startDate||"").slice(-2)||"do início") : type === "DAILY" && data.dailyMode === "BUSINESS_DAYS" ? "Dias úteis" : type === "DAILY" && data.dailyMode !== "CUSTOM_DAYS" ? "Diária" : weekdays || "Semanal";
  const interval = Number(data.interval || 1);
  const cadence = interval > 1 && type !== "CUSTOM" && type !== "ONCE" ? `A cada ${interval} ${type === "MONTHLY" ? "meses" : type === "WEEKLY" ? "semanas" : "dias"} · ` : "";
  return `${cadence}${label} · ${String(data.dueTime || "18:00")}`;
}
