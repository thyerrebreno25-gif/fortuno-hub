import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordingLimit } from "./model";
export const recordingsBucket = "meeting-recordings";
export async function transcribeRecording(id: string) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return;
  const claim = await prisma.meetingRecording.updateMany({ where: { id, OR: [{ status: { in: ["READY", "FAILED"] } }, { status: "TRANSCRIBING", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }, data: { status: "TRANSCRIBING", error: null } });
  if (!claim.count) return;
  try {
    const recording = await prisma.meetingRecording.findUniqueOrThrow({ where: { id } });
    const admin = createAdminClient();
    if (!admin) throw new Error("Armazenamento de gravações indisponível.");
    const { data: audio, error } = await admin.storage.from(recordingsBucket).download(recording.storagePath);
    if (error || !audio || audio.size > recordingLimit) throw new Error("Não foi possível ler o áudio salvo.");
    const form = new FormData();
    form.append("file", audio, recording.name);
    form.append("model", process.env.OPENAI_MEETING_TRANSCRIPTION_MODEL || "gpt-transcribe");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw new Error(`A transcrição não foi concluída (${response.status}). O áudio foi preservado; tente novamente.`);
    const result = await response.json();
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("Não foi identificada fala no áudio. Confira a gravação antes de tentar novamente.");
    await prisma.meetingRecording.update({ where: { id }, data: { status: "DONE", transcript: result.text, error: null } });
  } catch (error) {
    await prisma.meetingRecording.update({ where: { id }, data: { status: "FAILED", error: error instanceof Error ? error.message : "Falha na transcrição." } });
  }
}
