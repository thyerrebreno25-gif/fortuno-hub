import { prisma } from "@/lib/prisma";

export const activityInclude = {
  client: { select: { id: true, name: true, operationalEmail: true, operationalEmailCc: true, cluster: true } },
  process: { select: { id: true, name: true, department: true, requiresAttachment: true, notifyClient: true } },
  clientProcess: { select: { id: true, team: true, recurrenceType: true, recurrenceData: true, notifyClient: true, priority: true, auditEnabled: true } },
  responsible: { select: { id: true, name: true, email: true } },
  checklistItems: { orderBy: { position: "asc" as const } },
  timeEntries: { orderBy: { startedAt: "asc" as const }, include: { user: { select: { id: true, name: true, email: true } } } },
  comments: { orderBy: { createdAt: "asc" as const }, include: { user: { select: { id: true, name: true, email: true } } } },
  attachments: { orderBy: { createdAt: "asc" as const } },
  events: { orderBy: { createdAt: "desc" as const }, include: { user: { select: { id: true, name: true, email: true } } } },
};

export async function createEvent(activityId: string, userId: string, type: any, message: string, metadata?: unknown) {
  return prisma.operationEvent.create({ data: { activityId, userId, type, message, metadata: metadata as any } });
}
