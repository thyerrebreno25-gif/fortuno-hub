import { assistantClientAccessWhere } from "@/modules/assistant/auth";
import { operationalOverview } from "@/modules/dashboard/operational-overview";
import type { ImportModule } from "@/generated/prisma/enums";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { buildAcquirerComparison } from "@/modules/dashboard/acquirer-comparison";
import { getRolePermissions } from "@/modules/permissions/permissions";
import {
  buildDashboardUsage,
  resolveDashboardPeriod,
  type DashboardUsageEvent,
} from "@/modules/dashboard/usage-analytics";

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Sua sessão expirou. Entre novamente para continuar." },
        { status: 401 },
      );
    }

    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        organizationId: true,
        role: true,
        isTeamLeader: true,
        teamMembers: { select: { userId: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!membership) {
      return NextResponse.json(
        { error: "Seu usuário não pertence a uma organização." },
        { status: 403 },
      );
    }

    const organizationId = membership.organizationId;
    const now = new Date();
    const period = resolveDashboardPeriod(new URL(request.url).searchParams.get("period"), now);
    const today = startOfDay(now);
    const monthStart = startOfMonth(now);
    const hasOrganizationScope = ["MASTER", "ADMIN"].includes(membership.role);
    const organizationMembers = await prisma.organizationMember.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const visibleUserIds = hasOrganizationScope
      ? organizationMembers.map((item) => item.userId)
      : Array.from(
          new Set([
            membership.user.id,
            ...(membership.isTeamLeader
              ? membership.teamMembers.map((item) => item.userId)
              : []),
          ]),
        );

    const permissions = await getRolePermissions(organizationId, membership.role);
    const access = Object.fromEntries(
      Object.entries(permissions).map(([module, permission]) => [
        module,
        permission.canView,
      ]),
    );
    if (!access.DASHBOARD) return NextResponse.json({ error: "Sem permissão para o dashboard." }, { status: 403 });
    const dashboardMember = { id: membership.id, userId: membership.user.id, organizationId, role: membership.role, isTeamLeader: membership.isTeamLeader, teamMemberUserIds: membership.teamMembers.map((item) => item.userId), user: membership.user };
    const overview = await operationalOverview(dashboardMember, access, period.start, now, visibleUserIds);
    const canSeeImports = Boolean(access.IMPORTS || access.MOTOR_EXCHANGE);
    const canSeePurchaseInvoices = Boolean(access.PURCHASE_INVOICES);
    const visibleImportModules: ImportModule[] = [...(access.IMPORTS ? ["BANK_STATEMENT", "ACQUIRER", "CREDIT_CARD_INVOICE", "BRASILMED_RECONCILIATION"] as ImportModule[] : []), ...(access.MOTOR_EXCHANGE ? ["EXCHANGE"] as ImportModule[] : [])];
    const exportedWhere = {
      module: { in: visibleImportModules },
      organizationId,
      status: "EXPORTED" as const,
      userId: { in: visibleUserIds },
    };

    const [
      activeClients,
      exportsToday,
      exportsThisMonth,
      exportedClientRows,
      exportedTransactionsThisMonth,
      openTickets,
      moduleGroups,
      recentExports,
      recentActivities,
      recentTickets,
      teamGroups,
      creditAggregate,
      debitAggregate,
      activeOnboardings,
      overdueOnboardings,
      onboardingTimeAggregate,
      activeAudits,
      acquirerRows,
      usageImportRows,
      usagePurchaseInvoices,
      usageFinancialExports,
    ] = await Promise.all([
      prisma.client.count({ where: { organizationId, active: true, ...assistantClientAccessWhere(dashboardMember) } }),
      prisma.importJob.count({
        where: { ...exportedWhere, createdAt: { gte: today } },
      }),
      prisma.importJob.count({
        where: { ...exportedWhere, createdAt: { gte: monthStart } },
      }),
      prisma.importJob.findMany({
        where: {
          ...exportedWhere,
          createdAt: { gte: monthStart },
          clientId: { not: null },
        },
        distinct: ["clientId"],
        select: { clientId: true },
      }),
      prisma.parsedTransaction.count({
        where: {
          importJob: { ...exportedWhere, createdAt: { gte: monthStart } },
        },
      }),
      prisma.supportTicket.count({
        where: {
          organizationId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          ...(hasOrganizationScope ? {} : { userId: { in: visibleUserIds } }),
        },
      }),
      prisma.importJob.groupBy({
        by: ["module"],
        where: { ...exportedWhere, createdAt: { gte: monthStart } },
        _count: { _all: true },
      }),
      prisma.importJob.findMany({
        where: exportedWhere,
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          module: true,
          status: true,
          originalName: true,
          createdAt: true,
          client: { select: { name: true } },
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          userId: { in: visibleUserIds },
          entity: {
            notIn: [
              "OperationActivity",
              "OperationConfiguration",
              "ServiceTicket",
              "EmailConnection",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.supportTicket.findMany({
        where: {
          organizationId,
          ...(hasOrganizationScope ? {} : { userId: { in: visibleUserIds } }),
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          subject: true,
          priority: true,
          status: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.importJob.groupBy({
        by: ["userId"],
        where: { ...exportedWhere, createdAt: { gte: monthStart } },
        _count: { _all: true },
        orderBy: { _count: { userId: "desc" } },
        take: 10,
      }),
      prisma.parsedTransaction.aggregate({
        where: {
          type: "CREDIT",
          importJob: { ...exportedWhere, createdAt: { gte: monthStart } },
        },
        _sum: { amount: true },
      }),
      prisma.parsedTransaction.aggregate({
        where: {
          type: "DEBIT",
          importJob: { ...exportedWhere, createdAt: { gte: monthStart } },
        },
        _sum: { amount: true },
      }),
      prisma.onboarding.count({
        where: {
          organizationId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          ...(hasOrganizationScope
            ? {}
            : { responsibleId: { in: visibleUserIds } }),
        },
      }),
      prisma.onboarding.count({
        where: {
          organizationId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          expectedEndDate: { lt: now },
          ...(hasOrganizationScope
            ? {}
            : { responsibleId: { in: visibleUserIds } }),
        },
      }),
      prisma.onboardingTimeEntry.aggregate({
        where: {
          userId: { in: visibleUserIds },
          startedAt: { gte: monthStart },
          task: { onboarding: { organizationId } },
        },
        _sum: { seconds: true },
      }),
      prisma.audit.count({
        where: {
          organizationId,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          ...(hasOrganizationScope
            ? {}
            : { supervisorId: { in: visibleUserIds } }),
        },
      }),
      prisma.clientAcquirer.findMany({
        where: {
          active: true,
          client: {
            organizationId,
            active: true,
            ...(hasOrganizationScope
              ? {}
              : {
                  imports: {
                    some: {
                      status: "EXPORTED",
                      userId: { in: visibleUserIds },
                    },
                  },
                }),
          },
        },
        select: {
          name: true,
          client: { select: { id: true, name: true } },
          rates: {
            where: { active: true },
            select: { expectedRate: true },
          },
        },
      }),
      canSeeImports
        ? prisma.importJob.findMany({
            where: {
              organizationId,
              module: { in: visibleImportModules },
              userId: { in: visibleUserIds },
              createdAt: { gte: period.start },
            },
            select: {
              id: true,
              module: true,
              status: true,
              createdAt: true,
              clientId: true,
              client: { select: { name: true } },
              userId: true,
              user: { select: { name: true, email: true } },
              parsedTotal: true,
              expectedTotal: true,
              _count: { select: { transactions: true } },
            },
          })
        : Promise.resolve([]),
      canSeePurchaseInvoices
        ? prisma.purchaseInvoice.findMany({
            where: {
              organizationId,
              createdById: { in: visibleUserIds },
              OR: [
                { createdAt: { gte: period.start } },
                { sentAt: { gte: period.start } },
              ],
            },
            select: {
              id: true,
              number: true,
              status: true,
              createdAt: true,
              sentAt: true,
              totalInvoice: true,
              clientId: true,
              client: { select: { name: true } },
              createdById: true,
              createdBy: { select: { name: true, email: true } },
              _count: { select: { items: true, installments: true } },
            },
          })
        : Promise.resolve([]),
      access.IMPORTS
        ? prisma.contaAzulFinancialExport.findMany({
            where: {
              organizationId,
              createdById: { in: visibleUserIds },
              OR: [
                { createdAt: { gte: period.start } },
                { completedAt: { gte: period.start } },
              ],
            },
            select: {
              id: true,
              module: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              completedAt: true,
              clientId: true,
              client: { select: { name: true } },
              createdById: true,
              createdBy: { select: { name: true, email: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const financialLineGroups = usageFinancialExports.length
      ? await prisma.contaAzulFinancialExportLine.groupBy({
          by: ["exportId", "status"],
          where: {
            exportId: { in: usageFinancialExports.map((item) => item.id) },
            status: { in: ["CREATED", "SETTLED"] },
          },
          _count: { _all: true },
          _sum: { amount: true },
        })
      : [];
    const financialLinesByExport = new Map<string, { count: number; amount: number }>();
    financialLineGroups.forEach((group) => {
      const current = financialLinesByExport.get(group.exportId) ?? { count: 0, amount: 0 };
      current.count += group._count._all;
      current.amount += Math.abs(toNumber(group._sum.amount));
      financialLinesByExport.set(group.exportId, current);
    });

    const usageEvents: DashboardUsageEvent[] = [
      ...usageImportRows.map((item) => ({
        id: `import:${item.id}`,
        kind: item.module,
        stage: "IMPORT" as const,
        occurredAt: item.createdAt.toISOString(),
        clientId: item.clientId,
        clientName: item.client?.name ?? null,
        userId: item.userId,
        userName: item.user.name || item.user.email,
        status: item.status,
        successful: item.status === "EXPORTED" || item.status === "VALIDATED",
        entries: item._count.transactions,
        amount: Math.abs(toNumber(item.parsedTotal ?? item.expectedTotal)),
      })),
      ...usagePurchaseInvoices.flatMap((item) => {
        const events: DashboardUsageEvent[] = [];
        if (item.createdAt >= period.start) {
          events.push({
            id: `purchase-import:${item.id}`,
            kind: "PURCHASE_INVOICE_IMPORT",
            stage: "IMPORT",
            occurredAt: item.createdAt.toISOString(),
            clientId: item.clientId,
            clientName: item.client.name,
            userId: item.createdById,
            userName: item.createdBy.name || item.createdBy.email,
            status: "IMPORTED",
            successful: true,
            entries: item._count.items,
            amount: Math.abs(toNumber(item.totalInvoice)),
          });
        }
        if (item.sentAt && item.sentAt >= period.start) {
          events.push({
            id: `purchase-send:${item.id}`,
            kind: "CA_PURCHASE_INVOICE",
            stage: "CA_EXPORT",
            occurredAt: item.sentAt.toISOString(),
            clientId: item.clientId,
            clientName: item.client.name,
            userId: item.createdById,
            userName: item.createdBy.name || item.createdBy.email,
            status: "COMPLETED",
            successful: true,
            entries: item._count.installments,
            amount: Math.abs(toNumber(item.totalInvoice)),
          });
        }
        return events;
      }),
      ...usageFinancialExports.map((item) => {
        const lineSummary = financialLinesByExport.get(item.id) ?? { count: 0, amount: 0 };
        const successful = item.status === "COMPLETED"
          || (item.status === "PARTIAL" && lineSummary.count > 0);
        return {
          id: `financial-export:${item.id}`,
          kind: item.module === "ACQUIRER" ? "CA_ACQUIRER" : "CA_CREDIT_CARD_INVOICE",
          stage: "CA_EXPORT" as const,
          occurredAt: (item.completedAt || item.updatedAt || item.createdAt).toISOString(),
          clientId: item.clientId,
          clientName: item.client.name,
          userId: item.createdById,
          userName: item.createdBy.name || item.createdBy.email,
          status: item.status,
          successful,
          entries: lineSummary.count,
          amount: lineSummary.amount,
        } satisfies DashboardUsageEvent;
      }),
    ];
    const usage = buildDashboardUsage(usageEvents, period);

    const performanceUsers = await prisma.user.findMany({
      where: { id: { in: teamGroups.map((item) => item.userId) } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(
      performanceUsers.map((item) => [item.id, item.name || item.email]),
    );
    const credits = Math.abs(toNumber(creditAggregate._sum.amount));
    const debits = Math.abs(toNumber(debitAggregate._sum.amount));

    return NextResponse.json({
      generatedAt: now.toISOString(),
      period: {
        code: period.code,
        label: period.label,
        start: period.startKey,
        end: period.endKey,
        granularity: period.granularity,
      },
      user: {
        id: membership.user.id,
        name: membership.user.name || membership.user.email.split("@")[0],
        role: membership.role,
        isTeamLeader: membership.isTeamLeader,
        visibleTeamSize: visibleUserIds.length,
      },
      access,
      overview,
      summary: {
        activeClients: access.CLIENTS ? activeClients : 0,
        exportsToday: canSeeImports ? exportsToday : 0,
        exportsThisMonth: canSeeImports ? exportsThisMonth : 0,
        exportedClientsThisMonth: canSeeImports ? exportedClientRows.length : 0,
        exportedTransactionsThisMonth: canSeeImports
          ? exportedTransactionsThisMonth
          : 0,
        openTickets: access.SUPPORT ? openTickets : 0,
        activeOnboardings: access.ONBOARDING ? activeOnboardings : 0,
        overdueOnboardings: access.ONBOARDING ? overdueOnboardings : 0,
        onboardingHoursThisMonth: access.ONBOARDING
          ? Math.round(((onboardingTimeAggregate._sum.seconds || 0) / 3600) * 100) /
            100
          : 0,
        activeAudits: access.AUDIT ? activeAudits : 0,
      },
      processingsByModule: canSeeImports
        ? moduleGroups.map((item) => ({
            module: item.module,
            total: item._count._all,
          }))
        : [],
      recentProcessings: canSeeImports
        ? recentExports.map((item) => ({
            id: item.id,
            module: item.module,
            status: item.status,
            originalName: item.originalName,
            clientName: item.client?.name ?? null,
            userName: item.user.name || item.user.email,
            createdAt: item.createdAt.toISOString(),
          }))
        : [],
      recentActivities: access.HISTORY
        ? recentActivities.map((item) => ({
            id: item.id,
            action: item.action,
            entity: item.entity,
            entityId: item.entityId,
            userName: item.user.name || item.user.email,
            createdAt: item.createdAt.toISOString(),
          }))
        : [],
      supportTickets: access.SUPPORT
        ? recentTickets.map((item) => ({
            id: item.id,
            subject: item.subject,
            priority: item.priority,
            status: item.status,
            userName: item.user.name || item.user.email,
            createdAt: item.createdAt.toISOString(),
          }))
        : [],
      teamPerformance: canSeeImports
        ? teamGroups.map((item) => ({
            userId: item.userId,
            name: userMap.get(item.userId) || "Usuário",
            total: item._count._all,
          }))
        : [],
      financialVolume: {
        credits: canSeeImports ? credits : 0,
        debits: canSeeImports ? debits : 0,
        total: canSeeImports ? credits + debits : 0,
      },
      usage,
      acquirerComparison: access.IMPORTS
        ? buildAcquirerComparison(
            acquirerRows.map((item) => ({
              clientId: item.client.id,
              clientName: item.client.name,
              acquirerName: item.name,
              rates: item.rates.map((rate) => Number(rate.expectedRate)),
            })),
          )
        : [],
    });
  } catch (error) {
    console.error("Erro ao carregar Dashboard:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar os dados reais do Dashboard." },
      { status: 500 },
    );
  }
}
