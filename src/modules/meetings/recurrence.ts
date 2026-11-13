import { z } from "zod";

export const meetingWeekdays = [
  { value: 1, label: "Segunda" }, { value: 2, label: "Terça" }, { value: 3, label: "Quarta" },
  { value: 4, label: "Quinta" }, { value: 5, label: "Sexta" }, { value: 6, label: "Sábado" }, { value: 0, label: "Domingo" },
];
export const recurrenceInput = z.object({
  frequency: z.enum(["DAILY", "WEEKLY"]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]).transform(days => [...new Set(days)].sort()),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data final da recorrência."),
}).refine(value => value.frequency !== "WEEKLY" || value.weekdays.length > 0, { message: "Selecione pelo menos um dia da semana.", path: ["weekdays"] });
export type MeetingRecurrence = z.infer<typeof recurrenceInput>;
const dayMs = 86400000;
export function meetingOccurrences(startsAt: Date, endsAt: Date, recurrence?: MeetingRecurrence | null) {
  if (!Number.isFinite(+startsAt) || !Number.isFinite(+endsAt) || endsAt <= startsAt) throw Error("Informe início e término válidos.");
  if (!recurrence) return [{ startsAt, endsAt }];
  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(startsAt);
  const [firstDay, clock] = local.split(" ");
  const first = new Date(`${firstDay}T12:00:00Z`), last = new Date(`${recurrence.until}T12:00:00Z`);
  if (!Number.isFinite(+last) || last.toISOString().slice(0,10) !== recurrence.until || last < first) throw Error("A data final deve ser válida e igual ou posterior ao início.");
  if (+last - +first > 365 * dayMs) throw Error("Selecione um período de até um ano para gerar as reuniões.");
  const occurrences: Array<{ startsAt: Date; endsAt: Date }> = [];
  for (let day = +first; day <= +last; day += dayMs) {
    const date = new Date(day);
    if (recurrence.frequency === "WEEKLY" && !recurrence.weekdays.includes(date.getUTCDay())) continue;
    const start = new Date(`${date.toISOString().slice(0,10)}T${clock}-03:00`);
    occurrences.push({ startsAt: start, endsAt: new Date(+start + (+endsAt - +startsAt)) });
    if (occurrences.length > 100) throw Error("O período gera mais de 100 reuniões. Reduza a data final.");
  }
  if (!occurrences.length) throw Error("Nenhuma reunião nos dias selecionados dentro deste período.");
  return occurrences;
}
