import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSuperviseAudit, getAuditMember } from "@/modules/audit/auth";
import { DEFAULT_AUDIT_CHECKLIST } from "@/modules/audit/checklist";

export async function GET() {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const where = canSuperviseAudit(member.role)
    ? { organizationId: member.organizationId }
    : { organizationId: member.organizationId, findings: { some: { operatorId: member.userId } } };

  const audits = await prisma.audit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      client: { select: { id: true, name: true } },
      supervisor: { select: { id: true, name: true, email: true } },
      findings: {
        where: canSuperviseAudit(member.role) ? undefined : { operatorId: member.userId },
        orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
        include: { operator: { select: { id: true, name: true, email: true } }, interactions: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true, email: true } } } } },
      },
      files: true,
      checklist: { orderBy: { position: "asc" } },
    },
  });
  return NextResponse.json({ audits, role: member.role, userId: member.userId });
}

export async function POST(request: Request) {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canSuperviseAudit(member.role)) return NextResponse.json({ error: "Apenas supervisores podem criar auditorias." }, { status: 403 });

  const body = await request.json();
  const clientId = String(body.clientId || "");
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: member.organizationId, active: true }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  const findings = Array.isArray(body.findings) ? body.findings : [];
  const file = body.file ?? {};

  const audit = await prisma.audit.create({
    data: {
      organizationId: member.organizationId,
      clientId,
      supervisorId: member.userId,
      status: "ANALYZED",
      referenceLabel: body.referenceLabel || null,
      periodStart: body.periodStart ? new Date(`${body.periodStart}T12:00:00`) : null,
      periodEnd: body.periodEnd ? new Date(`${body.periodEnd}T12:00:00`) : null,
      healthScore: Number(body.healthScore ?? 100),
      totalChecks: Number(body.totalChecks ?? 0),
      passedChecks: Number(body.passedChecks ?? 0),
      summary: body.metrics ?? undefined,
      files: { create: [{
        type: "MOVEMENTS",
        name: String(file.name || "Extrato de Movimentações.pdf"),
        mimeType: file.mimeType || "application/pdf",
        size: Number(file.size || 0) || null,
        periodStart: body.periodStart ? new Date(`${body.periodStart}T12:00:00`) : null,
        periodEnd: body.periodEnd ? new Date(`${body.periodEnd}T12:00:00`) : null,
        parsedSummary: { transactionCount: Number(body.metrics?.transactionCount ?? 0), months: body.metrics?.months ?? [] },
      }] },
      findings: { create: findings.map((finding: any) => ({
        source: "AUTOMATIC",
        ruleCode: finding.ruleCode || null,
        title: String(finding.title || "Ponto de auditoria"),
        description: String(finding.description || ""),
        severity: finding.severity,
        subject: finding.subject || null,
        category: finding.category || null,
        competence: finding.competence || null,
        amount: typeof finding.amount === "number" ? finding.amount : null,
        evidence: finding.evidence ?? undefined,
      })) },
      checklist: { create: DEFAULT_AUDIT_CHECKLIST.map((item, index) => ({ category: item.category, title: item.title, mandatory: true, position: index + 1 })) },
    },
    include: { client: true, findings: true, files: true, checklist: true },
  });
  return NextResponse.json({ audit }, { status: 201 });
}
