import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canSuperviseAudit, getAuditMember } from "@/modules/audit/auth";
import { CONTA_AZUL_AUDIT_CHECKLIST } from "@/modules/audit/checklist";
import { analyzeFinancialHistory } from "@/modules/audit/financial-history-engine";
import {auditHistoryPeriod,auditDate} from "@/modules/audit/period";
import {auditTransitoryBalances} from "@/modules/audit/server/transitory-balances";
import {transitoryBalanceFindings} from "@/modules/audit/transitory-accounts";
import type {AuditFindingDraft} from "@/modules/audit/types";
import { enrichAuditPaymentDates,fetchContaAzulAuditOverdue,fetchContaAzulAuditPeriod } from "@/modules/audit/server/conta-azul-financial-source";

export const maxDuration=300;
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
  const periodStart = auditDate(body.periodStart);
  const periodEnd = auditDate(body.periodEnd);
  if (!clientId || !periodStart || !periodEnd || periodStart > periodEnd) {
    return NextResponse.json({ error: "Selecione o cliente e informe um período válido." }, { status: 400 });
  }
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(periodEnd>today)return NextResponse.json({error:"Use um período já iniciado, sem datas futuras."},{status:400});
  const deadline=Date.now()+240000;
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

  const historyMonths=body.historyMonths===undefined?3:Number(body.historyMonths),variationPercent=body.variationPercent===undefined?25:Number(body.variationPercent);
  if(!Number.isInteger(historyMonths)||historyMonths<3||historyMonths>12||!Number.isFinite(variationPercent)||variationPercent<1||variationPercent>100)return NextResponse.json({error:"Use de 3 a 12 meses anteriores e variação entre 1% e 100%."},{status:400});
  const {start:historyStart,end:historyEnd}=auditHistoryPeriod(periodStart,historyMonths);

  try {
    const historyPeriod = historyEnd >= historyStart
      ? await fetchContaAzulAuditPeriod(client.id, historyStart, historyEnd,deadline)
      : { payable: [], receivable: [], all: [] };
    const currentPeriod = await fetchContaAzulAuditPeriod(client.id, periodStart, periodEnd,deadline);
    await enrichAuditPaymentDates(client.id,currentPeriod.all,Math.min(deadline,Date.now()+45000));
    const overdueEntries=await fetchContaAzulAuditOverdue(client.id,historyStart,periodEnd,deadline);
    const financial = analyzeFinancialHistory({
      history: historyPeriod.all,
      current: currentPeriod.all,
      historyStart,
      historyEnd,
      periodStart,
      periodEnd,variationPercent,overdueEntries,
    });

    let balances:Awaited<ReturnType<typeof auditTransitoryBalances>>=[],balanceError:string|null=null;
    try{balances=await auditTransitoryBalances(client.id,periodEnd,deadline);}catch{balanceError="A lista de contas transitórias não pôde ser confirmada. Confira as contas e o saldo de fechamento manualmente.";}
    const balanceFindings=transitoryBalanceFindings(balances);
    if(balanceError)balanceFindings.push({localId:"CA_TRANSITORY_LIST_UNAVAILABLE",ruleCode:"CA_TRANSITORY_BALANCE_UNAVAILABLE",flow:"GENERAL",title:"Contas transitórias aguardam conferência",description:balanceError,severity:"WARNING",evidence:[{label:"Data do fechamento",value:periodEnd}]});
    const findings:AuditFindingDraft[]=[...financial.findings,...balanceFindings];
    const analysis={...financial,findings,totalChecks:financial.totalChecks+balances.length+(balanceError?1:0),passedChecks:financial.passedChecks+balances.filter(account=>account.balanceCents===0).length,healthScore:Math.max(0,financial.healthScore-balanceFindings.length*5),metrics:{...financial.metrics,transitoryAccounts:balances.length,nonzeroBalances:balances.filter(account=>account.balanceCents!==null&&account.balanceCents!==0).length,unavailableBalances:balances.filter(account=>account.balanceCents===null).length+(balanceError?1:0)}};
    const summary = {
      source: "CONTA_AZUL_API",
      tenant: client.contaAzulConnection.externalTenantName,
      queriedAt: new Date().toISOString(),
      period: { start: periodStart, end: periodEnd, basis: "vencimento" },
      history: { start: historyStart, end: historyEnd, months:historyMonths,basis: "vencimento" },
      rules:{version:2,variationPercent,minimumVariationAmount:100,monthlyServiceCompetence:"PREVIOUS_MONTH",oneOffCompetence:"PAYMENT_DAY",zeroBalanceScope:"TRANSITORY_ONLY"},
      transitoryBalances:balances.map(account=>({...account,reason:account.reason||null})),
      metrics: analysis.metrics,
      recurringProfiles: analysis.profiles,
      limitations: [
        "A recorrência é aprendida pelos títulos disponíveis no Conta Azul, usando vencimento, contato, categoria e descrição.",
        "A forma PIX não transforma um serviço mensal em compra avulsa. Pagamentos avulsos usam a data de pagamento quando disponibilizada pelo CA.",
        "O saldo de fechamento é reconstituído com as movimentações posteriores quando o CA fornece todos os dados necessários. Saldo indisponível exige validação manual, nunca é considerado zero.",
        "A conferência do saldo real do banco continua dependendo do extrato bancário.",
        "Títulos vencidos refletem a situação atual dos lançamentos com vencimento dentro do período e do histórico consultado.",
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
