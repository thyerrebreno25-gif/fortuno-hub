import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SupportAttachment } from "@/modules/support/types/support.types";

export const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";
export const SUPPORT_ATTACHMENT_MAX_SIZE = 15 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_MAX_FILES = 10;

function safeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-140) || "arquivo";
}

async function ensureBucket(admin: NonNullable<ReturnType<typeof createAdminClient>>) {
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw error;
  if (data.some((bucket) => bucket.id === SUPPORT_ATTACHMENTS_BUCKET)) return;
  const { error: createError } = await admin.storage.createBucket(SUPPORT_ATTACHMENTS_BUCKET, {
    public: false,
    fileSizeLimit: SUPPORT_ATTACHMENT_MAX_SIZE,
  });
  if (createError && !createError.message.toLowerCase().includes("exist")) throw createError;
}

export async function uploadSupportAttachments(input: {
  organizationId: string;
  ticketId: string;
  messageId: string;
  files: File[];
}) {
  const files = input.files.filter((file) => file.size > 0).slice(0, SUPPORT_ATTACHMENT_MAX_FILES);
  if (!files.length) return { attachments: [] as SupportAttachment[], storagePaths: [] as string[] };
  const oversized = files.find((file) => file.size > SUPPORT_ATTACHMENT_MAX_SIZE);
  if (oversized) throw new Error(`O arquivo “${oversized.name}” ultrapassa o limite de 15 MB.`);

  const admin = createAdminClient();
  if (!admin) throw new Error("O armazenamento de anexos não está configurado.");
  await ensureBucket(admin);
  const attachments: SupportAttachment[] = [];
  const storagePaths: string[] = [];
  try {
    for (const file of files) {
      const id = crypto.randomUUID();
      const storagePath = `${input.organizationId}/${input.ticketId}/${input.messageId}/${id}-${safeFileName(file.name)}`;
      const { error } = await admin.storage
        .from(SUPPORT_ATTACHMENTS_BUCKET)
        .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (error) throw error;
      storagePaths.push(storagePath);
      attachments.push({
        id,
        name: file.name.slice(0, 180),
        size: file.size,
        type: (file.type || "application/octet-stream").slice(0, 100),
        storagePath,
      });
    }
    return { attachments, storagePaths };
  } catch (error) {
    if (storagePaths.length) await admin.storage.from(SUPPORT_ATTACHMENTS_BUCKET).remove(storagePaths);
    throw error;
  }
}

export async function removeSupportAttachments(storagePaths: string[]) {
  if (!storagePaths.length) return;
  const admin = createAdminClient();
  if (admin) await admin.storage.from(SUPPORT_ATTACHMENTS_BUCKET).remove(storagePaths);
}

export function publicSupportAttachment(attachment: SupportAttachment): SupportAttachment {
  return {
    ...(attachment.id ? { id: attachment.id } : {}),
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
  };
}
