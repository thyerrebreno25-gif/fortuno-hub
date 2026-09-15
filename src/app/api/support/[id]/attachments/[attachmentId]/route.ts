import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupportMember, SUPPORT_MANAGER_ROLES } from "@/modules/support/server/support-auth";
import { SUPPORT_ATTACHMENTS_BUCKET } from "@/modules/support/server/support-attachments";
import { parseSupportMetadata, type SupportAttachment } from "@/modules/support/types/support.types";

type RouteContext = { params: Promise<{ id: string; attachmentId: string }> };

function findAttachment(metadata: ReturnType<typeof parseSupportMetadata>, attachmentId: string) {
  const all: SupportAttachment[] = [
    ...(metadata.attachments ?? []),
    ...(metadata.messages ?? []).flatMap((message) => message.attachments ?? []),
  ];
  return all.find((attachment) => attachment.id === attachmentId && attachment.storagePath);
}

export async function GET(request: Request, context: RouteContext) {
  const member = await getSupportMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { id, attachmentId } = await context.params;
  const canManage = SUPPORT_MANAGER_ROLES.has(member.role);
  const ticket = await prisma.supportTicket.findFirst({
    where: {
      id,
      organizationId: member.organizationId,
      ...(canManage ? {} : { userId: member.userId }),
    },
    select: { metadata: true },
  });
  if (!ticket) return NextResponse.json({ error: "Chamado não encontrado." }, { status: 404 });

  const attachment = findAttachment(parseSupportMetadata(ticket.metadata), attachmentId);
  if (!attachment?.storagePath) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  const expectedPrefix = `${member.organizationId}/${id}/`;
  if (!attachment.storagePath.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "Arquivo inválido para este chamado." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Armazenamento indisponível." }, { status: 503 });
  const inline = new URL(request.url).searchParams.get("mode") === "view";
  const { data, error } = await admin.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .createSignedUrl(attachment.storagePath, 60, inline ? undefined : { download: attachment.name });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Não foi possível abrir o anexo." }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl);
}
