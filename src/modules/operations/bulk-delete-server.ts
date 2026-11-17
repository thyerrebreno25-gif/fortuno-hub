import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canManageOperations, getOperationMember } from "./auth";
import { operationDayRange } from "./activity-deadline";
import { OperationTimerError } from "./timer-server";
import type { BulkActivityDeletion } from "./bulk-delete-model";
type Member = NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
export function requireBulkActivityDeletion(member: Member) {
  if (!canManageOperations(member.role) || member.canEdit === false) throw new OperationTimerError("Somente gestores com permissão de edição podem excluir atividades em lote.", 403);
}
export async function deleteActivitiesForDay(member: Member, input: BulkActivityDeletion) {
  requireBulkActivityDeletion(member);
  let scheduledDate;
  try { scheduledDate = operationDayRange(input.day); }
  catch { throw new OperationTimerError("Selecione uma data válida.", 400); }
  const ids = input.activities.map(activity => activity.id);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-" + member.organizationId}))`;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "OperationActivity" WHERE "organizationId"=${member.organizationId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const where = { id: { in: ids }, organizationId: member.organizationId, deletedAt: null, scheduledDate };
    const activities = await tx.operationActivity.findMany({ where, select: { id: true, updatedAt: true } });
    if (activities.length !== ids.length) throw new OperationTimerError("A seleção mudou ou contém atividades de outra data. Atualize a lista antes de excluir.", 409);
    const expected = new Map(input.activities.map(activity => [activity.id, activity.updatedAt]));
    if (activities.some(activity => expected.get(activity.id) !== activity.updatedAt.toISOString())) throw new OperationTimerError("Uma atividade foi alterada após a seleção. Atualize a lista para conferir antes de excluir.", 409);
    const now = new Date();
    const timers = await tx.operationTimeEntry.findMany({ where: { activityId: { in: ids }, endedAt: null }, select: { id: true, startedAt: true } });
    for (const timer of timers) await tx.operationTimeEntry.update({ where: { id: timer.id }, data: { endedAt: now, seconds: Math.max(0, Math.floor((+now - +timer.startedAt) / 1000)) } });
    await tx.operationEvent.createMany({ data: ids.map(activityId => ({ activityId, userId: member.userId, type: "ACTIVITY_DELETED" as const, message: `${member.user.name || member.user.email} excluiu a atividade na seleção em lote de ${input.day.split("-").reverse().join("/")}. Justificativa: ${input.reason}`, metadata: { reason: input.reason, day: input.day, batch: true } })) });
    const result = await tx.operationActivity.updateMany({ where, data: { deletedAt: now, deletedById: member.userId, deletionReason: input.reason } });
    return { deleted: result.count, day: input.day };
  }, { maxWait: 10000, timeout: 30000 });
}
