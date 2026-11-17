import { z } from "zod";
import { durationCorrectionSchema } from "./duration-correction";

const intervalTimeCorrectionSchema = z.object({
  entryId: z.string().min(1).max(100).optional(),
  newEntryId: z.string().uuid().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  userId: z.string().min(1).max(100).optional(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(5).max(2000),
}).superRefine((data, ctx) => {
  if (data.entryId ? !data.expectedUpdatedAt : !data.newEntryId) ctx.addIssue({ code: "custom", message: "Atualize o apontamento antes de corrigir." });
});
export type TimeCorrectionInput = z.infer<typeof intervalTimeCorrectionSchema>;
// Keep the interval payload compatible with forms already open before publication.
export const timeCorrectionSchema = z.union([durationCorrectionSchema, intervalTimeCorrectionSchema]);

export function correctionInterval(input: Pick<TimeCorrectionInput, "startedAt" | "endedAt">, now = new Date()) {
  const startedAt = new Date(input.startedAt), endedAt = new Date(input.endedAt);
  if (!Number.isFinite(+startedAt) || !Number.isFinite(+endedAt) || +endedAt < +startedAt) throw new Error("O término deve ser igual ou posterior ao início.");
  if (+endedAt > +now) throw new Error("Não é possível apontar tempo no futuro.");
  const seconds = Math.floor((+endedAt - +startedAt) / 1000);
  if (seconds > 2147483647) throw new Error("O período informado é muito longo.");
  return { startedAt, endedAt, seconds };
}

export function brazilDateTimeInput(value: string | Date) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date).replace(" ", "T");
}
export function brazilDateTimeIso(value: string) {
  return new Date(`${value}-03:00`).toISOString();
}

/** Native inputs show seconds; retain the stored fractions until that field is changed. */
export function correctionDates(start: string, end: string, reference: { startedAt: string; endedAt: string } | null = null) {
  const sameStart = reference && start === brazilDateTimeInput(reference.startedAt);
  const sameEnd = reference && end === brazilDateTimeInput(reference.endedAt);
  const startedAt = sameStart ? reference.startedAt : brazilDateTimeIso(start);
  const endedAt = start === end && !(sameStart && sameEnd) ? startedAt : sameEnd ? reference.endedAt : brazilDateTimeIso(end);
  return { startedAt, endedAt };
}
