import { prisma } from "@/lib/prisma";
import { dayKey } from "./model";
export async function meetingNotifications(organizationId: string, userId: string, now = new Date()) {
  const nextDay = new Date(now.getTime() + 86400000);
  const [actions, meetings, invitations] = await Promise.all([
    prisma.meetingActionItem.findMany({ where: { responsibleId: userId, completedAt: null, dueAt: { lte: nextDay }, meeting: { organizationId, status: { not: "CANCELLED" } } }, orderBy: { dueAt: "asc" }, take: 20, include: { meeting: { select: { title: true } } } }),
    prisma.teamMeeting.findMany({ where: { organizationId, status: "SCHEDULED", participants: { some: { userId } }, startsAt: { gte: now, lte: nextDay } }, take: 10, orderBy: { startsAt: "asc" } }),
    prisma.meetingDelivery.findMany({ where: { organizationId, userId, actionItemId: null, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return [
    ...actions.map((action) => ({ id: `meeting-action:${action.id}:${action.revision}:${dayKey(now)}`, type: action.dueAt < now ? "WARNING" as const : "INFO" as const, title: action.dueAt < now ? "Entrega de reunião atrasada" : "Entrega de reunião próxima", description: `${action.title} · ${action.meeting.title} · ${action.dueAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, href: `/reunioes?meeting=${encodeURIComponent(action.meetingId)}`, createdAt: now.toISOString() })),
    ...meetings.map((meeting) => ({ id: `meeting-soon:${meeting.id}:${meeting.revision}:${dayKey(now)}`, type: "INFO" as const, title: "Sua próxima reunião", description: `${meeting.title} · ${meeting.startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, href: `/reunioes?meeting=${encodeURIComponent(meeting.id)}`, createdAt: now.toISOString() })),
    ...invitations.map((item) => ({ id: `meeting-invite:${item.id}`, type: "INFO" as const, title: item.title, description: item.body, href: `/reunioes?meeting=${encodeURIComponent(item.meetingId)}`, createdAt: item.createdAt.toISOString() })),
  ];
}
