import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSuperviseAudit, getAuditMember } from "@/modules/audit/auth";

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

  const supervisor = canSuperviseAudit(member.role);
  const isOperator = finding.operatorId === member.userId;
  let data: any = {};
  let note = typeof body.note === "string" ? body.note.trim() : "";

  if (action === "ASSIGN") {
    if (!supervisor) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    const operatorId = String(body.operatorId || "");
    if (!operatorId || !note) return NextResponse.json({ error: "Selecione o operador e informe a orientação do supervisor." }, { status: 400 });
    const operator = await prisma.organizationMember.findFirst({ where: { organizationId: member.organizationId, userId: operatorId }, select: { userId: true } });
    if (!operator) return NextResponse.json({ error: "Operador inválido." }, { status: 400 });
    data = { operatorId, supervisorNote: note, dueAt: body.dueAt ? new Date(`${body.dueAt}T23:59:59`) : null, status: "SENT", sentAt: new Date() };
  } else if (action === "DISMISS") {
    if (!supervisor) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    if (!note) return NextResponse.json({ error: "Informe o motivo para descartar o apontamento." }, { status: 400 });
    data = { status: "DISMISSED" };
  } else if (action === "START") {
    if (!isOperator) return NextResponse.json({ error: "Este apontamento não está atribuído a você." }, { status: 403 });
    data = { status: "IN_PROGRESS" };
  } else if (action === "COMPLETE") {
    if (!isOperator) return NextResponse.json({ error: "Este apontamento não está atribuído a você." }, { status: 403 });
    if (!note) return NextResponse.json({ error: "Informe o que foi feito antes de concluir." }, { status: 400 });
    data = { status: "PENDING_VALIDATION", completedAt: new Date() };
  } else if (action === "VALIDATE") {
    if (!supervisor) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    data = { status: "VALIDATED", validatedAt: new Date() };
  } else if (action === "RETURN") {
    if (!supervisor) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    if (!note) return NextResponse.json({ error: "Informe o motivo da devolução." }, { status: 400 });
    data = { status: "RETURNED", validatedAt: null };
  } else {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.auditFinding.update({ where: { id }, data });
    await tx.auditInteraction.create({ data: { findingId: id, userId: member.userId, action, note: note || null, metadata: body.metadata ?? undefined } });

    const unresolved = await tx.auditFinding.count({ where: { auditId: finding.auditId, status: { notIn: ["VALIDATED", "DISMISSED"] } } });
    const sent = await tx.auditFinding.count({ where: { auditId: finding.auditId, status: { in: ["SENT", "IN_PROGRESS", "PENDING_VALIDATION", "RETURNED"] } } });
    const pendingValidation = await tx.auditFinding.count({ where: { auditId: finding.auditId, status: "PENDING_VALIDATION" } });
    let auditStatus: any = "IN_REVIEW";
    if (unresolved === 0) auditStatus = "COMPLETED";
    else if (pendingValidation > 0) auditStatus = "PENDING_VALIDATION";
    else if (sent > 0) auditStatus = "SENT_TO_CORRECTION";
    await tx.audit.update({ where: { id: finding.auditId }, data: { status: auditStatus, completedAt: unresolved === 0 ? new Date() : null } });
    return changed;
  });

  return NextResponse.json({ finding: updated });
}
