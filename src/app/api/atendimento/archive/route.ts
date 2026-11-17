import { emailChannel } from "@/modules/atendimento/email-channel";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getServiceCenterPermission } from "@/modules/atendimento/auth";
import { activeMailbox, MAILBOX_ARCHIVE } from "@/modules/atendimento/mailbox-archive";

export const maxDuration = 60;
const DELETE_BATCH_SIZE = 50;

export async function DELETE(request: Request) {
  try {
    const member = await getServiceCenterMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const permission = await getServiceCenterPermission(member.organizationId, member.role);
    if (!permission.canManage) return NextResponse.json({ error: "Sem permissão para excluir a caixa da equipe." }, { status: 403 });
    const body = await request.json().catch(() => null);
    if (body?.confirmation !== "EXCLUIR ARQUIVADOS") return NextResponse.json({ error: "Confirme a exclusão definitiva dos arquivados." }, { status: 400 });
    const now = new Date();
    const cutoff = body.cutoff === undefined ? now : typeof body.cutoff === "string" ? new Date(body.cutoff) : new Date(NaN);
    if (!Number.isFinite(+cutoff) || cutoff > now || body.cutoff !== undefined && cutoff.toISOString() !== body.cutoff) return NextResponse.json({ error: "Referência da exclusão inválida. Atualize a caixa e confirme novamente." }, { status: 400 });
    const where = {
      organizationId: member.organizationId,
      ...emailChannel,
      createdAt: { lte: cutoff },
      lastMessageAt: { lte: cutoff },
      history: { some: { type: MAILBOX_ARCHIVE, createdAt: { lte: cutoff } } },
    };
    const result = await prisma.$transaction(async (tx) => {
      const tickets = await tx.serviceTicket.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: DELETE_BATCH_SIZE });
      const deleted = tickets.length ? await tx.serviceTicket.deleteMany({ where: { ...where, id: { in: tickets.map(ticket => ticket.id) } } }) : { count: 0 };
      if (deleted.count) await tx.auditLog.create({ data: { userId: member.userId, action: "DELETE_ARCHIVED_MAILBOX", entity: "ServiceTicket", entityId: member.organizationId, afterData: { organizationId: member.organizationId, deleted: deleted.count, cutoff: cutoff.toISOString(), batchSize: DELETE_BATCH_SIZE } } });
      const remaining = await tx.serviceTicket.count({ where });
      return { count: deleted.count, remaining, cutoff: cutoff.toISOString() };
    }, { maxWait: 5000, timeout: 20000 });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code=error&&typeof error==="object"&&"code" in error?String(error.code):"UNKNOWN";
    console.error("Archived mailbox batch failed:", code);
    return NextResponse.json({ error: "Não foi possível concluir este lote. Os lotes já confirmados foram preservados. Atualize a caixa e tente novamente nos arquivados restantes." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getServiceCenterPermission(member.organizationId, member.role);
  if (!permission.canManage) return NextResponse.json({ error: "Sem permissão para limpar a caixa da equipe." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!["archive", "restore"].includes(body?.action)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const count = await prisma.$transaction(async (tx) => {
    if (body.action === "restore") {
      const result = await tx.serviceTicketHistory.updateMany({ where: { type: MAILBOX_ARCHIVE, ticket: { organizationId: member.organizationId, ...emailChannel } }, data: { type: "MAILBOX_RESTORED", message: "Atendimento restaurado na caixa de e-mails." } });
      return result.count;
    }
    const tickets = await tx.serviceTicket.findMany({ where: { organizationId: member.organizationId, ...emailChannel, ...activeMailbox }, select: { id: true } });
    if (!tickets.length) return 0;
    await tx.serviceTicketHistory.createMany({ data: tickets.map((ticket) => ({ ticketId: ticket.id, userId: member.userId, type: MAILBOX_ARCHIVE, message: "Atendimento arquivado na limpeza da caixa. O e-mail original foi preservado." })) });
    return tickets.length;
  });
  return NextResponse.json({ count });
}
