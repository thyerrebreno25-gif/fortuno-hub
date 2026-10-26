import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { meetingAccess, findMeeting, meetingFailure, MeetingError } from "@/modules/meetings/auth";
import { audioTypes, recordingLimit } from "@/modules/meetings/model";
import { recordingsBucket, transcribeRecording } from "@/modules/meetings/recordings";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canEdit");
    const { meetingId, name, mimeType, size } = z.object({ meetingId: z.string().min(1), name: z.string().min(1).max(200), mimeType: z.string(), size: z.number().int().positive().max(recordingLimit), consent: z.literal(true) }).parse(await request.json());
    await findMeeting(member, meetingId);
    const extension = audioTypes[mimeType];
    if (!extension) throw new MeetingError("Envie áudio MP3, M4A, WAV, OGG, FLAC ou WebM.");
    const admin = createAdminClient();
    if (!admin) throw new MeetingError("O armazenamento de gravações ainda não está configurado.", 503);
    const { data: bucket } = await admin.storage.getBucket(recordingsBucket);
    if (!bucket) {
      const { error } = await admin.storage.createBucket(recordingsBucket, { public: false, fileSizeLimit: recordingLimit, allowedMimeTypes: Object.keys(audioTypes) });
      if (error && !/already exists/i.test(error.message)) throw new MeetingError("Não foi possível preparar o armazenamento privado.", 503);
    } else if (bucket.public) throw new MeetingError("O armazenamento de gravações precisa ser privado.", 503);
    const path = `${member.organizationId}/${meetingId}/${crypto.randomUUID()}.${extension}`;
    const { data: upload, error } = await admin.storage.from(recordingsBucket).createSignedUploadUrl(path);
    if (error || !upload) throw new MeetingError("Não foi possível preparar o envio do áudio.", 503);
    const recording = await prisma.meetingRecording.create({ data: { meetingId, uploadedById: member.userId, name: `${name.replace(/\.[^.]+$/, "")}.${extension}`, mimeType, size, storagePath: path, consentAt: new Date() } });
    return NextResponse.json({ id: recording.id, path, token: upload.token });
  } catch (error) { return meetingFailure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { member } = await meetingAccess("MEETINGS", "canEdit");
    const { id, retry } = z.object({ id: z.string().min(1), retry: z.boolean().optional() }).parse(await request.json());
    const recording = await prisma.meetingRecording.findUnique({ where: { id } });
    if (!recording) throw new MeetingError("Gravação não encontrada.", 404);
    await findMeeting(member, recording.meetingId);
    if (recording.status === "UPLOADING") {
      if (recording.uploadedById !== member.userId) throw new MeetingError("Somente quem enviou pode finalizar o áudio.", 403);
      const admin = createAdminClient();
      const result = await admin?.storage.from(recordingsBucket).download(recording.storagePath);
      if (!result?.data || result.error || result.data.size !== recording.size || result.data.size > recordingLimit) throw new MeetingError("O envio do áudio está incompleto. Envie novamente.");
      await prisma.meetingRecording.update({ where: { id }, data: { status: "READY" } });
    } else if (!retry) return NextResponse.json({ ok: true });
    if (retry && !process.env.OPENAI_API_KEY) throw new MeetingError("A transcrição depende da configuração da API OpenAI.", 503);
    after(() => transcribeRecording(id));
    return NextResponse.json({ ok: true, transcriptionQueued: Boolean(process.env.OPENAI_API_KEY) });
  } catch (error) { return meetingFailure(error); }
}
export async function GET(request: Request) {
  try {
    const { member } = await meetingAccess();
    const id = new URL(request.url).searchParams.get("id") || "";
    const recording = await prisma.meetingRecording.findUnique({ where: { id } });
    if (!recording || recording.status === "UPLOADING") throw new MeetingError("Áudio indisponível.", 404);
    await findMeeting(member, recording.meetingId);
    const admin = createAdminClient();
    const result = await admin?.storage.from(recordingsBucket).createSignedUrl(recording.storagePath, 3600);
    if (!result?.data || result.error) throw new MeetingError("Não foi possível abrir o áudio.");
    return NextResponse.redirect(result.data.signedUrl);
  } catch (error) { return meetingFailure(error); }
}
