import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getServiceCenterPermission } from "@/modules/atendimento/auth";
import { activeMailbox, archivedMailbox, MAILBOX_ARCHIVE } from "@/modules/atendimento/mailbox-archive";

export async function DELETE(request: Request) {
  const member = await getServiceCenterMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permission = await getServiceCenterPermission(member.organizationId, member.role);
  if (!permission.canManage) return NextResponse.json({ error: "Sem permissão para excluir a caixa da equipe." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (body?.confirmation !== "EXCLUIR ARQUIVADOS") return NextResponse.json({ error: "Confirme a exclusão definitiva dos arquivados." }, { status: 400 });
  const count = await prisma.$transaction(async (tx) => {
    const result = await tx.serviceTicket.deleteMany({ where: { organizationId: member.organizationId, ...archivedMailbox } });
    await tx.auditLog.create({ data: { userId: member.userId, action: "DELETE_ARCHIVED_MAILBOX", entity: "ServiceTicket", entityId: member.organizationId, afterData: { organizationId: member.organizationId, deleted: result.count } } });
    return result.count;
  });
  return NextResponse.json({ count });
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
      const result = await tx.serviceTicketHistory.updateMany({ where: { type: MAILBOX_ARCHIVE, ticket: { organizationId: member.organizationId } }, data: { type: "MAILBOX_RESTORED", message: "Atendimento restaurado na caixa de e-mails." } });
      return result.count;
    }
    const tickets = await tx.serviceTicket.findMany({ where: { organizationId: member.organizationId, ...activeMailbox }, select: { id: true } });
    if (!tickets.length) return 0;
    await tx.serviceTicketHistory.createMany({ data: tickets.map((ticket) => ({ ticketId: ticket.id, userId: member.userId, type: MAILBOX_ARCHIVE, message: "Atendimento arquivado na limpeza da caixa. O e-mail original foi preservado." })) });
    return tickets.length;
  });
  return NextResponse.json({ count });
}
