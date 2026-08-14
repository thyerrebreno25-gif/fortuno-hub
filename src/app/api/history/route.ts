import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountMember } from "@/modules/account/server/account-auth";

type HistoryItem = {
  id: string;
  source: "IMPORTS" | "OPERATIONS" | "ONBOARDING" | "SERVICE_CENTER" | "SYSTEM";
  title: string;
  description: string;
  entity: string;
  clientName: string | null;
  userName: string;
  status: string;
  createdAt: string;
  href: string;
};

export async function GET(request: Request) {
  try {
    const member = await getAccountMember();
    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const url = new URL(request.url);
    const take = Math.min(Math.max(Number(url.searchParams.get("take") || 300), 1), 500);
    const perSource = Math.min(take, 150);

    const [imports, operationEvents, onboardingHistory, serviceHistory, auditLogs] =
      await Promise.all([
        prisma.importJob.findMany({
          where: { organizationId: member.organizationId },
          orderBy: { createdAt: "desc" },
          take: perSource,
          select: {
            id: true,
            module: true,
            status: true,
            originalName: true,
            createdAt: true,
            client: { select: { name: true } },
            user: { select: { name: true, email: true } },
            _count: { select: { transactions: true } },
          },
        }),
        prisma.operationEvent.findMany({
          where: { activity: { organizationId: member.organizationId } },
          orderBy: { createdAt: "desc" },
          take: perSource,
          select: {
            id: true,
            type: true,
            message: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
            activity: {
              select: {
                id: true,
                title: true,
                status: true,
                client: { select: { name: true } },
              },
            },
          },
        }),
        prisma.onboardingHistory.findMany({
          where: { onboarding: { organizationId: member.organizationId } },
          orderBy: { createdAt: "desc" },
          take: perSource,
          select: {
            id: true,
            action: true,
            entity: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
            onboarding: {
              select: {
                id: true,
                companyName: true,
                status: true,
                client: { select: { name: true } },
              },
            },
          },
        }),
        prisma.serviceTicketHistory.findMany({
          where: { ticket: { organizationId: member.organizationId } },
          orderBy: { createdAt: "desc" },
          take: perSource,
          select: {
            id: true,
            type: true,
            message: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
            ticket: {
              select: {
                id: true,
                subject: true,
                senderEmail: true,
                status: true,
                client: { select: { name: true } },
              },
            },
          },
        }),
        prisma.auditLog.findMany({
          where: {
            user: {
              memberships: { some: { organizationId: member.organizationId } },
            },
          },
          orderBy: { createdAt: "desc" },
          take: perSource,
          select: {
            id: true,
            action: true,
            entity: true,
            entityId: true,
            createdAt: true,
            user: { select: { name: true, email: true } },
          },
        }),
      ]);

    const items: HistoryItem[] = [
      ...imports.map((item) => ({
        id: `import-${item.id}`,
        source: "IMPORTS" as const,
        title: item.originalName,
        description: `${item._count.transactions} registro(s) processado(s)`,
        entity: String(item.module),
        clientName: item.client?.name || null,
        userName: item.user.name || item.user.email,
        status: String(item.status),
        createdAt: item.createdAt.toISOString(),
        href: "/historico",
      })),
      ...operationEvents.map((item) => ({
        id: `operation-${item.id}`,
        source: "OPERATIONS" as const,
        title: item.activity.title,
        description: item.message,
        entity: String(item.type),
        clientName: item.activity.client.name,
        userName: item.user.name || item.user.email,
        status: String(item.activity.status),
        createdAt: item.createdAt.toISOString(),
        href: "/operacoes",
      })),
      ...onboardingHistory.map((item) => ({
        id: `onboarding-${item.id}`,
        source: "ONBOARDING" as const,
        title:
          item.onboarding.companyName ||
          item.onboarding.client?.name ||
          "Onboarding",
        description: `${item.action} · ${item.entity}`,
        entity: item.entity,
        clientName: item.onboarding.client?.name || item.onboarding.companyName,
        userName: item.user.name || item.user.email,
        status: String(item.onboarding.status),
        createdAt: item.createdAt.toISOString(),
        href: "/onboarding",
      })),
      ...serviceHistory.map((item) => ({
        id: `service-${item.id}`,
        source: "SERVICE_CENTER" as const,
        title: item.ticket.subject,
        description: item.message,
        entity: item.type,
        clientName: item.ticket.client?.name || item.ticket.senderEmail,
        userName: item.user?.name || item.user?.email || "Automação",
        status: String(item.ticket.status),
        createdAt: item.createdAt.toISOString(),
        href: "/atendimento",
      })),
      ...auditLogs.map((item) => ({
        id: `system-${item.id}`,
        source: "SYSTEM" as const,
        title: item.action,
        description: `${item.entity}${item.entityId ? ` · ${item.entityId}` : ""}`,
        entity: item.entity,
        clientName: null,
        userName: item.user.name || item.user.email,
        status: "REGISTERED",
        createdAt: item.createdAt.toISOString(),
        href: "/historico",
      })),
    ];

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({ items: items.slice(0, take), total: items.length });
  } catch (error) {
    console.error("Erro ao carregar histórico unificado:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar o histórico." },
      { status: 500 },
    );
  }
}
