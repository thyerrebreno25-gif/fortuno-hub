import { prisma } from "@/lib/prisma";
import { mappingScope } from "@/modules/operational-mapping/server";
import { gutSchema, gutScore } from "@/modules/operational-mapping/gut";
import type { AssistantMember } from "@/modules/assistant/auth";
export function summarizeMappings(rows: Array<{ status: string; data: unknown }>) {
  let activities = 0, assessed = 0, highestImpact = 0;
  for (const row of rows) {
    const data = row.data as { gut?: unknown } | null;
    const parsed = gutSchema.safeParse(data?.gut || []);
    if (!parsed.success) continue;
    activities += parsed.data.length;
    for (const item of parsed.data) { const score = gutScore(item); if (score !== null) { assessed++; highestImpact = Math.max(highestImpact, score / 125 * 100); } }
  }
  return { total: rows.length, validated: rows.filter((row) => row.status === "VALIDATED").length, activities, assessed, highestImpact };
}
export async function operationalOverview(member: AssistantMember, access: Record<string, boolean>, start: Date, end: Date, visibleUserIds: string[]) {
  const organizationId = member.organizationId;
  const broad = ["MASTER", "ADMIN", "MANAGER"].includes(member.role);
  const [mappings, operations, tickets, service, meetingTotal, pendingDeliveries, overdueDeliveries, agendaUpcoming] = await Promise.all([
    access.OPERATIONAL_MAPPING ? prisma.operationalMapping.findMany({ where: mappingScope(member), select: { status: true, data: true } }) : [],
    access.OPERATIONS ? prisma.operationActivity.groupBy({ by: ["status"], where: { organizationId, deletedAt: null, scheduledDate: { gte: start, lte: end }, ...(broad ? {} : { responsibleId: { in: visibleUserIds } }) }, _count: { _all: true } }) : [],
    access.WHATSAPP ? prisma.serviceTicket.groupBy({ by: ["source", "status"], where: { organizationId, source: { in: ["WHATSAPP_API", "WHATSAPP_SIMULATOR"] }, isSpam: false, receivedAt: { gte: start, lte: end }, ...(broad ? {} : { assignedToId: { in: visibleUserIds } }) }, _count: { _all: true } }) : [],
    access.SERVICE_CENTER ? prisma.serviceTicket.groupBy({ by: ["status"], where: { organizationId, source: { notIn: ["WHATSAPP_API", "WHATSAPP_SIMULATOR"] }, isSpam: false, receivedAt: { gte: start, lte: end }, ...(broad ? {} : { OR: [{ assignedToId: { in: visibleUserIds } }, { assignedToId: null }] }) }, _count: { _all: true } }) : [],
    access.MEETINGS ? prisma.teamMeeting.count({ where: { organizationId, startsAt: { gte: start, lte: end }, status: { not: "CANCELLED" }, ...(broad ? {} : { OR: [{ createdById: member.userId }, { participants: { some: { userId: member.userId } } }] }) } }) : 0,
    access.MEETINGS ? prisma.meetingActionItem.count({ where: { completedAt: null, meeting: { organizationId, status: { not: "CANCELLED" }, ...(broad ? {} : { OR: [{ createdById: member.userId }, { participants: { some: { userId: member.userId } } }] }) } } }) : 0,
    access.MEETINGS ? prisma.meetingActionItem.count({ where: { completedAt: null, dueAt: { lt: end }, meeting: { organizationId, status: { not: "CANCELLED" }, ...(broad ? {} : { OR: [{ createdById: member.userId }, { participants: { some: { userId: member.userId } } }] }) } } }) : 0,
    access.CALENDAR ? prisma.teamCalendarEvent.count({ where: { organizationId, userId: member.userId, status: "ACTIVE", startsAt: { gte: end, lte: new Date(end.getTime() + 7 * 86400000) } } }) : 0,
  ]);
  return {
    meetings: { total: meetingTotal, pending: pendingDeliveries, overdue: overdueDeliveries },
    agendaUpcoming,
    mappings: summarizeMappings(mappings),
    service: { received: service.reduce((sum, row) => sum + row._count._all, 0), resolved: service.filter((row) => row.status === "RESOLVED").reduce((sum, row) => sum + row._count._all, 0) },
    operations: { total: operations.reduce((sum, row) => sum + row._count._all, 0), completed: operations.filter((row) => row.status === "COMPLETED").reduce((sum, row) => sum + row._count._all, 0) },
    whatsapp: { received: tickets.filter((row) => row.source === "WHATSAPP_API").reduce((sum, row) => sum + row._count._all, 0), resolved: tickets.filter((row) => row.source === "WHATSAPP_API" && row.status === "RESOLVED").reduce((sum, row) => sum + row._count._all, 0), simulated: tickets.filter((row) => row.source === "WHATSAPP_SIMULATOR").reduce((sum, row) => sum + row._count._all, 0) },
  };
}
