export type Person = { id: string; name: string | null; email: string };
export type MeetingAction = { id: string; title: string; description: string; dueAt: string; completedAt: string | null; responsibleId: string; responsible: Person; revision: number };
export type Meeting = { id: string; title: string; type: string; startsAt: string; endsAt: string; agenda: string; notes: string; location: string; status: string; revision: number; createdById: string; participants: Array<{ userId: string; user: Person }>; actions: MeetingAction[]; contributions: Array<{ id: string; body: string; createdAt: string; author: { name: string | null; email: string } }>; recordings: Array<{ id: string; name: string; status: string; transcript: string; error: string | null; size: number; createdAt: string }> };
export type MeetingOptions = { userId: string; members: Person[]; permissions: { canCreate: boolean; canEdit: boolean }; emailConfigured: boolean; remindersConfigured: boolean; recordingConfigured: boolean; transcriptionConfigured: boolean };
export async function meetingRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a ação.");
  return data;
}
export function jsonRequest(method: string, body: unknown): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
export function formatMeetingDate(value: string) { return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }); }
export function localDateInput(value: string | Date) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  return parts.replace(" ", "T");
}
export function inputToIso(value: string) { return new Date(`${value}:00-03:00`).toISOString(); }
export const meetingStatus: Record<string, string> = { SCHEDULED: "Agendada", COMPLETED: "Realizada", CANCELLED: "Cancelada" };
