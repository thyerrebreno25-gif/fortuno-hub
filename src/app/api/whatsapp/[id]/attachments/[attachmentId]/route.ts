import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getWhatsAppPermission,
} from "@/modules/atendimento/auth";
import { downloadUazapiMedia } from "@/modules/whatsapp/uazapi-server";

type Context = {
  params: Promise<{ id: string; attachmentId: string }>;
};

export const runtime = "nodejs";

export async function GET(_request: Request, context: Context) {
  const member = await getServiceCenterMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getWhatsAppPermission(
    member.organizationId,
    member.role,
  );
  if (!permission.canView) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id, attachmentId } = await context.params;
  const attachment = await prisma.serviceAttachment.findFirst({
    where: {
      id: attachmentId,
      message: {
        ticketId: id,
        ticket: {
          organizationId: member.organizationId,
          source: "WHATSAPP_API",
        },
      },
    },
    select: {
      name: true,
      mimeType: true,
      externalAttachmentId: true,
    },
  });

  if (!attachment?.externalAttachmentId) {
    return NextResponse.json(
      { error: "Anexo não encontrado." },
      { status: 404 },
    );
  }

  try {
    if (!attachment.externalAttachmentId.startsWith("uazapi:")) throw new Error("Anexo da integração anterior. Consulte o arquivo no WhatsApp original.");
    const file = await downloadUazapiMedia(member.organizationId, attachment.externalAttachmentId);
    const encodedName = encodeURIComponent(attachment.name || "anexo-whatsapp");
    return new Response(file.body, {
      status: 200,
      headers: {
        "Content-Type": file.mimeType || attachment.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        ...(file.size ? { "Content-Length": String(file.size) } : {}),
      },
    });
  } catch (error) {
    console.error("Falha ao baixar anexo do WhatsApp:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível baixar o anexo.",
      },
      { status: 502 },
    );
  }
}
