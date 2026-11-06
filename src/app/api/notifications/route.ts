import { whatsappNotifications } from "@/modules/whatsapp/notifications";
import { SERVICE_CENTER_MANAGER_ROLES } from "@/modules/atendimento/auth";
import { activityNotifications } from "@/modules/operations/notifications";
import { meetingNotifications } from "@/modules/meetings/notifications";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountMember } from "@/modules/account/server/account-auth";

type NotificationItem = {
  id: string;
  type: "ERROR" | "WARNING" | "INFO" | "SUCCESS";
  title: string;
  description: string;
  href: string;
  createdAt: string;
  popup?: boolean;
  priority?: number;
};

export async function GET() {
  try {
    const member = await getAccountMember();

    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const now = new Date();

    const [imports, tickets, onboardings, blockedTasks] = await Promise.all([
      prisma.importJob.findMany({
        where: {
          organizationId: member.organizationId,
          status: { in: ["FAILED", "REVIEW", "PROCESSING"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: {
          id: true,
          originalName: true,
          status: true,
          module: true,
          updatedAt: true,
          client: { select: { name: true } },
        },
      }),
      prisma.supportTicket.findMany({
        where: {
          organizationId: member.organizationId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          updatedAt: true,
        },
      }),
      prisma.onboarding.findMany({
        where: {
          organizationId: member.organizationId,
          status: { in: ["OPEN", "IN_PROGRESS"] },
          expectedEndDate: { lt: now },
        },
        orderBy: { expectedEndDate: "asc" },
        take: 8,
        select: {
          id: true,
          companyName: true,
          expectedEndDate: true,
          updatedAt: true,
        },
      }),
      prisma.onboardingTask.findMany({
        where: {
          onboarding: { organizationId: member.organizationId },
          status: "BLOCKED",
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          blockedReason: true,
          updatedAt: true,
          onboarding: {
            select: {
              id: true,
              companyName: true,
            },
          },
        },
      }),
    ]);

    const permissions = await getRolePermissions(member.organizationId, member.role);
    const [meetingItems,activityItems]=await Promise.all([permissions.MEETINGS.canView ? meetingNotifications(member.organizationId,member.userId,now) : [],permissions.OPERATIONS.canView ? activityNotifications(member.organizationId,member.userId,now) : []]);
    const whatsappItems = permissions.WHATSAPP.canView ? await whatsappNotifications(member.organizationId, member.userId, SERVICE_CENTER_MANAGER_ROLES.has(member.role), now) : [];
    const whatsappPreference = permissions.WHATSAPP.canView ? await prisma.whatsAppOperatorPreference.findUnique({ where: { organizationId_userId: { organizationId: member.organizationId, userId: member.userId } }, select: { notificationsMuted: true } }) : null;
    const items: NotificationItem[] = [...meetingItems,...activityItems,...whatsappItems.map(item => ({ ...item, popup: !whatsappPreference?.notificationsMuted }))];

    for (const item of imports) {
      const isFailed = item.status === "FAILED";
      items.push({
        id: `import-${item.id}-${item.updatedAt.getTime()}`,
        type: isFailed ? "ERROR" : item.status === "REVIEW" ? "WARNING" : "INFO",
        title: isFailed
          ? "Falha em processamento"
          : item.status === "REVIEW"
            ? "Importação aguardando revisão"
            : "Processamento em andamento",
        description: `${item.originalName}${item.client?.name ? ` · ${item.client.name}` : ""}`,
        href: "/historico",
        createdAt: item.updatedAt.toISOString(),
      });
    }

    for (const ticket of tickets) {
      items.push({
        id: `ticket-${ticket.id}-${ticket.updatedAt.getTime()}`,
        type: ticket.priority === "CRITICAL" ? "ERROR" : "INFO",
        title:
          ticket.status === "OPEN"
            ? "Novo chamado de suporte"
            : "Chamado em atendimento",
        description: ticket.subject,
        href: `/suporte`,
        createdAt: ticket.updatedAt.toISOString(),
      });
    }

    for (const onboarding of onboardings) {
      items.push({
        id: `onboarding-${onboarding.id}-${onboarding.updatedAt.getTime()}`,
        type: "WARNING",
        title: "Onboarding fora do prazo",
        description:
          onboarding.companyName || "Implantação sem nome informado",
        href: "/onboarding",
        createdAt: onboarding.updatedAt.toISOString(),
      });
    }

    for (const task of blockedTasks) {
      items.push({
        id: `task-${task.id}-${task.updatedAt.getTime()}`,
        type: "WARNING",
        title: "Tarefa de onboarding bloqueada",
        description: `${task.onboarding.companyName || "Implantação"} · ${task.title}${task.blockedReason ? ` · ${task.blockedReason}` : ""}`,
        href: "/onboarding",
        createdAt: task.updatedAt.toISOString(),
      });
    }

    items.sort(
      (a, b) =>
        (b.priority || 0) - (a.priority || 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({
      viewerKey: `${member.organizationId}:${member.userId}`,
      whatsappNotificationsMuted: Boolean(whatsappPreference?.notificationsMuted),
      items: items.slice(0, 60),
      total: items.length,
    });
  } catch (error) {
    console.error("Erro ao carregar notificações:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar as notificações." },
      { status: 500 },
    );
  }
}
