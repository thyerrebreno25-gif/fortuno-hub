import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
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
        organizationId: true,
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
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

    const visibleImportWhere = {
      organizationId,
      ...(membership.role === "OPERATOR" ? { userId: user.id } : {}),
    } as const;

    const organizationUsers = await prisma.organizationMember.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const organizationUserIds = organizationUsers.map((item) => item.userId);
    const permissions = await getRolePermissions(organizationId, membership.role);
    const access = Object.fromEntries(
      Object.entries(permissions).map(([module, permission]) => [
        module,
        permission.canView,
      ]),
    );
    const canSeeImports = access.IMPORTS || access.MOTOR_EXCHANGE;

    const [
      activeClients,
      newClientsThisMonth,
      processingsToday,
      pendingProcessings,
      failedProcessings,
      openTickets,
      moduleGroups,
      recentProcessings,
      recentActivities,
      recentTickets,
      teamGroups,
      creditAggregate,
      debitAggregate,
      activeOnboardings,
      overdueOnboardings,
      onboardingTimeAggregate,
      pendingOperations,
      overdueOperations,
      completedOperationsToday,
      operationTimeAggregate,
      newServiceEmails,
      activeAudits,
    ] = await Promise.all([
      prisma.client.count({ where: { organizationId, active: true } }),
      prisma.client.count({
        where: { organizationId, createdAt: { gte: monthStart } },
      }),
      prisma.importJob.count({
        where: { ...visibleImportWhere, createdAt: { gte: today } },
      }),
      prisma.importJob.count({
        where: {
          ...visibleImportWhere,
          status: { in: ["UPLOADED", "PROCESSING", "REVIEW", "VALIDATED"] },
        },
      }),
      prisma.importJob.count({
        where: { ...visibleImportWhere, status: "FAILED" },
      }),
      prisma.supportTicket.count({
        where: {
          organizationId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          ...(membership.role === "OPERATOR" ? { userId: user.id } : {}),
        },
      }),
      prisma.importJob.groupBy({
        by: ["module"],
        where: { ...visibleImportWhere, createdAt: { gte: today } },
        _count: { _all: true },
      }),
      prisma.importJob.findMany({
        where: visibleImportWhere,
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
          userId: { in: organizationUserIds },
          ...(membership.role === "OPERATOR" ? { userId: user.id } : {}),
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
          ...(membership.role === "OPERATOR" ? { userId: user.id } : {}),
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
        where: {
          organizationId,
          createdAt: { gte: monthStart },
          ...(membership.role === "OPERATOR" ? { userId: user.id } : {}),
        },
        _count: { _all: true },
        orderBy: { _count: { userId: "desc" } },
        take: 5,
      }),
      prisma.parsedTransaction.aggregate({
        where: {
          type: "CREDIT",
          date: { gte: monthStart },
          importJob: visibleImportWhere,
        },
        _sum: { amount: true },
      }),
      prisma.parsedTransaction.aggregate({
        where: {
          type: "DEBIT",
          date: { gte: monthStart },
          importJob: visibleImportWhere,
        },
        _sum: { amount: true },
      }),
      prisma.onboarding.count({
        where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      prisma.onboarding.count({
        where: {
          organizationId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          expectedEndDate: { lt: now },
        },
      }),
      prisma.onboardingTimeEntry.aggregate({
        where: {
          task: { onboarding: { organizationId } },
          startedAt: { gte: monthStart },
        },
        _sum: { seconds: true },
      }),
      prisma.operationActivity.count({
        where: {
          organizationId,
          deletedAt: null,
          status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
          ...(membership.role === "OPERATOR"
            ? { responsibleId: user.id }
            : {}),
        },
      }),
      prisma.operationActivity.count({
        where: {
          organizationId,
          deletedAt: null,
          dueAt: { lt: now },
          status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
          ...(membership.role === "OPERATOR"
            ? { responsibleId: user.id }
            : {}),
        },
      }),
      prisma.operationActivity.count({
        where: {
          organizationId,
          deletedAt: null,
          status: "COMPLETED",
          completedAt: { gte: today },
          ...(membership.role === "OPERATOR"
            ? { responsibleId: user.id }
            : {}),
        },
      }),
      prisma.operationTimeEntry.aggregate({
        where: {
          startedAt: { gte: monthStart },
          activity: { organizationId, deletedAt: null },
          ...(membership.role === "OPERATOR" ? { userId: user.id } : {}),
        },
        _sum: { seconds: true },
      }),
      prisma.serviceTicket.count({
        where: {
          organizationId,
          isSpam: false,
          status: "NEW",
          ...(membership.role === "OPERATOR"
            ? { OR: [{ assignedToId: user.id }, { assignedToId: null }] }
            : {}),
        },
      }),
      prisma.audit.count({
        where: {
          organizationId,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
          ...(membership.role === "OPERATOR"
            ? { supervisorId: user.id }
            : {}),
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
      },
      access,
      summary: {
        activeClients: access.CLIENTS ? activeClients : 0,
        newClientsThisMonth: access.CLIENTS ? newClientsThisMonth : 0,
        processingsToday: canSeeImports ? processingsToday : 0,
        pendingProcessings: canSeeImports ? pendingProcessings : 0,
        failedProcessings: canSeeImports ? failedProcessings : 0,
        openTickets: access.SUPPORT ? openTickets : 0,
        activeOnboardings: access.ONBOARDING ? activeOnboardings : 0,
        overdueOnboardings: access.ONBOARDING ? overdueOnboardings : 0,
        onboardingHoursThisMonth: access.ONBOARDING
          ? Math.round(((onboardingTimeAggregate._sum.seconds || 0) / 3600) * 100) / 100
          : 0,
        pendingOperations: access.OPERATIONS ? pendingOperations : 0,
        overdueOperations: access.OPERATIONS ? overdueOperations : 0,
        completedOperationsToday: access.OPERATIONS
          ? completedOperationsToday
          : 0,
        operationHoursThisMonth: access.OPERATIONS
          ? Math.round(((operationTimeAggregate._sum.seconds || 0) / 3600) * 100) / 100
          : 0,
        newServiceEmails: access.SERVICE_CENTER ? newServiceEmails : 0,
        activeAudits: access.AUDIT ? activeAudits : 0,
      },
      processingsByModule: canSeeImports ? moduleGroups.map((item) => ({
        module: item.module,
        total: item._count._all,
      })) : [],
      recentProcessings: canSeeImports ? recentProcessings.map((item) => ({
        id: item.id,
        module: item.module,
        status: item.status,
        originalName: item.originalName,
        clientName: item.client?.name ?? null,
        userName: item.user.name || item.user.email,
        createdAt: item.createdAt.toISOString(),
      })) : [],
      recentActivities: access.HISTORY ? recentActivities.map((item) => ({
        id: item.id,
        action: item.action,
        entity: item.entity,
        entityId: item.entityId,
        userName: item.user.name || item.user.email,
        createdAt: item.createdAt.toISOString(),
      })) : [],
      supportTickets: access.SUPPORT ? recentTickets.map((item) => ({
        id: item.id,
        subject: item.subject,
        priority: item.priority,
        status: item.status,
        userName: item.user.name || item.user.email,
        createdAt: item.createdAt.toISOString(),
      })) : [],
      teamPerformance: canSeeImports ? teamGroups.map((item) => ({
        userId: item.userId,
        name: userMap.get(item.userId) || "Usuário",
        total: item._count._all,
      })) : [],
      financialVolume: {
        credits: canSeeImports ? credits : 0,
        debits: canSeeImports ? debits : 0,
        total: canSeeImports ? credits + debits : 0,
      },
    });
  } catch (error) {
    console.error("Erro ao carregar Dashboard:", error);

    return NextResponse.json(
      { error: "Não foi possível carregar os dados reais do Dashboard." },
      { status: 500 },
    );
  }
}
