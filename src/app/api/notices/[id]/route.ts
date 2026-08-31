import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRolePermissions } from "@/modules/permissions/permissions";
import {
  canBroadcastToOrganization,
  canManageNotices,
  getNoticeMember,
} from "@/modules/notices/server/notice-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const member = await getNoticeMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }
  const permissions = await getRolePermissions(member.organizationId, member.role);
  const { id } = await context.params;
  const body = (await request.json()) as { action?: unknown };
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "viewed" && !permissions.NOTICES.canView) {
    return NextResponse.json(
      { error: "Você não possui permissão para visualizar avisos." },
      { status: 403 },
    );
  }
  if (action !== "viewed" && !permissions.NOTICES.canEdit) {
    return NextResponse.json(
      { error: "Você não possui permissão para atualizar avisos." },
      { status: 403 },
    );
  }

  const notice = await prisma.notice.findFirst({
    where: { id, organizationId: member.organizationId },
    include: {
      recipients: {
        where: { memberId: member.id },
        select: { id: true, viewedAt: true, completedAt: true },
      },
    },
  });

  if (!notice) {
    return NextResponse.json({ error: "Aviso não encontrado." }, { status: 404 });
  }

  const recipient = notice.recipients[0];

  if (action === "viewed" || action === "complete" || action === "reopen") {
    if (!recipient) {
      return NextResponse.json(
        { error: "Este aviso não foi direcionado a você." },
        { status: 403 },
      );
    }

    const now = new Date();
    const updated = await prisma.noticeRecipient.update({
      where: { id: recipient.id },
      data:
        action === "viewed"
          ? { viewedAt: recipient.viewedAt || now }
          : action === "complete"
            ? { viewedAt: recipient.viewedAt || now, completedAt: now }
            : { completedAt: null, viewedAt: recipient.viewedAt || now },
      select: { viewedAt: true, completedAt: true },
    });

    return NextResponse.json({ recipient: updated });
  }

  if (action === "close" || action === "reopen-global") {
    const managerAllowed =
      canManageNotices(member) &&
      permissions.NOTICES.canManage &&
      (canBroadcastToOrganization(member) || notice.authorMemberId === member.id);
    if (notice.authorMemberId !== member.id && !managerAllowed) {
      return NextResponse.json(
        { error: "Você não possui permissão para finalizar este aviso." },
        { status: 403 },
      );
    }

    const updated = await prisma.notice.update({
      where: { id: notice.id },
      data: { closedAt: action === "close" ? new Date() : null },
      select: { id: true, closedAt: true },
    });
    return NextResponse.json({ notice: updated });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const member = await getNoticeMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }
  const permissions = await getRolePermissions(member.organizationId, member.role);
  if (!permissions.NOTICES.canDelete) {
    return NextResponse.json(
      { error: "Você não possui permissão para excluir avisos." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const notice = await prisma.notice.findFirst({
    where: { id, organizationId: member.organizationId },
    select: { id: true, authorMemberId: true, scope: true },
  });

  if (!notice) {
    return NextResponse.json({ error: "Aviso não encontrado." }, { status: 404 });
  }

  const canDelete =
    notice.authorMemberId === member.id ||
    (notice.scope !== "PERSONAL" &&
      canBroadcastToOrganization(member) &&
      permissions.NOTICES.canManage);
  if (!canDelete) {
    return NextResponse.json(
      { error: "Você não possui permissão para excluir este aviso." },
      { status: 403 },
    );
  }

  await prisma.notice.delete({ where: { id: notice.id } });
  return NextResponse.json({ message: "Aviso excluído." });
}
