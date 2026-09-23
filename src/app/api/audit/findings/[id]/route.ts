import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canSuperviseAudit,
  getAuditMember,
  isAuditAdministrator,
} from "@/modules/audit/auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json();
  const action = String(body.action || "").toUpperCase();
  const finding = await prisma.auditFinding.findFirst({
    where: { id, audit: { organizationId: member.organizationId } },
    include: { audit: true },
  });
  if (!finding) return NextResponse.json({ error: "Apontamento não encontrado." }, { status: 404 });

  const administrator = isAuditAdministrator(member.role);
  const supervisor =
    administrator ||
    (canSuperviseAudit(member.role, member.isTeamLeader) &&
      finding.audit.supervisorId === member.userId);
  const isOperator = finding.operatorId === member.userId;
  let data: Prisma.AuditFindingUncheckedUpdateInput = {};
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (action === "ASSIGN") {
    if (!supervisor) return NextResponse.json({ error: "Somente o líder responsável por esta auditoria pode direcionar o apontamento." }, { status: 403 });
    const operatorId = String(body.operatorId || "");
    if (!operatorId || !note || !body.dueAt) return NextResponse.json({ error: "Selecione o operador, informe a orientação e defina o prazo." }, { status: 400 });
    const operator = await prisma.organizationMember.findFirst({
      where: {
        organizationId: member.organizationId,
        userId: operatorId,
        role: "OPERATOR",
        isTeamLeader: false,
        ...(member.isTeamLeader && !administrator
          ? { teamLeaderId: member.id }
          : {}),
      },
      select: { userId: true },
    });
    if (!operator) return NextResponse.json({ error: "Selecione um operador vinculado à equipe deste líder." }, { status: 400 });
    data = { operatorId, supervisorNote: note, dueAt: body.dueAt ? new Date(`${body.dueAt}T23:59:59`) : null, status: "SENT", sentAt: new Date() };
  } else if (action === "DISMISS") {
    if (!supervisor) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    if (["VALIDATED", "DISMISSED"].includes(finding.status)) {
      return NextResponse.json({ error: "Este apontamento já está encerrado." }, { status: 409 });
    }
    if (!note) return NextResponse.json({ error: "Informe o motivo para descartar o apontamento." }, { status: 400 });
    data = { status: "DISMISSED" };
  } else if (action === "START") {
    if (!isOperator) return NextResponse.json({ error: "Este apontamento não está atribuído a você." }, { status: 403 });
    if (!["SENT", "RETURNED"].includes(finding.status)) {
      return NextResponse.json({ error: "Esta correção não está disponível para ser iniciada." }, { status: 409 });
    }
    data = { status: "IN_PROGRESS" };
  } else if (action === "COMPLETE") {
    if (!isOperator) return NextResponse.json({ error: "Este apontamento não está atribuído a você." }, { status: 403 });
    if (finding.status !== "IN_PROGRESS") {
      return NextResponse.json({ error: "Inicie a correção antes de enviá-la ao líder." }, { status: 409 });
    }
    if (!note) return NextResponse.json({ error: "Informe o que foi feito antes de concluir." }, { status: 400 });
    data = { status: "PENDING_VALIDATION", completedAt: new Date() };
  } else if (action === "VALIDATE") {
    if (!supervisor) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    if (finding.status !== "PENDING_VALIDATION") {
      return NextResponse.json({ error: "Somente correções devolvidas pelo operador podem ser validadas." }, { status: 409 });
    }
    data = { status: "VALIDATED", validatedAt: new Date() };
  } else if (action === "RETURN") {
    if (!supervisor) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    if (finding.status !== "PENDING_VALIDATION") {
      return NextResponse.json({ error: "Somente correções aguardando check podem ser devolvidas." }, { status: 409 });
    }
    if (!note) return NextResponse.json({ error: "Informe o motivo da devolução." }, { status: 400 });
    data = { status: "RETURNED", validatedAt: null };
  } else {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.auditFinding.update({ where: { id }, data });
    await tx.auditInteraction.create({ data: { findingId: id, userId: member.userId, action, note: note || null, metadata: body.metadata ?? undefined } });

    const [unresolved, sent, pendingValidation, pendingChecklist] = await Promise.all([
      tx.auditFinding.count({ where: { auditId: finding.auditId, status: { notIn: ["VALIDATED", "DISMISSED"] } } }),
      tx.auditFinding.count({ where: { auditId: finding.auditId, status: { in: ["SENT", "IN_PROGRESS", "PENDING_VALIDATION", "RETURNED"] } } }),
      tx.auditFinding.count({ where: { auditId: finding.auditId, status: "PENDING_VALIDATION" } }),
      tx.auditChecklistItem.count({ where: { auditId: finding.auditId, status: "PENDING" } }),
    ]);
    const auditStatus = unresolved === 0 && pendingChecklist === 0
      ? "COMPLETED"
      : pendingValidation > 0
        ? "PENDING_VALIDATION"
        : sent > 0
          ? "SENT_TO_CORRECTION"
          : "IN_REVIEW";
    await tx.audit.update({ where: { id: finding.auditId }, data: { status: auditStatus, completedAt: auditStatus === "COMPLETED" ? new Date() : null } });
    return changed;
  });

  return NextResponse.json({ finding: updated });
}
