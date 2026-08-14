import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountMember } from "@/modules/account/server/account-auth";
import { getServiceCenterPermission } from "@/modules/atendimento/auth";

type NotificationItem = {
  id: string;
  type: "ERROR" | "WARNING" | "INFO" | "SUCCESS";
  title: string;
  description: string;
  href: string;
  createdAt: string;
};

export async function GET() {
  try {
    const member = await getAccountMember();

    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }

    const now = new Date();
    const servicePermission = await getServiceCenterPermission(
      member.organizationId,
      member.role,
    );

    const [imports, tickets, onboardings, blockedTasks, serviceEmails] = await Promise.all([
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
      servicePermission.canView
        ? prisma.serviceTicket.findMany({
            where: {
              organizationId: member.organizationId,
              source: "GMAIL",
              isSpam: false,
              status: { in: ["NEW", "IN_PROGRESS", "WAITING_INTERNAL"] },
              ...(member.role === "OPERATOR"
                ? {
                    OR: [
                      { assignedToId: member.userId },
                      { assignedToId: null },
                    ],
                  }
                : {}),
            },
            orderBy: { lastMessageAt: "desc" },
            take: 12,
            select: {
              id: true,
              subject: true,
              senderName: true,
              senderEmail: true,
              assignedToId: true,
              lastMessageAt: true,
              client: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const items: NotificationItem[] = [];

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

    for (const email of serviceEmails) {
      const sender = email.senderName || email.senderEmail;
      items.push({
        id: `email-${email.id}-${email.lastMessageAt.getTime()}`,
        type: "INFO",
        title:
          email.assignedToId === member.userId
            ? "Novo e-mail para você"
            : "Novo e-mail recebido",
        description: `${email.client?.name || sender} · ${email.subject}`,
        href: "/atendimento",
        createdAt: email.lastMessageAt.toISOString(),
      });
    }

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return NextResponse.json({
      items: items.slice(0, 20),
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
