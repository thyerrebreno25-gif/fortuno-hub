import { NextResponse } from "next/server";
import type { AuditFindingSeverity, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canSuperviseAudit,
  getAuditMember,
  isAuditAdministrator,
} from "@/modules/audit/auth";
import { DEFAULT_AUDIT_CHECKLIST } from "@/modules/audit/checklist";

type AuditFindingInput = {
  ruleCode?: unknown;
  title?: unknown;
  description?: unknown;
  severity?: unknown;
  subject?: unknown;
  category?: unknown;
  competence?: unknown;
  amount?: unknown;
  evidence?: unknown;
};

function auditSeverity(value: unknown): AuditFindingSeverity {
  return value === "CRITICAL" || value === "WARNING" ? value : "INFO";
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalEvidence(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

export async function GET() {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const supervisor = canSuperviseAudit(member.role, member.isTeamLeader);
  const administrator = isAuditAdministrator(member.role);
  const where = administrator
    ? { organizationId: member.organizationId }
    : supervisor
      ? { organizationId: member.organizationId, supervisorId: member.userId }
      : {
          organizationId: member.organizationId,
          findings: { some: { operatorId: member.userId } },
        };

  const audits = await prisma.audit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      client: { select: { id: true, name: true } },
      supervisor: { select: { id: true, name: true, email: true } },
      findings: {
        where: supervisor ? undefined : { operatorId: member.userId },
        orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
        include: { operator: { select: { id: true, name: true, email: true } }, interactions: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true, email: true } } } } },
      },
      files: true,
      checklist: { orderBy: { position: "asc" } },
    },
  });
  return NextResponse.json({
    audits,
    role: member.role,
    userId: member.userId,
    canSupervise: supervisor,
  });
}

export async function POST(request: Request) {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canSuperviseAudit(member.role, member.isTeamLeader)) return NextResponse.json({ error: "Apenas líderes podem criar auditorias." }, { status: 403 });

  const body = await request.json();
  const clientId = String(body.clientId || "");
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: member.organizationId, active: true }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  const findings: AuditFindingInput[] = Array.isArray(body.findings) ? body.findings : [];
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
      findings: { create: findings.map((finding) => ({
        source: "AUTOMATIC" as const,
        ruleCode: optionalText(finding.ruleCode),
        title: String(finding.title || "Ponto de auditoria"),
        description: String(finding.description || ""),
        severity: auditSeverity(finding.severity),
        subject: optionalText(finding.subject),
        category: optionalText(finding.category),
        competence: optionalText(finding.competence),
        amount: typeof finding.amount === "number" ? finding.amount : null,
        evidence: optionalEvidence(finding.evidence),
      })) },
      checklist: { create: DEFAULT_AUDIT_CHECKLIST.map((item, index) => ({ category: item.category, title: item.title, mandatory: true, position: index + 1 })) },
    },
    include: { client: true, findings: true, files: true, checklist: true },
  });
  return NextResponse.json({ audit }, { status: 201 });
}
