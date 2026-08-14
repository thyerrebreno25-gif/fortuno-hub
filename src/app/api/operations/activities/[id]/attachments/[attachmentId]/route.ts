import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOperationMember } from "@/modules/operations/auth";
import { createEvent } from "@/modules/operations/activity";

const BUCKET = "operation-attachments";
type Context = { params: Promise<{ id: string; attachmentId: string }> };

async function getAttachment(id: string, attachmentId: string, organizationId: string) {
  return prisma.operationAttachment.findFirst({
    where: {
      id: attachmentId,
      activityId: id,
      activity: { organizationId, deletedAt: null },
    },
  });
}

export async function GET(_request: Request, context: Context) {
  const member = await getOperationMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { id, attachmentId } = await context.params;
  const attachment = await getAttachment(id, attachmentId, member.organizationId);
  if (!attachment) return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Armazenamento indisponível." }, { status: 503 });
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(attachment.storagePath, 60, { download: attachment.name });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Não foi possível abrir o anexo." }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl);
}

export async function DELETE(_request: Request, context: Context) {
  const member = await getOperationMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { id, attachmentId } = await context.params;
  const attachment = await getAttachment(id, attachmentId, member.organizationId);
  if (!attachment) return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });

  const activity = await prisma.operationActivity.findUnique({ where: { id }, select: { status: true } });
  if (!activity || ["COMPLETED", "DISREGARDED"].includes(activity.status)) {
    return NextResponse.json({ error: "Não é possível remover anexos de uma atividade encerrada." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Armazenamento indisponível." }, { status: 503 });
  const { error: removeError } = await admin.storage.from(BUCKET).remove([attachment.storagePath]);
  if (removeError) return NextResponse.json({ error: "Não foi possível remover o arquivo." }, { status: 500 });

  await prisma.operationAttachment.delete({ where: { id: attachment.id } });
  await createEvent(
    id,
    member.userId,
    "ATTACHMENT_ADDED",
    `${member.user.name || member.user.email} removeu o anexo “${attachment.name}”.`,
    { attachmentId: attachment.id },
  );
  return NextResponse.json({ message: "Anexo removido." });
}
