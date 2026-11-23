import { z } from "zod";
import { operationDayRange } from "./activity-deadline";
const day = z.string().refine(value => { try { operationDayRange(value); return true; } catch { return false; } }, "Selecione uma data válida.");
export const activityEditSchema = z.object({ expectedUpdatedAt: z.iso.datetime(), title: z.string().trim().min(1).max(200), description: z.string().trim().max(10000), day: day.nullable(), dueTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), subjectToFine: z.boolean() });
export const routineEditSchema = z.object({ expectedUpdatedAt: z.iso.datetime(), responsibleId: z.string().max(100).nullable(), team: z.string().max(200).nullable(), priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), notifyClient: z.boolean(), auditEnabled: z.boolean(), recurrenceType: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]), recurrenceData: z.object({ startDate: day, endDate: day.nullable(), dueTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), interval: z.number().int().min(1).max(365), dailyMode: z.enum(["ALL_DAYS", "BUSINESS_DAYS", "CUSTOM_DAYS"]), weekdays: z.array(z.number().int().min(0).max(6)).max(7), monthDays: z.array(z.number().int().min(1).max(31)).max(31), holidayBehavior: z.enum(["KEEP", "PREVIOUS_BUSINESS_DAY", "NEXT_BUSINESS_DAY", "SKIP"]) }) }).superRefine((value, ctx) => {
  const schedule = value.recurrenceData;
  if (schedule.endDate && schedule.endDate < schedule.startDate) ctx.addIssue({ code: "custom", message: "O fim da rotina deve ser posterior ao início." });
  if ((["CUSTOM", "WEEKLY"].includes(value.recurrenceType) || value.recurrenceType === "DAILY" && schedule.dailyMode === "CUSTOM_DAYS") && !schedule.weekdays.length) ctx.addIssue({ code: "custom", message: "Selecione os dias da semana." });
  if (value.recurrenceType === "MONTHLY" && !schedule.monthDays.length) ctx.addIssue({ code: "custom", message: "Selecione os dias fixos do mês." });
});
export type ActivityEdit = z.infer<typeof activityEditSchema>;
export type RoutineEdit = z.infer<typeof routineEditSchema>;
