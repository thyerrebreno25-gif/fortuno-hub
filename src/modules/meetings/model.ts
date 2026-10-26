import { z } from "zod";

export const meetingTypes = ["Daily", "Semanal de squad", "Planejamento", "Retrospectiva", "Alinhamento", "Reunião com cliente"];
const date = z.string().datetime({ offset: true }).transform((value) => new Date(value));
export const meetingInput = z.object({
  title: z.string().trim().min(3).max(180), type: z.string().trim().min(2).max(100),
  startsAt: date, endsAt: date,
  location: z.string().trim().max(1000).default(""), agenda: z.string().max(20000).default(""), notes: z.string().max(30000).default(""),
  participantIds: z.array(z.string().min(1).max(100)).min(1).max(100).transform((ids) => [...new Set(ids)]),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).default("SCHEDULED"),
}).refine((value) => value.endsAt > value.startsAt, { message: "O término deve ser depois do início.", path: ["endsAt"] });
export const actionInput = z.object({ title: z.string().trim().min(2).max(300), description: z.string().max(5000).default(""), responsibleId: z.string().min(1).max(100), dueAt: date });
export const eventInput = z.object({ title: z.string().trim().min(2).max(300), description: z.string().max(5000).default(""), location: z.string().max(1000).default(""), startsAt: date, endsAt: date }).refine((value) => value.endsAt > value.startsAt, { message: "O término deve ser depois do início." });
export function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function reminderKey(action: { id: string; dueAt: Date }, now: Date) {
  return `action:${action.id}:${action.dueAt.toISOString()}:${dayKey(now)}`;
}
export function actionEvent(action: { title: string; description: string; dueAt: Date; completedAt: Date | null }) {
  return { title: `${action.completedAt ? "✓ Concluída · " : "Entrega · "}${action.title}`, description: action.description, startsAt: action.dueAt, endsAt: new Date(action.dueAt.getTime() + 30 * 60_000), status: action.completedAt ? "COMPLETED" : "ACTIVE" };
}
export function editableMeeting(member: { userId: string; role: string; isTeamLeader: boolean }, meeting: { createdById: string }) {
  return meeting.createdById === member.userId || ["MASTER", "ADMIN", "MANAGER"].includes(member.role);
}
export const recordingLimit = 24_000_000;
export const audioTypes: Record<string, string> = { "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/flac": "flac" };
