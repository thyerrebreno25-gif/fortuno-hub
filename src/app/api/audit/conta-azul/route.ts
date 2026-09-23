import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canSuperviseAudit, getAuditMember } from "@/modules/audit/auth";
import { CONTA_AZUL_AUDIT_CHECKLIST } from "@/modules/audit/checklist";
import { analyzeFinancialHistory } from "@/modules/audit/financial-history-engine";
import { fetchContaAzulAuditPeriod } from "@/modules/audit/server/conta-azul-financial-source";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown) {
  if (typeof value !== "string" || !DATE.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function previousMonthEnd(periodStart: string) {
  const [year, month] = periodStart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 0));
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  const a = new Date(`${start}T12:00:00Z`).getTime();
  const b = new Date(`${end}T12:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

export async function POST(request: Request) {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canSuperviseAudit(member.role, member.isTeamLeader)) {
    return NextResponse.json({ error: "Apenas líderes podem iniciar a validação automática." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const periodStart = validDate(body.periodStart);
  const periodEnd = validDate(body.periodEnd);
  if (!clientId || !periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json({ error: "Selecione o cliente e informe um período válido." }, { status: 400 });
  }
  if (daysBetween(periodStart, periodEnd) > 366) {
    return NextResponse.json({ error: "A validação pode abranger no máximo 12 meses por execução." }, { status: 400 });
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: member.organizationId, active: true },
    select: {
      id: true,
      name: true,
      payableResponsibleId: true,
      receivableResponsibleId: true,
      contaAzulConnection: { select: { active: true, status: true, externalTenantName: true } },
    },
  });
  if (!client) return NextResponse.json({ error: "Cliente inválido." }, { status: 404 });
  if (!client.contaAzulConnection?.active || client.contaAzulConnection.status !== "CONNECTED") {
    return NextResponse.json({ error: "Este cliente ainda não possui conexão ativa com o Conta Azul." }, { status: 400 });
  }

  const historyStart = `${periodStart.slice(0, 4)}-01-01`;
  const historyEnd = previousMonthEnd(periodStart);

  try {
    const historyPeriod = historyEnd >= historyStart
      ? await fetchContaAzulAuditPeriod(client.id, historyStart, historyEnd)
      : { payable: [], receivable: [], all: [] };
    const currentPeriod = await fetchContaAzulAuditPeriod(client.id, periodStart, periodEnd);
    const analysis = analyzeFinancialHistory({
      history: historyPeriod.all,
      current: currentPeriod.all,
      historyStart,
      historyEnd,
      periodStart,
      periodEnd,
    });

    const summary = {
      source: "CONTA_AZUL_API",
      tenant: client.contaAzulConnection.externalTenantName,
      queriedAt: new Date().toISOString(),
      period: { start: periodStart, end: periodEnd, basis: "vencimento" },
      history: { start: historyStart, end: historyEnd, basis: "vencimento" },
      metrics: analysis.metrics,
      recurringProfiles: analysis.profiles,
      limitations: [
        "A recorrência é aprendida pelos títulos disponíveis no Conta Azul, usando vencimento, contato, categoria e descrição.",
        "PIX, transferências, tarifas, estornos e descrições genéricas não formam recorrência automática.",
        "A conferência do saldo real do banco continua dependendo do extrato bancário.",
      ],
    } satisfies Prisma.InputJsonValue;

    const audit = await prisma.audit.create({
      data: {
        organizationId: member.organizationId,
        clientId: client.id,
        supervisorId: member.userId,
        status: "ANALYZED",
        referenceLabel: `${periodStart} → ${periodEnd} · Conta Azul`,
        periodStart: new Date(`${periodStart}T12:00:00Z`),
        periodEnd: new Date(`${periodEnd}T12:00:00Z`),
        healthScore: analysis.healthScore,
        totalChecks: analysis.totalChecks,
        passedChecks: analysis.passedChecks,
        summary,
        findings: {
          create: analysis.findings.map((finding) => ({
            source: "AUTOMATIC" as const,
            flow: finding.flow,
            ruleCode: finding.ruleCode,
            title: finding.title,
            description: finding.description,
            severity: finding.severity,
            subject: finding.subject,
            category: finding.category,
            competence: finding.competence,
            amount: finding.amount,
            evidence: finding.evidence as unknown as Prisma.InputJsonValue,
          })),
        },
        checklist: {
          create: CONTA_AZUL_AUDIT_CHECKLIST.map((item, index) => ({
            category: item.category,
            title: item.title,
            description: item.description,
            mandatory: true,
            position: index + 1,
          })),
        },
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            payableResponsibleId: true,
            receivableResponsibleId: true,
          },
        },
        findings: {
          orderBy: [{ flow: "asc" }, { severity: "asc" }, { createdAt: "asc" }],
          include: { operator: { select: { id: true, name: true, email: true } }, interactions: true },
        },
        files: true,
        checklist: { orderBy: { position: "asc" } },
      },
    });

    return NextResponse.json({
      audit,
      analysis: {
        healthScore: analysis.healthScore,
        totalChecks: analysis.totalChecks,
        passedChecks: analysis.passedChecks,
        metrics: analysis.metrics,
        historyStart,
        historyEnd,
      },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Não foi possível consultar o Conta Azul.",
    }, { status: 502 });
  }
}
