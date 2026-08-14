import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

function startDate(period: string) {
  const now = new Date();
  const date = new Date(now);
  if (period === "7d") date.setDate(date.getDate() - 6);
  else if (period === "90d") date.setDate(date.getDate() - 89);
  else if (period === "year") date.setMonth(0, 1);
  else date.setDate(date.getDate() - 29);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const member = await prisma.organizationMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true, role: true },
    });
    if (!member) {
      return NextResponse.json(
        { error: "Organização não encontrada." },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const period = url.searchParams.get("period") || "30d";
    const from = startDate(period);
    const now = new Date();
    const isOperator = member.role === "OPERATOR";

    const [imports, clients, onboardings, operations, serviceTickets, audits] =
      await Promise.all([
        prisma.importJob.findMany({
          where: {
            organizationId: member.organizationId,
            createdAt: { gte: from },
            ...(isOperator ? { userId: user.id } : {}),
          },
          include: {
            client: { select: { name: true } },
            user: { select: { name: true, email: true } },
            transactions: { select: { amount: true, type: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.client.count({
          where: { organizationId: member.organizationId, active: true },
        }),
        prisma.onboarding.findMany({
          where: {
            organizationId: member.organizationId,
            ...(isOperator ? { responsibleId: user.id } : {}),
          },
          include: {
            tasks: {
              select: {
                status: true,
                timeEntries: { select: { seconds: true } },
              },
            },
          },
        }),
        prisma.operationActivity.findMany({
          where: {
            organizationId: member.organizationId,
            deletedAt: null,
            OR: [
              { scheduledDate: { gte: from } },
              { createdAt: { gte: from } },
            ],
            ...(isOperator ? { responsibleId: user.id } : {}),
          },
          select: {
            id: true,
            status: true,
            dueAt: true,
            scheduledDate: true,
            createdAt: true,
            timeEntries: { select: { seconds: true } },
          },
        }),
        prisma.serviceTicket.findMany({
          where: {
            organizationId: member.organizationId,
            receivedAt: { gte: from },
            ...(isOperator
              ? { OR: [{ assignedToId: user.id }, { assignedToId: null }] }
              : {}),
          },
          select: {
            id: true,
            status: true,
            isSpam: true,
            receivedAt: true,
            firstResponseAt: true,
            resolvedAt: true,
          },
        }),
        prisma.audit.findMany({
          where: {
            organizationId: member.organizationId,
            createdAt: { gte: from },
            ...(isOperator ? { supervisorId: user.id } : {}),
          },
          select: {
            id: true,
            status: true,
            healthScore: true,
            totalChecks: true,
            passedChecks: true,
            _count: { select: { findings: true } },
          },
        }),
      ]);

    const byModule: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    const daily: Record<string, { total: number; success: number; failed: number }> = {};
    let credits = 0;
    let debits = 0;

    for (const item of imports) {
      byModule[item.module] = (byModule[item.module] || 0) + 1;
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      const userName = item.user.name || item.user.email;
      byUser[userName] = (byUser[userName] || 0) + 1;
      const key = item.createdAt.toISOString().slice(0, 10);
      daily[key] ??= { total: 0, success: 0, failed: 0 };
      daily[key].total += 1;
      if (item.status === "FAILED") daily[key].failed += 1;
      if (item.status === "EXPORTED" || item.status === "VALIDATED") {
        daily[key].success += 1;
      }
      for (const transaction of item.transactions) {
        if (transaction.type === "CREDIT") credits += Number(transaction.amount);
        else debits += Number(transaction.amount);
      }
    }

    const activeOnboardings = onboardings.filter(
      (item) => item.status !== "COMPLETED" && item.status !== "CANCELLED",
    ).length;
    const overdueOnboardings = onboardings.filter(
      (item) =>
        item.status !== "COMPLETED" &&
        item.status !== "CANCELLED" &&
        item.expectedEndDate < now,
    ).length;
    const onboardingSeconds = onboardings
      .flatMap((item) => item.tasks)
      .flatMap((task) => task.timeEntries)
      .reduce((total, entry) => total + entry.seconds, 0);

    const operationSeconds = operations
      .flatMap((item) => item.timeEntries)
      .reduce((total, entry) => total + entry.seconds, 0);
    const operationCompleted = operations.filter(
      (item) => item.status === "COMPLETED",
    ).length;
    const operationOverdue = operations.filter(
      (item) =>
        !["COMPLETED", "DISREGARDED"].includes(item.status) &&
        Boolean(item.dueAt && item.dueAt < now),
    ).length;

    const resolvedService = serviceTickets.filter(
      (item) => item.status === "RESOLVED",
    ).length;
    const responseTimes = serviceTickets
      .filter((item) => item.firstResponseAt)
      .map(
        (item) =>
          (item.firstResponseAt!.getTime() - item.receivedAt.getTime()) / 60000,
      );

    const totalAuditChecks = audits.reduce(
      (total, item) => total + item.totalChecks,
      0,
    );
    const passedAuditChecks = audits.reduce(
      (total, item) => total + item.passedChecks,
      0,
    );

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      period,
      summary: {
        totalImports: imports.length,
        successful: (byStatus.EXPORTED || 0) + (byStatus.VALIDATED || 0),
        failed: byStatus.FAILED || 0,
        pending:
          (byStatus.UPLOADED || 0) +
          (byStatus.PROCESSING || 0) +
          (byStatus.REVIEW || 0),
        activeClients: clients,
        activeOnboardings,
        overdueOnboardings,
        onboardingHours: Math.round(onboardingSeconds / 36) / 100,
        credits,
        debits,
      },
      operations: {
        total: operations.length,
        completed: operationCompleted,
        pending: operations.filter((item) =>
          ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(item.status),
        ).length,
        blocked: operations.filter((item) => item.status === "BLOCKED").length,
        overdue: operationOverdue,
        hours: Math.round(operationSeconds / 36) / 100,
        completionRate: operations.length
          ? Math.round((operationCompleted / operations.length) * 100)
          : 0,
      },
      serviceCenter: {
        received: serviceTickets.length,
        resolved: resolvedService,
        open: serviceTickets.filter((item) =>
          ["NEW", "IN_PROGRESS", "WAITING_INTERNAL", "WAITING_CUSTOMER"].includes(
            item.status,
          ),
        ).length,
        spam: serviceTickets.filter((item) => item.isSpam).length,
        resolutionRate: serviceTickets.length
          ? Math.round((resolvedService / serviceTickets.length) * 100)
          : 0,
        averageFirstResponseMinutes: responseTimes.length
          ? Math.round(
              responseTimes.reduce((total, value) => total + value, 0) /
                responseTimes.length,
            )
          : 0,
      },
      audits: {
        total: audits.length,
        active: audits.filter(
          (item) => !["COMPLETED", "CANCELLED"].includes(item.status),
        ).length,
        completed: audits.filter((item) => item.status === "COMPLETED").length,
        findings: audits.reduce((total, item) => total + item._count.findings, 0),
        averageHealthScore: audits.length
          ? Math.round(
              audits.reduce((total, item) => total + item.healthScore, 0) /
                audits.length,
            )
          : 0,
        checklistRate: totalAuditChecks
          ? Math.round((passedAuditChecks / totalAuditChecks) * 100)
          : 0,
      },
      byModule: Object.entries(byModule).map(([name, total]) => ({ name, total })),
      byStatus: Object.entries(byStatus).map(([name, total]) => ({ name, total })),
      byUser: Object.entries(byUser)
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total),
      daily: Object.entries(daily)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({ date, ...values })),
      recent: imports.slice(0, 30).map((item) => ({
        id: item.id,
        name: item.originalName,
        module: item.module,
        status: item.status,
        client: item.client?.name || null,
        user: item.user.name || item.user.email,
        createdAt: item.createdAt.toISOString(),
        difference: item.difference ? Number(item.difference) : 0,
        metadata: item.metadata,
      })),
    });
  } catch (error) {
    console.error("Erro nos relatórios:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar os relatórios." },
      { status: 500 },
    );
  }
}
