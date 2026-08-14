import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOperationMember } from "@/modules/operations/auth";
import { createEvent } from "@/modules/operations/activity";

const BUCKET = "operation-attachments";
const MAX_FILE_SIZE = 15 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120) || "arquivo";
}

function fileExtension(value: string) {
  return value.split(".").pop()?.toLowerCase() || "";
}

async function ensureBucket(admin: NonNullable<ReturnType<typeof createAdminClient>>) {
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw error;
  if (data.some((bucket) => bucket.id === BUCKET)) return;

  const { error: createError } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE,
  });

  if (createError && !createError.message.toLowerCase().includes("exist")) {
    throw createError;
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const member = await getOperationMember();
    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const { id } = await context.params;
    const activity = await prisma.operationActivity.findFirst({
      where: { id, organizationId: member.organizationId, deletedAt: null },
      include: {
        process: { select: { allowedFileTypes: true } },
        checklistItems: true,
      },
    });
    if (!activity) {
      return NextResponse.json(
        { error: "Atividade não encontrada." },
        { status: 404 },
      );
    }
    if (["COMPLETED", "DISREGARDED"].includes(activity.status)) {
      return NextResponse.json(
        { error: "Não é possível anexar arquivos a uma atividade encerrada." },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const checklistItemId = String(formData.get("checklistItemId") || "") || null;

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Selecione um arquivo válido." },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "O arquivo deve possuir no máximo 15 MB." },
        { status: 400 },
      );
    }

    const checklistItem = checklistItemId
      ? activity.checklistItems.find((item) => item.id === checklistItemId)
      : null;
    if (checklistItemId && !checklistItem) {
      return NextResponse.json(
        { error: "Item obrigatório não encontrado nesta atividade." },
        { status: 400 },
      );
    }

    const allowed = checklistItem?.allowedFileTypes.length
      ? checklistItem.allowedFileTypes
      : activity.process.allowedFileTypes;
    const extension = fileExtension(file.name);
    if (
      allowed.length > 0 &&
      !allowed.some((type) => {
        const normalized = type.toLowerCase().replace(/^\./, "");
        return normalized === extension || normalized === file.type.toLowerCase();
      })
    ) {
      return NextResponse.json(
        { error: `Formato não permitido. Utilize: ${allowed.join(", ")}.` },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "O armazenamento de anexos não está configurado." },
        { status: 503 },
      );
    }

    await ensureBucket(admin);
    const storagePath = `${member.organizationId}/${id}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    try {
      const attachment = await prisma.operationAttachment.create({
        data: {
          activityId: id,
          checklistItemId,
          uploadedById: member.userId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          storagePath,
        },
      });
      await createEvent(
        id,
        member.userId,
        "ATTACHMENT_ADDED",
        `${member.user.name || member.user.email} anexou “${file.name}”.`,
        { attachmentId: attachment.id, checklistItemId },
      );
      return NextResponse.json({ attachment }, { status: 201 });
    } catch (databaseError) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      throw databaseError;
    }
  } catch (error) {
    console.error("Erro ao anexar arquivo à atividade:", error);
    return NextResponse.json(
      { error: "Não foi possível anexar o arquivo." },
      { status: 500 },
    );
  }
}
