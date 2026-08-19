import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { buildAcquirerComparison } from "@/modules/dashboard/acquirer-comparison";
import { getRolePermissions } from "@/modules/permissions/permissions";

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

export async function GET() {
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
    const canSeeImports = Boolean(access.IMPORTS || access.MOTOR_EXCHANGE);
    const exportedWhere = {
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
    ] = await Promise.all([
      prisma.client.count({
        where: {
          organizationId,
          active: true,
          ...(hasOrganizationScope
            ? {}
            : {
                imports: {
                  some: { status: "EXPORTED", userId: { in: visibleUserIds } },
                },
              }),
        },
      }),
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
    ]);

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
      user: {
        id: membership.user.id,
        name: membership.user.name || membership.user.email.split("@")[0],
        role: membership.role,
        isTeamLeader: membership.isTeamLeader,
        visibleTeamSize: visibleUserIds.length,
      },
      access,
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
      acquirerComparison: canSeeImports
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
