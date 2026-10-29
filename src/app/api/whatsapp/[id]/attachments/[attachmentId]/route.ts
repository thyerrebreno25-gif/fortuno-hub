import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getWhatsAppPermission,
} from "@/modules/atendimento/auth";
import { downloadUazapiMedia } from "@/modules/whatsapp/uazapi-server";
import { byteRange, previewMime } from "@/modules/whatsapp/media";
import { resolveWhatsappTicketId } from "@/modules/whatsapp/server";

type Context = {
  params: Promise<{ id: string; attachmentId: string }>;
};

export const runtime = "nodejs";

export async function GET(request: Request, context: Context) {
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
  const ticketId = await resolveWhatsappTicketId(id, member.organizationId);
  const attachment = await prisma.serviceAttachment.findFirst({
    where: {
      id: attachmentId,
      message: {
        ticketId,
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
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    const safeMime = previewMime(file.body, file.mimeType || attachment.mimeType || "");
    if (preview && !safeMime) return NextResponse.json({ error: "Este formato está disponível somente para download." }, { status: 415 });
    const range = byteRange(request.headers.get("range"), file.body.length);
    if (range === false) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.body.length}` } });
    const body = range ? file.body.slice(range.start, range.end + 1) : file.body;
    const encodedName = encodeURIComponent(attachment.name || "anexo-whatsapp");
    return new Response(new Uint8Array(body), {
      status: range ? 206 : 200,
      headers: {
        "Content-Type": safeMime || file.mimeType || attachment.mimeType || "application/octet-stream",
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": preview ? "private, max-age=120" : "private, no-store",
        "Vary": "Cookie",
        "Accept-Ranges": "bytes",
        "Content-Length": String(body.length),
        ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${file.body.length}` } : {}),
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
